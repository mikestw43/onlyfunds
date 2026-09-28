import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { runtimeStore } from '../services/runtimeStore';
import { commandQueue } from '../services/commandQueue';
import { logAudit } from '../services/auditLogger';
import { logCommandQueued } from '../services/commandLog';
import { isReal } from '../mock/simulator';
import { priceRisk, specsFor } from '../services/riskMath';
import { broadcastToUser } from '../websocket/broadcaster';
import prisma from '../lib/prisma';
import type { Account } from '../mock/data';
import { executionRefusal } from '../services/eaBuild';

const router = Router();

router.use(authMiddleware);

router.get('/', (req: AuthRequest, res: Response) => {
  const accounts = runtimeStore.getAccountsByUser(req.user!.id);
  const masked = accounts.map(acc => ({
    ...acc,
    apiKey: '●●●●' + acc.apiKey.slice(-6),
    orders: acc.orders.length,
    pending: acc.pending.length,
  }));
  res.json(masked);
});

// Account limits by role
const ACCOUNT_LIMITS: Record<string, number | null> = {
  user: 1,        // Free tier: 1 account
  vip: null,      // Unlimited
  admin: null,    // Unlimited
};

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { name, broker, accountNumber, apiKey, server, currency, leverage, groupId, isDemo } = req.body as {
      name: string; broker: string; accountNumber: string;
      apiKey: string; server: string; currency: string; leverage: number; groupId?: string; isDemo?: boolean;
    };

    if (!name || !apiKey) {
      res.status(400).json({ error: 'name and apiKey are required' });
      return;
    }

    // Enforce account limit by role
    const role = req.user!.role || 'user';
    const limit = ACCOUNT_LIMITS[role];
    if (limit !== null && limit !== undefined) {
      const existingCount = await prisma.account.count({ where: { userId: req.user!.id } });
      if (existingCount >= limit) {
        res.status(403).json({
          error: `Account limit reached (${limit} for ${role.toUpperCase()} role). Upgrade to VIP for unlimited accounts.`,
        });
        return;
      }
    }

    const newAccount = await runtimeStore.addAccount(req.user!.id, {
      name,
      broker: broker || '',
      accountNumber: accountNumber || '',
      apiKey,
      server: server || 'Unknown',
      currency: currency || 'USD',
      leverage: leverage || 100,
      groupId: groupId || undefined,
      isDemo: isDemo ?? false,
    });
    logAudit(req.user!.id, 'create_account', 'account', newAccount.id,
      JSON.stringify({ name, broker, accountNumber }));

    // Return full API key on creation (only chance to see it — will be masked after this)
    res.status(201).json(newAccount);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[accounts] POST / failed:', message);
    res.status(500).json({ error: `Failed to create account: ${message}` });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const success = await runtimeStore.removeAccount(req.user!.id, id);
  if (success) {
    logAudit(req.user!.id, 'delete_account', 'account', id);
    res.json({ message: 'Account deleted' });
  } else {
    res.status(404).json({ error: 'Account not found' });
  }
});

router.post('/:id/close-all', (req: AuthRequest, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const accounts = runtimeStore.getAccountsByUser(req.user!.id);
  const account = accounts.find(a => a.id === id);

  if (!account || account.status === 'offline') {
    res.status(404).json({ error: 'Account not found or offline' });
    return;
  }

  const orderCount = account.orders.length;
  const pendingCount = account.pending.length;

  logAudit(req.user!.id, 'close_all', 'account', id,
    JSON.stringify({ accountName: account.name, openOrders: orderCount }));

  // Check if this is a real MT5 account or a simulated one
  if (isReal(id)) {
    const refusal = executionRefusal(account);
    if (refusal) {
      res.status(409).json({ error: refusal });
      return;
    }
    // Real account: enqueue command — delivered to the EA on next push (~2s)
    const cmd = commandQueue.enqueue(account.apiKey, {
      type: 'CLOSE_ALL',
      accountId: id,
      userId: req.user!.id,
    });
    logCommandQueued(cmd.id, id, req.user!.id, 'CLOSE_ALL',
      `${orderCount} open, ${pendingCount} pending`);
    res.json({ message: 'Close all command queued', accountId: id, mode: 'queued', commandId: cmd.id });
  } else {
    // Simulated account: execute immediately in memory
    const updated: Account = {
      ...account,
      orders: [],
      pending: [],
      profit: 0,
      equity: account.balance,
      margin: 0,
      freeMargin: account.balance,
      marginLevel: 9999,
      drawdown: 0,
      openLots: 0,
      buyLots: 0,
      sellLots: 0,
      pendingOrders: 0,
    };
    runtimeStore.updateAccount(req.user!.id, updated);
    broadcastToUser(req.user!.id, runtimeStore.getAccountsByUser(req.user!.id));

    console.log(`[CloseAll] Simulated CLOSE_ALL for ${account.name}: cleared ${orderCount} orders + ${pendingCount} pending`);
    res.json({
      message: `Closed ${orderCount} orders, deleted ${pendingCount} pending`,
      accountId: id,
      mode: 'immediate',
      closed: orderCount,
      deleted: pendingCount,
    });
  }
});


/**
 * Whether this account's EA will actually carry out a command.
 *
 * It reports that on every push, and the answer decides whether pressing a
 * button does anything. Refusing here, with the reason, beats queueing a
 * command that gets dropped two seconds later somewhere the person pressing
 * the button cannot see. The wording lives in services/eaBuild so this and
 * the push handler cannot end up giving different advice.
 */

// POST /api/accounts/:id/open-trade — queue an open trade command to the EA
router.post('/:id/open-trade', (req: AuthRequest, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { symbol, action, volume, orderType, price, sl, tp, slPoints, tpPoints } = req.body as {
    symbol: string;
    action: 'BUY' | 'SELL';
    volume: number;
    orderType?: 'market' | 'limit' | 'stop';
    price?: number;
    sl?: number;
    tp?: number;
    /** A stop as a distance. The EA measures it from the price it fills at. */
    slPoints?: number;
    tpPoints?: number;
  };

  if (!symbol || !action || !volume) {
    res.status(400).json({ error: 'symbol, action, and volume are required' });
    return;
  }
  if (action !== 'BUY' && action !== 'SELL') {
    res.status(400).json({ error: 'action must be BUY or SELL' });
    return;
  }

  // An older client sends no orderType and means market unless it sent a
  // price, which is how this worked before limit and stop were told apart.
  const kind = orderType ?? ((price ?? 0) > 0 ? 'limit' : 'market');
  if (kind !== 'market' && kind !== 'limit' && kind !== 'stop') {
    res.status(400).json({ error: 'orderType must be market, limit or stop' });
    return;
  }
  if (kind !== 'market' && !(price && price > 0)) {
    res.status(400).json({ error: `A ${kind} order needs a price` });
    return;
  }

  const accounts = runtimeStore.getAccountsByUser(req.user!.id);
  const account = accounts.find(a => a.id === id);

  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  if (account.status === 'offline') {
    res.status(400).json({ error: 'Account is offline' });
    return;
  }
  if (!isReal(id)) {
    res.status(400).json({ error: 'Cannot trade on simulated accounts' });
    return;
  }

  const refusal = executionRefusal(account);
  if (refusal) {
    res.status(409).json({ error: refusal });
    return;
  }

  const cmd = commandQueue.enqueue(account.apiKey, {
    type: 'OPEN_TRADE',
    accountId: id,
    userId: req.user!.id,
    symbol,
    action,
    volume,
    orderType: kind,
    price: kind === 'market' ? 0 : price ?? 0,
    sl: sl ?? 0,
    tp: tp ?? 0,
    // A distance stays a distance. The EA turns it into a price against
    // the fill, which is the only price that is certainly true.
    ...(slPoints && slPoints > 0 ? { slPoints } : {}),
    ...(tpPoints && tpPoints > 0 ? { tpPoints } : {}),
    // Fixed on purpose. The comment is how a position opened from here is
    // recognised in MT5; letting it be edited only creates positions nobody
    // can account for later.
    comment: 'OnlyFunds',
  });

  logCommandQueued(cmd.id, id, req.user!.id, 'OPEN_TRADE',
    `${action} ${volume} ${symbol}${kind === 'market' ? '' : ` ${kind} @ ${price}`}` +
    `${slPoints ? ` SL ${slPoints}pts` : sl ? ` SL ${sl}` : ''}` +
    `${tpPoints ? ` TP ${tpPoints}pts` : tp ? ` TP ${tp}` : ''}`);
  logAudit(req.user!.id, 'open_trade', 'account', id,
    JSON.stringify({ symbol, action, volume, orderType: kind, price, sl, tp }));

  res.json({ message: 'Open trade command queued', commandId: cmd.id });
});

// POST /api/accounts/:id/close-position — close a single position by ticket
router.post('/:id/close-position', (req: AuthRequest, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  // A volume closes part of the position rather than all of it — EA
  // v1.4 and up. Older EAs ignore the field and close the whole thing,
  // which is what they have always done.
  const { ticket, volume } = req.body as { ticket: number; volume?: number };

  if (!ticket) {
    res.status(400).json({ error: 'ticket is required' });
    return;
  }
  if (volume !== undefined && (!Number.isFinite(volume) || volume < 0 || volume > 1000)) {
    res.status(400).json({ error: 'volume must be a size in lots' });
    return;
  }

  const accounts = runtimeStore.getAccountsByUser(req.user!.id);
  const account = accounts.find(a => a.id === id);

  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  if (account.status === 'offline') {
    res.status(400).json({ error: 'Account is offline' });
    return;
  }
  if (!isReal(id)) {
    res.status(400).json({ error: 'Cannot close positions on simulated accounts' });
    return;
  }

  const refusal = executionRefusal(account);
  if (refusal) {
    res.status(409).json({ error: refusal });
    return;
  }

  const cmd = commandQueue.enqueue(account.apiKey, {
    type: 'CLOSE_POSITION',
    accountId: id,
    userId: req.user!.id,
    ticket,
    ...(volume ? { volume } : {}),
  });

  logCommandQueued(cmd.id, id, req.user!.id, 'CLOSE_POSITION',
    `ticket ${ticket}${volume ? ` · ${volume} lots of it` : ''}`);
  logAudit(req.user!.id, 'close_position', 'account', id, JSON.stringify({ ticket, volume }));
  res.json({ message: 'Close position command queued', commandId: cmd.id });
});

// POST /api/accounts/:id/set-sltp — modify SL/TP for a single position
router.post('/:id/set-sltp', (req: AuthRequest, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { ticket, sl, tp } = req.body as { ticket: number; sl: number; tp: number };

  if (!ticket) {
    res.status(400).json({ error: 'ticket is required' });
    return;
  }

  const accounts = runtimeStore.getAccountsByUser(req.user!.id);
  const account = accounts.find(a => a.id === id);

  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  if (account.status === 'offline') {
    res.status(400).json({ error: 'Account is offline' });
    return;
  }
  if (!isReal(id)) {
    res.status(400).json({ error: 'Cannot modify positions on simulated accounts' });
    return;
  }

  const refusal = executionRefusal(account);
  if (refusal) {
    res.status(409).json({ error: refusal });
    return;
  }

  const cmd = commandQueue.enqueue(account.apiKey, {
    type: 'SET_SLTP',
    accountId: id,
    userId: req.user!.id,
    ticket,
    sl: sl ?? 0,
    tp: tp ?? 0,
  });

  logCommandQueued(cmd.id, id, req.user!.id, 'SET_SLTP',
    `ticket ${ticket}${sl ? ` SL ${sl}` : ''}${tp ? ` TP ${tp}` : ''}`);
  logAudit(req.user!.id, 'set_sltp', 'account', id, JSON.stringify({ ticket, sl, tp }));
  res.json({ message: 'Set SL/TP command queued', commandId: cmd.id });
});

// GET /api/accounts/:id/commands/:commandId — what became of one command
//
// The dashboard used to stop at "queued". This is how it finds out whether
// the EA opened the position, what ticket it got, or which broker error
// refused it — so the person who pressed the button gets the answer rather
// than a hopeful message.
router.get('/:id/commands/:commandId', async (req: AuthRequest, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const commandId = Array.isArray(req.params.commandId) ? req.params.commandId[0] : req.params.commandId;

  const row = await prisma.commandLog.findUnique({ where: { commandId } });
  if (!row || row.accountId !== id || row.userId !== req.user!.id) {
    res.status(404).json({ error: 'Command not found' });
    return;
  }

  res.json({
    commandId: row.commandId,
    type: row.type,
    detail: row.detail,
    status: row.status,      // queued | sent | done | failed | dropped
    result: row.result,
    createdAt: row.createdAt,
    settledAt: row.settledAt,
  });
});

// GET /api/accounts/:id/commands — the last 20, newest first
router.get('/:id/commands', async (req: AuthRequest, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const rows = await prisma.commandLog.findMany({
    where: { accountId: id, userId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  res.json(rows);
});

/**
 * POST /api/accounts/:id/risk — what a plan would cost if it went wrong
 *
 * The card in the chat shows this before anything is sent. It is worked
 * out here, from the terminal's own figures, rather than taken from the
 * model: a language model multiplying tick values on a cent account is
 * usually right, and "usually" is the wrong standard for the number
 * that says how much of an account is on the table.
 */
router.post('/:id/risk', async (req: AuthRequest, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const rows = (req.body as { rows?: unknown }).rows;

  const account = runtimeStore.getAccountsByUser(req.user!.id).find(a => a.id === id);
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  if (!Array.isArray(rows)) {
    res.status(400).json({ error: 'rows must be an array' });
    return;
  }

  const wanted = rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .slice(0, 20)
    .map(r => ({
      symbol: String(r.symbol ?? ''),
      side: r.side === 'sell' ? 'sell' as const : 'buy' as const,
      entry: Number(r.entry) || undefined,
      sl: Number(r.sl) || undefined,
      tp: Number(r.tp) || undefined,
      slPoints: Number(r.slPoints) || undefined,
      tpPoints: Number(r.tpPoints) || undefined,
      lots: Number(r.lots) || 0,
    }));

  res.json(await priceRisk(id, wanted, account.equity ?? null, account.currency || 'USD'));
});

/**
 * GET /api/accounts/:id/specs — the terminal's own figures per symbol
 *
 * Sent by EA v1.4 every few minutes for the symbols in use: the live bid
 * and ask, how many decimals the broker quotes, what one point is worth in
 * price, the volume steps and a 14-day ATR.
 *
 * The NEW TRADE box needs them to fill anything in for you. "A stop 1000
 * points away" is 10.00 on a two-decimal gold and 0.01000 on a five-decimal
 * pair, and the only place that difference is known for certain is the
 * terminal. An account still on an older EA sends none, and the box simply
 * leaves those fields empty rather than guessing.
 */
router.get('/:id/specs', (req: AuthRequest, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const account = runtimeStore.getAccountsByUser(req.user!.id).find(a => a.id === id);
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  void specsFor(id).then(specs => res.json({ specs })).catch(() => res.json({ specs: [] }));
});

// GET /api/accounts/:id/symbols — what this account can be asked to trade
//
// Every symbol the broker has shown us for this account: what is open now,
// what is waiting as a pending order, and everything closed in the stored
// history. That is not the broker's whole Market Watch — the reporter EA
// does not send one — but it is every instrument this account has actually
// touched, which is what someone typing into the box is reaching for.
// The field stays free text, so a symbol we have never seen can still be
// typed in full.
router.get('/:id/symbols', async (req: AuthRequest, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const account = runtimeStore.getAccountsByUser(req.user!.id).find(a => a.id === id);
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  const live = [
    ...(account.orders ?? []).map(o => o.symbol),
    ...(account.pending ?? []).map(o => o.symbol),
  ];

  const [row, traded] = await Promise.all([
    prisma.account.findUnique({ where: { id }, select: { symbols: true, symbolsAt: true } }),
    prisma.closedTrade.findMany({
      where: { accountId: id },
      select: { symbol: true },
      distinct: ['symbol'],
    }),
  ]);

  // The broker's own list when the EA has sent one, and what this account has
  // touched either way — so the box is useful before the EA is updated, and
  // complete afterwards.
  const fromBroker = Array.isArray(row?.symbols) ? (row!.symbols as string[]) : [];

  const symbols = [...new Set([...fromBroker, ...live, ...traded.map(t => t.symbol)])]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  res.json({
    symbols,
    // What the list is made of, so the dialog can say whether it is the
    // broker's own or only this account's history.
    fromBroker: fromBroker.length,
    brokerListAt: row?.symbolsAt ?? null,
  });
});

// GET /api/accounts/:id/apikey — reveal full API key (for copy)
router.get('/:id/apikey', async (req: AuthRequest, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const dbAccount = await prisma.account.findFirst({
    where: { id, userId: req.user!.id },
    select: { apiKey: true },
  });
  if (!dbAccount) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  res.json({ apiKey: dbAccount.apiKey });
});

// GET /api/accounts/:id/alerts — fetch alert thresholds
router.get('/:id/alerts', async (req: AuthRequest, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const dbAccount = await prisma.account.findFirst({
    where: { id, userId: req.user!.id },
    select: {
      id: true,
      alertDrawdown: true,
      alertEquityBelow: true,
      alertMarginLevel: true,
      alertOffline: true,
    },
  });
  if (!dbAccount) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  res.json(dbAccount);
});

/**
 * PATCH /api/accounts/:id/ai-trade — may the assistant send orders here
 * without anybody pressing confirm?
 *
 * Off everywhere until it is switched on, and meant for a practice
 * account: it is the difference between watching a model draft orders
 * and watching it trade. The EA's own limits still apply — they live in
 * the terminal, and no setting here can raise them.
 */
router.patch('/:id/ai-trade', async (req: AuthRequest, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { enabled } = req.body as { enabled?: boolean };

  const dbAccount = await prisma.account.findFirst({ where: { id, userId: req.user!.id } });
  if (!dbAccount) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  const updated = await prisma.account.update({
    where: { id },
    data: { aiAutoTrade: !!enabled },
    select: { id: true, aiAutoTrade: true, isDemo: true, name: true },
  });

  // The runtime copy is what every screen reads, so it has to learn
  // about this too — the live figures on it stay as they are.
  const live = runtimeStore.getAccountsByUser(req.user!.id).find(a => a.id === id);
  if (live) runtimeStore.updateAccount(req.user!.id, { ...live, aiAutoTrade: updated.aiAutoTrade });
  logAudit(req.user!.id, 'ai_auto_trade', 'account', id,
    JSON.stringify({ name: updated.name, demo: updated.isDemo, enabled: updated.aiAutoTrade }));

  res.json(updated);
});

// PATCH /api/accounts/:id/alerts — save alert thresholds
router.patch('/:id/alerts', async (req: AuthRequest, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { alertDrawdown, alertEquityBelow, alertMarginLevel, alertOffline } = req.body as {
    alertDrawdown?: number | null;
    alertEquityBelow?: number | null;
    alertMarginLevel?: number | null;
    alertOffline?: boolean;
  };

  // Verify account belongs to this user
  const dbAccount = await prisma.account.findFirst({
    where: { id, userId: req.user!.id },
  });
  if (!dbAccount) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  const updated = await prisma.account.update({
    where: { id },
    data: {
      ...(alertDrawdown !== undefined && { alertDrawdown }),
      ...(alertEquityBelow !== undefined && { alertEquityBelow }),
      ...(alertMarginLevel !== undefined && { alertMarginLevel }),
      ...(alertOffline !== undefined && { alertOffline }),
    },
    select: {
      id: true,
      alertDrawdown: true,
      alertEquityBelow: true,
      alertMarginLevel: true,
      alertOffline: true,
    },
  });

  logAudit(req.user!.id, 'update_alerts', 'account', id, JSON.stringify(updated));

  res.json(updated);
});

export default router;
