import prisma from '../lib/prisma';
import { sendTelegramMessage, escapeHtml } from './telegramService';
import { logNotification } from './notificationLogger';
import { sendPushToUser } from './webPushService';
import { checkDrawdownProtection } from './drawdownProtection';
import { decrypt } from '../lib/encryption';
import type { Account } from '../mock/data';

type AlertType = 'drawdown' | 'equity' | 'margin' | 'offline';

/**
 * Deciding whether an alert should actually be sent.
 *
 * The old rule was a five minute cooldown and nothing else, which gets
 * both halves wrong. An account parked over its threshold alerted every
 * five minutes for as long as it stayed there — two hundred and eighty
 * times a day saying the same thing — and a figure wobbling across the
 * line alerted on every crossing. The cooldown also lived in memory, and
 * this redeploys itself every five minutes, so each deploy wiped it.
 *
 * Three rules now, in order:
 *
 *   1. Alert when it crosses the line, not while it sits past it.
 *   2. It is only "recovered", and so able to alert again, once it comes
 *      back a clear margin the right side of the threshold. A drawdown
 *      limit of 80% re-arms below 75%, so 79.8 → 80.2 → 79.9 → 80.1 is
 *      one alert, not four.
 *   3. If it gets markedly worse while already alerting, that is news
 *      rather than a repeat, so it speaks up again — 80% becoming 95% is
 *      not something to stay quiet about.
 *   4. All of the above is remembered against the threshold in force at
 *      the time. Move the threshold and the memory is void: whatever was
 *      announced about the old line says nothing about the new one.
 *
 * Over all of it sits the account's own floor: however many of the above
 * are satisfied, nothing is sent within alertRepeatMins of the last one.
 */

/** How far back past the threshold counts as recovered, per kind. */
const recovered = (type: AlertType, value: number, threshold: number): boolean => {
  switch (type) {
    // Drawdown and margin level are percentages, so a flat margin reads
    // the same at every size.
    case 'drawdown': return value < threshold - 5;
    case 'margin':   return value > threshold * 1.1;
    // Money, where a flat figure would mean nothing across accounts.
    case 'equity':   return value > threshold * 1.02;
    default:         return true;
  }
};

/** Enough of a change to be worth saying again while already alerting. */
const materiallyWorse = (type: AlertType, value: number, since: number): boolean => {
  switch (type) {
    case 'drawdown': return value >= since + 10;
    case 'margin':   return value <= since * 0.8;
    case 'equity':   return value <= since * 0.9;
    default:         return false;
  }
};

interface Decision { send: boolean; }

/**
 * Read this alert's state, decide, and write back what happened.
 *
 * Returns whether to send. Never throws: a database hiccup must not stop
 * an alert going out, so it falls back to sending — the noisy direction
 * is the safe one when the thing being reported is somebody's money.
 */
const shouldSend = async (
  accountId: string,
  type: AlertType,
  breached: boolean,
  value: number,
  threshold: number,
  repeatMins: number,
): Promise<Decision> => {
  let state;
  try {
    state = await prisma.alertState.findUnique({
      where: { accountId_type: { accountId, type } },
    });
  } catch (err) {
    console.error('[Alert] could not read alert state:', (err as Error)?.message);
    return { send: breached };
  }

  // Is this still the same rule the state was recorded against? Moving a
  // threshold throws away everything remembered about the old one. A
  // drawdown sitting at 80.3% was announced against a limit of 50% and
  // latched as "already said"; raise the limit to 80% and that latch would
  // swallow the first breach of the new line — the alert the person moved
  // the line in order to get. A row written before this column existed
  // records no rule, and is treated the same way: one alert too many beats
  // a latch nobody can see.
  const sameRule = state?.threshold != null && Math.abs(state.threshold - threshold) < 1e-9;

  if (!breached) {
    // Stand down once it is properly clear, not the moment it dips back
    // under the line — and immediately if the line it was measured against
    // is gone. Either way the stored rule is brought up to date, so the
    // next breach is judged against what is set now.
    if (state && (!sameRule || (state.firing && recovered(type, value, threshold)))) {
      await prisma.alertState.update({
        where: { accountId_type: { accountId, type } },
        data: { firing: false, threshold },
      }).catch(() => {});
    }
    return { send: false };
  }

  // The floor holds across a threshold change: changing a line is
  // deliberate, so it re-arms the alert, but it must not be a way to make
  // the phone buzz faster than the account's own limit allows.
  const floorMs = Math.max(0, repeatMins) * 60 * 1000;
  const tooSoon = state?.lastFiredAt != null && Date.now() - state.lastFiredAt.getTime() < floorMs;

  // Already announced under this same rule, and no worse than when it was:
  // nothing to say.
  const latched = Boolean(state?.firing) && sameRule;
  const worse = latched && state?.lastValue != null
    && materiallyWorse(type, value, state.lastValue);
  if (latched && !worse) return { send: false };
  if (tooSoon) return { send: false };

  await prisma.alertState.upsert({
    where: { accountId_type: { accountId, type } },
    update: { firing: true, lastValue: value, threshold, lastFiredAt: new Date() },
    create: { accountId, type, firing: true, lastValue: value, threshold, lastFiredAt: new Date() },
  }).catch(err => console.error('[Alert] could not record alert state:', err?.message));

  return { send: true };
};

/**
 * Strip the Telegram markup out of a message so it can be read anywhere.
 *
 * The alert texts are written for Telegram's HTML mode. A push notification
 * is plain text in a system tray, where a literal <b> is just noise, and
 * where there is room for about two lines — so the leading "[OnlyFunds]"
 * and the blank lines go too. The title of the push already says who it is
 * from.
 */
const plain = (html: string): string[] =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/^\[OnlyFunds\]\s*/, '')
    .split('\n').map(l => l.trim()).filter(Boolean);

/**
 * Split an alert into the two lines a phone shows.
 *
 * iOS prints the web app's own name above whatever title is given, so a
 * title of "OnlyFunds" renders as "OnlyFunds from OnlyFunds" and the one
 * line read at a glance says nothing. The headline and the account go in
 * the title instead — "DRAWDOWN ALERT · Gold Scalper" — and the figures
 * follow in the body, which is what a notification is for: knowing
 * whether to open it.
 */
const forPhone = (html: string): { title: string; body: string } => {
  const lines = plain(html);
  const head = lines[0] || 'Alert';
  const account = lines.find(l => /^Account:/i.test(l))?.replace(/^Account:\s*/i, '');
  const rest = lines.slice(1).filter(l => !/^Account:/i.test(l));
  return {
    title: account ? `${head} · ${account}` : head,
    // Something has to be said even if an alert is ever only a headline:
    // a notification with an empty body renders as a blank second line.
    body: rest.length ? rest.join(' · ') : head,
  };
};

/**
 * Send one alert everywhere it should go, and record it either way.
 *
 * Telegram used to be the only channel, and the whole check returned early
 * when it was not configured — so someone who never made a bot got no
 * alerts at all, and nothing in the bell either. Push needs no setup beyond
 * tapping "allow" on the phone, so the two are now independent: either can
 * be off without silencing the other, and the log is written regardless of
 * which carried it.
 */
const deliver = async (
  userId: string,
  accountId: string,
  type: AlertType,
  html: string,
  telegram: { token: string; chatId: string } | null,
): Promise<void> => {
  const push = sendPushToUser(userId, {
    ...forPhone(html),
    url: '/',
    // One live alert per account and kind on screen at a time. A margin
    // warning repeating every five minutes should replace itself, not
    // bury the rest of the tray.
    tag: `${type}:${accountId}`,
  }).catch(err => {
    console.error('[Alert] push failed:', err?.message);
    return { sent: 0, failures: [] };
  });

  let telegramOk: boolean | null = null;
  if (telegram) {
    telegramOk = await sendTelegramMessage(telegram.token, telegram.chatId, html)
      .then(() => true)
      .catch(err => {
        console.error('[Alert] Telegram send failed:', err.message);
        return false;
      });
  }

  await push;
  // The flag means "nothing that was set up refused it", not "a channel
  // existed". The log itself is a channel — it is what the bell in the
  // header reads — so an alert recorded with no bot and no phone attached
  // has still reached the person, and marking every one of those as a
  // failure would paint the whole list red for someone who simply never
  // connected Telegram.
  await logNotification(userId, accountId, type, html, telegramOk !== false);
};

/**
 * Check alert conditions for a user's accounts.
 * Called from both the simulation loop (broadcaster) and MT5 real push (mt5Controller).
 */
export const checkAlerts = async (
  userId: string,
  accounts: Account[],
): Promise<void> => {
  // Skip if no accounts have any activity worth alerting
  if (accounts.length === 0) return;

  // Fetch user Telegram credentials + account thresholds
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      telegramBotToken: true,
      telegramChatId: true,
      accounts: {
        select: {
          id: true,
          alertDrawdown: true,
          alertEquityBelow: true,
          alertMarginLevel: true,
          alertOffline: true,
          alertRepeatMins: true,
        },
      },
    },
  });

  if (!user) return;

  // Null when no bot is configured. Not a reason to stop: push does not
  // need one.
  const telegram = user.telegramBotToken && user.telegramChatId
    ? { token: decrypt(user.telegramBotToken), chatId: user.telegramChatId }
    : null;

  // Build threshold lookup by account id
  const thresholds = new Map(user.accounts.map(a => [a.id, a]));

  for (const account of accounts) {
    const t = thresholds.get(account.id);
    if (!t) continue;

    // An account reporting again is what clears the offline alert. Done
    // before the skip below, because checkOfflineAlert only ever runs on
    // the way out — nothing else would ever stand this one down, and it
    // would stay "already announced" for good.
    if (account.status === 'online' && t.alertOffline) {
      await shouldSend(account.id, 'offline', false, 0, 0, t.alertRepeatMins);
    }

    // Drawdown, equity and margin need a live reading to mean anything.
    if (account.status !== 'online') continue;

    // Each candidate carries the reading and the line it is measured
    // against, because deciding whether to send needs both.
    const fires: Array<{ type: AlertType; message: string; value: number; threshold: number }> = [];

    const safeName = escapeHtml(account.name);

    // 1. Drawdown alert
    if (t.alertDrawdown !== null && account.drawdown >= t.alertDrawdown) {
      fires.push({
        type: 'drawdown',
        message: `⚠️ <b>DRAWDOWN ALERT</b>\n\nAccount: <b>${safeName}</b>\nDrawdown: <b>${account.drawdown.toFixed(2)}%</b> (threshold: ${t.alertDrawdown}%)\nEquity: $${account.equity.toFixed(2)}`,
        value: account.drawdown,
        threshold: t.alertDrawdown,
      });
    }

    // 2. Equity below alert
    if (t.alertEquityBelow !== null && account.equity < t.alertEquityBelow) {
      fires.push({
        type: 'equity',
        message: `💰 <b>EQUITY ALERT</b>\n\nAccount: <b>${safeName}</b>\nEquity: <b>$${account.equity.toFixed(2)}</b> (threshold: $${t.alertEquityBelow})\nBalance: $${account.balance.toFixed(2)}`,
        value: account.equity,
        threshold: t.alertEquityBelow,
      });
    }

    // 3. Margin level alert
    if (t.alertMarginLevel !== null && account.marginLevel <= t.alertMarginLevel && account.marginLevel > 0) {
      fires.push({
        type: 'margin',
        message: `🔴 <b>MARGIN LEVEL ALERT</b>\n\nAccount: <b>${safeName}</b>\nMargin Level: <b>${account.marginLevel.toFixed(1)}%</b> (threshold: ${t.alertMarginLevel}%)\nFree Margin: $${account.freeMargin.toFixed(2)}`,
        value: account.marginLevel,
        threshold: t.alertMarginLevel,
      });
    }

    for (const fire of fires) {
      const { send } = await shouldSend(
        account.id, fire.type, true, fire.value, fire.threshold, t.alertRepeatMins,
      );
      if (!send) continue;
      const fullMsg = `[OnlyFunds]\n${fire.message}`;
      deliver(userId, account.id, fire.type, fullMsg, telegram)
        .catch(err => console.error('[Alert] deliver failed:', err?.message));
    }

    // A threshold that is set but not breached has to be told so, or it
    // would never stand down and the next real crossing would be silent.
    for (const [type, value, threshold] of [
      ['drawdown', account.drawdown, t.alertDrawdown],
      ['equity', account.equity, t.alertEquityBelow],
      ['margin', account.marginLevel, t.alertMarginLevel],
    ] as [AlertType, number, number | null][]) {
      if (threshold === null) continue;
      if (fires.some(f => f.type === type)) continue;
      await shouldSend(account.id, type, false, value, threshold, t.alertRepeatMins);
    }
  }

  // Also check drawdown protection (auto CLOSE ALL)
  checkDrawdownProtection(userId, accounts)
    .catch(err => console.error('[Alert] drawdownProtection error:', err.message));
};

/**
 * Check offline alert for a specific account.
 * Called from mt5Controller when heartbeat times out.
 */
export const checkOfflineAlert = async (
  userId: string,
  account: Account,
): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      telegramBotToken: true,
      telegramChatId: true,
      accounts: {
        where: { id: account.id },
        select: { alertOffline: true, alertRepeatMins: true },
      },
    },
  });

  if (!user) return;
  const settings = user.accounts[0];
  if (!settings?.alertOffline) return;

  // Offline has no reading to compare, so it is on or it is not: the
  // values below are placeholders. It stands down in checkAlerts, where
  // an account reporting again is what counts as recovered.
  const { send } = await shouldSend(account.id, 'offline', true, 0, 0, settings.alertRepeatMins);
  if (!send) return;

  const telegram = user.telegramBotToken && user.telegramChatId
    ? { token: decrypt(user.telegramBotToken), chatId: user.telegramChatId }
    : null;
  const offlineMsg = `[OnlyFunds]\n📡 <b>OFFLINE ALERT</b>\n\nAccount: <b>${escapeHtml(account.name)}</b>\nNo data received for 30 seconds.`;
  deliver(userId, account.id, 'offline', offlineMsg, telegram)
    .catch(err => console.error('[Alert] deliver failed:', err?.message));
};
