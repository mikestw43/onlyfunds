import { Request, Response } from 'express';
import { runtimeStore } from '../services/runtimeStore';
import { broadcastToUser } from '../websocket/broadcaster';
import { checkAlerts, checkOfflineAlert } from '../services/alertService';
import { commandQueue } from '../services/commandQueue';
import { sendCloseAllNotification } from '../services/commandNotifier';
import { detectClosedTrades, recordClosedDeals } from '../services/tradeHistoryService';
import { recordDailyPnl } from '../services/dailyPnlService';
import { recordSnapshot } from '../services/equityService';
import { markAsReal, unmarkAsReal } from '../mock/simulator';
import prisma from '../lib/prisma';
import { dropCommands, markCommandsSent, settleCommand } from '../services/commandLog';
import type { Account, Order, PendingOrder } from '../mock/data';
import { executionRefusal } from '../services/eaBuild';

interface MT5PushPayload {
  apiKey: string;
  accountNumber: string;
  name?: string;
  broker?: string;
  server?: string;
  currency?: string;
  leverage?: number;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number;
  profit: number;
  orders: {
    ticket: number;
    symbol: string;
    type: number;
    lots: number;
    openPrice: number;
    currentPrice: number;
    profit: number;
    swap: number;
    commission: number;
    openTime: string;
    sl: number;
    tp: number;
  }[];
  pending: {
    ticket: number;
    symbol: string;
    type: number;
    lots: number;
    openPrice: number;
    sl: number;
    tp: number;
    expiration: string;
  }[];
  brokerTimeOffset?: number;
  /// Every symbol the broker offers, sent occasionally rather than on every
  /// tick — see storeSymbols below.
  symbols?: string[];
  specs?: SymbolSpec[];
  canPartialClose?: boolean;
  /// Set by an EA that will carry out commands. Absent from every reporter
  /// before v1.3, and from v1.3 with trading switched off.
  canExecute?: boolean;
  eaVersion?: string;
  todayPnl?: number;
  closedOrdersToday?: number;
  closedDeals?: {
    positionId: number;
    ticket: number;
    symbol: string;
    type: number;
    lots: number;
    openPrice: number;
    closePrice: number;
    profit: number;
    swap: number;
    commission: number;
    openTime: string;
    closeTime: string;
  }[];
}

const ORDER_TYPE_MAP: Record<number, Order['type']> = {
  0: 'BUY',
  1: 'SELL',
};

const PENDING_TYPE_MAP: Record<number, PendingOrder['type']> = {
  2: 'BUY_LIMIT',
  3: 'SELL_LIMIT',
  4: 'BUY_STOP',
  5: 'SELL_STOP',
  6: 'BUY_STOP_LIMIT',
  7: 'SELL_STOP_LIMIT',
};

/**
 * Keep the broker's symbol list.
 *
 * A reporter that sends it is sending a few hundred names, so it sends them
 * rarely; this writes only when the list actually differs from the one on
 * record, which makes a repeat push free. Names are capped and cleaned here
 * rather than trusted: this arrives from an EA over the open internet, and
 * it ends up in a dropdown.
 */
const SYMBOL_LIMIT = 2000;

const storeSymbols = async (accountId: string, incoming: unknown): Promise<void> => {
  if (!Array.isArray(incoming)) return;

  const clean = [...new Set(
    incoming
      .filter((s): s is string => typeof s === 'string')
      .map(s => s.trim())
      .filter(s => s.length > 0 && s.length <= 32),
  )].sort((a, b) => a.localeCompare(b)).slice(0, SYMBOL_LIMIT);

  if (clean.length === 0) return;

  try {
    const row = await prisma.account.findUnique({
      where: { id: accountId },
      select: { symbols: true },
    });
    const current = Array.isArray(row?.symbols) ? (row!.symbols as string[]) : [];
    if (current.length === clean.length && current.every((s, i) => s === clean[i])) return;

    await prisma.account.update({
      where: { id: accountId },
      data: { symbols: clean, symbolsAt: new Date() },
    });
    console.log(`[MT5] Symbol list updated for ${accountId}: ${clean.length} symbols`);
  } catch (err) {
    console.error('[MT5] Failed to store symbols:', (err as Error).message);
  }
};

/**
 * What a lot of a symbol is worth, as the terminal reports it.
 *
 * The dashboard cannot work out a position size without these. A lot of
 * gold is 100 ounces and a lot of silver is 5,000; a point is worth a
 * different amount on each, and on a cent account a hundredth of what it
 * looks like. EA v1.4 and up send them for the symbols in use.
 */
export interface SymbolSpec {
  symbol: string;
  bid: number;
  ask: number;
  digits: number;
  point: number;
  contractSize: number;
  tickValue: number;
  tickSize: number;
  volMin: number;
  volMax: number;
  volStep: number;
  stopsLevel: number;
  atr14: number;
}

const SPEC_LIMIT = 40;

const storeSpecs = async (accountId: string, incoming: unknown): Promise<void> => {
  if (!Array.isArray(incoming) || incoming.length === 0) return;

  const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const clean: SymbolSpec[] = incoming
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .filter(r => typeof r.symbol === 'string' && (r.symbol as string).length > 0)
    .slice(0, SPEC_LIMIT)
    .map(r => ({
      symbol: String(r.symbol).slice(0, 32),
      bid: num(r.bid),
      ask: num(r.ask),
      digits: num(r.digits),
      point: num(r.point),
      contractSize: num(r.contractSize),
      tickValue: num(r.tickValue),
      tickSize: num(r.tickSize),
      volMin: num(r.volMin),
      volMax: num(r.volMax),
      volStep: num(r.volStep),
      stopsLevel: num(r.stopsLevel),
      atr14: num(r.atr14),
    }));

  if (clean.length === 0) return;

  try {
    // Written every time rather than only on change: bid and ask are in
    // here, and a stale price is worse than no price when the number is
    // used to decide between a limit and a stop.
    await prisma.account.update({
      where: { id: accountId },
      data: { specs: clean as unknown as object, specsAt: new Date() },
    });
  } catch (err) {
    console.error('[MT5] Failed to store symbol specs:', (err as Error).message);
  }
};

export const receiveMT5Push = (req: Request, res: Response): void => {
  const payload = req.body as MT5PushPayload;

  if (!payload.apiKey) {
    res.status(400).json({ error: 'apiKey is required' });
    return;
  }

  const result = runtimeStore.findAccountByApiKey(payload.apiKey);

  if (!result) {
    res.status(404).json({ error: 'Account not found. Add it via dashboard first.' });
    return;
  }

  const { account, userId } = result;

  const orders: Order[] = (payload.orders || []).map(o => ({
    ticket: o.ticket,
    symbol: o.symbol,
    type: ORDER_TYPE_MAP[o.type] ?? 'BUY',
    lots: o.lots,
    openPrice: o.openPrice,
    currentPrice: o.currentPrice,
    profit: o.profit,
    swap: o.swap ?? 0,
    commission: o.commission ?? 0,
    openTime: o.openTime,
    sl: o.sl,
    tp: o.tp,
  }));

  const pending: PendingOrder[] = (payload.pending || []).map(p => ({
    ticket: p.ticket,
    symbol: p.symbol,
    type: PENDING_TYPE_MAP[p.type] ?? 'BUY_LIMIT',
    lots: p.lots,
    openPrice: p.openPrice,
    sl: p.sl,
    tp: p.tp,
    expiration: p.expiration || null,
  }));

  const buyLots = orders.filter(o => o.type === 'BUY').reduce((s, o) => s + o.lots, 0);
  const sellLots = orders.filter(o => o.type === 'SELL').reduce((s, o) => s + o.lots, 0);

  // Floating P/L = sum of open positions' profit + swap.
  // Don't trust payload.profit — older EAs compute it as `equity - balance`
  // which incorrectly includes credit bonus when the account has any.
  // Summing the orders payload sidesteps that bug regardless of EA version.
  const floatingProfit = parseFloat(
    orders.reduce((s, o) => s + (o.profit ?? 0) + (o.swap ?? 0), 0).toFixed(2),
  );

  const drawdown = payload.equity < payload.balance
    ? parseFloat(((payload.balance - payload.equity) / payload.balance * 100).toFixed(2))
    : 0;

  const updated: Account = {
    ...account,
    status: 'online',
    balance: payload.balance,
    equity: payload.equity,
    margin: payload.margin,
    freeMargin: payload.freeMargin,
    marginLevel: payload.marginLevel,
    profit: floatingProfit,
    drawdown,
    openLots: parseFloat((buyLots + sellLots).toFixed(2)),
    buyLots: parseFloat(buyLots.toFixed(2)),
    sellLots: parseFloat(sellLots.toFixed(2)),
    pendingOrders: pending.length,
    orders,
    pending,
    // Update runtime fields from MT5 push (always take latest from EA)
    ...(payload.broker && { broker: payload.broker }),
    ...(payload.server && { server: payload.server }),
    ...(payload.leverage && { leverage: payload.leverage }),
    ...(payload.currency && { currency: payload.currency }),
    ...(payload.accountNumber && { accountNumber: payload.accountNumber }),
    ...(payload.brokerTimeOffset != null && { brokerTimeOffset: payload.brokerTimeOffset }),
    ...(payload.todayPnl != null && { todayPnl: parseFloat(payload.todayPnl.toFixed(2)) }),
    ...(payload.closedOrdersToday != null && { closedOrdersToday: payload.closedOrdersToday }),
    // Reported every push, so switching EnableTrading off in the terminal
    // shows in the dashboard within two seconds rather than at the next
    // restart. Absent means no: a reporter that cannot execute must never
    // be handed a command.
    canExecute: payload.canExecute === true,
    ...(payload.eaVersion && { eaVersion: payload.eaVersion }),
  };

  // Trace EA-reported today P/L (helps verify EA→backend handoff in prod logs)
  if (payload.todayPnl != null) {
    console.log(
      `[MT5] ${account.name} todayPnl=${payload.todayPnl.toFixed(2)} (${payload.closedOrdersToday ?? 0} deals)`
    );
    // Keep it, don't just display it. This is MT5's own realized total for the
    // broker day; the calendar shows it instead of re-deriving the day from the
    // trades we happened to store.
    recordDailyPnl(
      account.id,
      payload.todayPnl,
      payload.closedOrdersToday ?? 0,
      payload.brokerTimeOffset ?? 7200,
    ).catch(err => console.error('[DailyPnl] record error:', err.message));
  }

  // Persist MT5 account details to DB if they were empty (first-time connection)
  const needsDbUpdate =
    (payload.accountNumber && (!account.accountNumber || account.accountNumber === '')) ||
    (payload.broker        && (!account.broker        || account.broker        === '')) ||
    (payload.currency      && (!account.currency      || account.currency      === 'USD')) ||
    (payload.server        && (!account.server        || account.server        === 'Unknown')) ||
    (payload.leverage      && (!account.leverage      || account.leverage      === 100));

  if (needsDbUpdate) {
    prisma.account.update({
      where: { id: account.id },
      data: {
        ...(payload.accountNumber && { accountNumber: payload.accountNumber }),
        ...(payload.broker        && { broker: payload.broker }),
        ...(payload.currency      && { currency: payload.currency }),
        ...(payload.server        && { server: payload.server }),
        ...(payload.leverage      && { leverage: payload.leverage }),
      },
    }).catch(err => console.error('[MT5] Failed to persist account details:', err.message));
  }

  persistSnapshot(updated);

  // Record closed trades: prefer EA-reported deals (exact P/L), fallback to position diff
  if (payload.closedDeals && payload.closedDeals.length > 0) {
    const brokerOffset = payload.brokerTimeOffset ?? 7200;
    console.log(`[TradeHistory] ${account.name} — ${payload.closedDeals.length} closed deal(s) from EA`);
    recordClosedDeals(account.id, payload.closedDeals, brokerOffset)
      .catch(err => console.error('[TradeHistory] recordClosedDeals error:', err.message));
  }
  // Only when the EA sent no deal report of its own. Guessing a close from a
  // position that vanished gives the wrong close time — the moment we noticed,
  // not the moment it closed — and the last floating profit, which is missing
  // the commission booked at the close. It is a fallback for old EAs, so it
  // runs only when the accurate source is absent.
  if (!payload.closedDeals) {
    detectClosedTrades(account.id, orders)
      .catch(err => console.error('[TradeHistory] detectClosedTrades error:', err.message));
  }

  runtimeStore.updateAccount(userId, updated);
  broadcastToUser(userId, runtimeStore.getAccountsByUser(userId));

  // Record equity snapshot (sampled 1x/hour)
  recordSnapshot(account.id, payload.equity, payload.balance, drawdown)
    .catch(err => console.error('[Equity] recordSnapshot error:', err.message));

  // Check alert conditions with fresh data
  checkAlerts(userId, runtimeStore.getAccountsByUser(userId))
    .catch(err => console.error('[Alert] checkAlerts error:', err.message));

  markAsReal(account.id);
  resetHeartbeat(account.id, userId);

  // Fire and forget: a symbol list that fails to store must not fail a push
  // carrying the account's money.
  void storeSymbols(account.id, payload.symbols);
  void storeSpecs(account.id, payload.specs);

  // Drain any pending commands for this apiKey
  const commands = commandQueue.drain(payload.apiKey);

  const response: Record<string, unknown> = {
    ok: true,
    accountId: account.id,
    orders: orders.length,
    pending: pending.length,
  };

  if (commands.length > 0 && payload.canExecute !== true) {
    // Nothing on the other end will run these. Holding them would be worse
    // than dropping them: an order that waits for somebody to switch
    // trading on is an order placed at a price that has moved on. The
    // dashboard reads the reason from the command log.
    const why = executionRefusal({ canExecute: false, eaVersion: payload.eaVersion })
      ?? 'The EA on this account will not carry out orders';
    console.warn(`[MT5] Dropped ${commands.length} command(s) for ${account.name}: ${why}`);
    dropCommands(commands.map(c => c.id), why);
  } else if (commands.length > 0) {
    // Send full command payload so EA can execute correctly
    response.commands = commands.map(cmd => {
      // The EA drops anything older than its CommandMaxAgeSec: an order
      // that waited out a dropped connection is an order at a price that
      // has moved. It needs the age from us, since its own clock is the
      // broker's.
      const c: Record<string, unknown> = { id: cmd.id, type: cmd.type, ageSec: Math.round((Date.now() - cmd.createdAt) / 1000) };
      if (cmd.symbol   != null) c.symbol  = cmd.symbol;
      if (cmd.action   != null) c.action  = cmd.action;
      if (cmd.volume   != null) c.volume  = cmd.volume;
      if (cmd.orderType!= null) c.orderType = cmd.orderType;
      if (cmd.price    != null) c.price   = cmd.price;
      if (cmd.sl       != null) c.sl      = cmd.sl;
      if (cmd.tp       != null) c.tp      = cmd.tp;
      if (cmd.comment  != null) c.comment = cmd.comment;
      if (cmd.ticket   != null) c.ticket  = cmd.ticket;
      return c;
    });

    for (const cmd of commands) {
      if (cmd.type === 'CLOSE_ALL') {
        sendCloseAllNotification(cmd.userId, account.name, orders.length)
          .catch(err => console.error('[CmdNotify] Telegram send failed:', err.message));
      }
    }

    markCommandsSent(commands.map(c => c.id));
    console.log(`[MT5] Sent ${commands.length} command(s) to ${account.name}: ${commands.map(c => c.type).join(', ')}`);
  }

  res.json(response);
};

/**
 * Write an account's live figures to the DB so they survive an API restart.
 *
 * The EA pushes every 2s; SQLite does not need that. One write per account
 * per SNAPSHOT_INTERVAL_MS is enough to keep the stored copy close, and the
 * heartbeat flushes a final one when the account drops offline so what we
 * keep is the last thing the EA actually reported.
 */
const SNAPSHOT_INTERVAL_MS = 30_000;
const lastSnapshotAt = new Map<string, number>();

const persistSnapshot = (account: Account, force = false): void => {
  const now = Date.now();
  if (!force && now - (lastSnapshotAt.get(account.id) ?? 0) < SNAPSHOT_INTERVAL_MS) return;
  lastSnapshotAt.set(account.id, now);

  prisma.account.update({
    where: { id: account.id },
    data: {
      balance: account.balance,
      equity: account.equity,
      margin: account.margin,
      freeMargin: account.freeMargin,
      marginLevel: account.marginLevel,
      profit: account.profit,
      drawdown: account.drawdown,
      openLots: account.openLots,
      buyLots: account.buyLots,
      sellLots: account.sellLots,
      pendingOrders: account.pendingOrders,
      todayPnl: account.todayPnl ?? null,
      closedOrdersToday: account.closedOrdersToday ?? null,
      brokerTimeOffset: account.brokerTimeOffset ?? null,
      lastPushAt: new Date(),
    },
  }).catch(err => console.error('[MT5] Failed to persist snapshot:', err.message));
};

const heartbeats = new Map<string, ReturnType<typeof setTimeout>>();

const resetHeartbeat = (accountId: string, userId: string): void => {
  const existing = heartbeats.get(accountId);
  if (existing) clearTimeout(existing);

  heartbeats.set(accountId, setTimeout(() => {
    const accounts = runtimeStore.getAccountsByUser(userId);
    const account = accounts.find(a => a.id === accountId);
    if (account && account.status === 'online') {
      console.log(`[MT5] Account ${account.name} went offline (no push for 30s)`);
      const updated: Account = { ...account, status: 'offline' };
      runtimeStore.updateAccount(userId, updated);
      persistSnapshot(updated, true);
      broadcastToUser(userId, runtimeStore.getAccountsByUser(userId));
      // Fire offline alert
      checkOfflineAlert(userId, updated)
        .catch(err => console.error('[Alert] checkOfflineAlert error:', err.message));
      unmarkAsReal(accountId);
    }
    heartbeats.delete(accountId);
  }, 30000));
};

/**
 * POST /api/mt5/ack — what the EA did with the commands it was handed.
 *
 * Without this the dashboard's last word on a trade is "queued", which says
 * nothing about whether a position exists. The EA reports each command's
 * outcome here: the ticket it opened, or the reason the broker or its own
 * limits refused it.
 *
 * Authenticated the same way as the push — by the account's API key in the
 * body — because it comes from the same EA, over the same connection, with
 * no session to carry.
 */
export const receiveMT5Ack = async (req: Request, res: Response): Promise<void> => {
  const payload = req.body as {
    apiKey?: string;
    results?: { id?: string; ok?: boolean; ticket?: number; error?: string }[];
  };

  if (!payload.apiKey) {
    res.status(400).json({ error: 'apiKey is required' });
    return;
  }

  const found = runtimeStore.findAccountByApiKey(payload.apiKey);
  if (!found) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  const results = Array.isArray(payload.results) ? payload.results.slice(0, 50) : [];
  let settled = 0;

  for (const r of results) {
    if (!r || typeof r.id !== 'string') continue;
    const ok = r.ok === true;
    const detail = ok
      ? (r.ticket ? `ticket ${r.ticket}` : 'done')
      : (r.error || 'refused, no reason given').slice(0, 300);
    await settleCommand(r.id, ok, detail);
    settled += 1;
    console.log(`[MT5] ${found.account.name} ${ok ? 'executed' : 'refused'} ${r.id}: ${detail}`);
  }

  res.json({ ok: true, settled });
};
