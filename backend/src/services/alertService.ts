import prisma from '../lib/prisma';
import { sendTelegramMessage, escapeHtml } from './telegramService';
import { logNotification } from './notificationLogger';
import { sendPushToUser } from './webPushService';
import { checkDrawdownProtection } from './drawdownProtection';
import { decrypt } from '../lib/encryption';
import type { Account } from '../mock/data';

// Cooldown: Map key = `${accountId}:${alertType}`, value = timestamp of last fire
const cooldowns = new Map<string, number>();
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

type AlertType = 'drawdown' | 'equity' | 'margin' | 'offline';

const isOnCooldown = (accountId: string, type: AlertType): boolean => {
  const key = `${accountId}:${type}`;
  const last = cooldowns.get(key);
  if (!last) return false;
  return Date.now() - last < COOLDOWN_MS;
};

const markFired = (accountId: string, type: AlertType): void => {
  cooldowns.set(`${accountId}:${type}`, Date.now());
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
const plain = (html: string): string =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/^\[OnlyFunds\]\s*/, '')
    .split('\n').map(l => l.trim()).filter(Boolean)
    .join(' · ');

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
    title: 'OnlyFunds',
    body: plain(html),
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
    // Skip offline accounts for drawdown/equity/margin checks
    if (account.status !== 'online') continue;

    const t = thresholds.get(account.id);
    if (!t) continue;

    const fires: Array<{ type: AlertType; message: string }> = [];

    const safeName = escapeHtml(account.name);

    // 1. Drawdown alert
    if (t.alertDrawdown !== null && account.drawdown >= t.alertDrawdown) {
      fires.push({
        type: 'drawdown',
        message: `⚠️ <b>DRAWDOWN ALERT</b>\n\nAccount: <b>${safeName}</b>\nDrawdown: <b>${account.drawdown.toFixed(2)}%</b> (threshold: ${t.alertDrawdown}%)\nEquity: $${account.equity.toFixed(2)}`,
      });
    }

    // 2. Equity below alert
    if (t.alertEquityBelow !== null && account.equity < t.alertEquityBelow) {
      fires.push({
        type: 'equity',
        message: `💰 <b>EQUITY ALERT</b>\n\nAccount: <b>${safeName}</b>\nEquity: <b>$${account.equity.toFixed(2)}</b> (threshold: $${t.alertEquityBelow})\nBalance: $${account.balance.toFixed(2)}`,
      });
    }

    // 3. Margin level alert
    if (t.alertMarginLevel !== null && account.marginLevel <= t.alertMarginLevel && account.marginLevel > 0) {
      fires.push({
        type: 'margin',
        message: `🔴 <b>MARGIN LEVEL ALERT</b>\n\nAccount: <b>${safeName}</b>\nMargin Level: <b>${account.marginLevel.toFixed(1)}%</b> (threshold: ${t.alertMarginLevel}%)\nFree Margin: $${account.freeMargin.toFixed(2)}`,
      });
    }

    for (const fire of fires) {
      if (isOnCooldown(account.id, fire.type)) continue;
      markFired(account.id, fire.type);
      const fullMsg = `[OnlyFunds]\n${fire.message}`;
      deliver(userId, account.id, fire.type, fullMsg, telegram)
        .catch(err => console.error('[Alert] deliver failed:', err?.message));
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
  if (isOnCooldown(account.id, 'offline')) return;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      telegramBotToken: true,
      telegramChatId: true,
      accounts: {
        where: { id: account.id },
        select: { alertOffline: true },
      },
    },
  });

  if (!user) return;
  if (!user.accounts[0]?.alertOffline) return;

  markFired(account.id, 'offline');
  const telegram = user.telegramBotToken && user.telegramChatId
    ? { token: decrypt(user.telegramBotToken), chatId: user.telegramChatId }
    : null;
  const offlineMsg = `[OnlyFunds]\n📡 <b>OFFLINE ALERT</b>\n\nAccount: <b>${escapeHtml(account.name)}</b>\nNo data received for 30 seconds.`;
  deliver(userId, account.id, 'offline', offlineMsg, telegram)
    .catch(err => console.error('[Alert] deliver failed:', err?.message));
};
