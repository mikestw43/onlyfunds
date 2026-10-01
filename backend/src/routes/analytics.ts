import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import prisma from '../lib/prisma';
import { getEquityHistory, getPortfolioEquityHistory } from '../services/equityService';
import { getTradeHistory, getTradedSymbols } from '../services/tradeHistoryService';
import { getDailyPnL, getPerformanceMetrics } from '../services/analyticsService';

const router = Router();

router.use(authMiddleware);

// GET /api/analytics/equity/:accountId?timeframe=1D|1W|1M|3M
// The id "all" is every account the person has, added up.
router.get('/equity/:accountId', async (req: AuthRequest, res: Response) => {
  const accountId = Array.isArray(req.params.accountId)
    ? req.params.accountId[0]
    : req.params.accountId;
  const timeframe = (req.query.timeframe as string) || '1M';

  if (!['1D', '1W', '1M', '3M'].includes(timeframe)) {
    res.status(400).json({ error: 'Invalid timeframe. Use 1D, 1W, 1M, or 3M.' });
    return;
  }
  const tf = timeframe as '1D' | '1W' | '1M' | '3M';

  if (accountId === 'all') {
    res.json(await getPortfolioEquityHistory(req.user!.id, tf));
    return;
  }

  const snapshots = await getEquityHistory(req.user!.id, accountId, tf);
  // Null means it is not theirs. Said as "not found" rather than
  // "forbidden", which would confirm the id names a real account.
  if (snapshots === null) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  res.json(snapshots);
});

// GET /api/analytics/trades?accountId=&page=&limit=&symbol=&type=&sortBy=&sortDir=&dateFrom=&dateTo=
router.get('/trades', async (req: AuthRequest, res: Response) => {
  const { accountId, page, limit, symbol, type, sortBy, sortDir, dateFrom, dateTo } = req.query as Record<string, string>;

  const result = await getTradeHistory(req.user!.id, accountId || undefined, {
    page: page ? parseInt(page) : undefined,
    limit: limit ? parseInt(limit) : undefined,
    symbol: symbol || undefined,
    type: type || undefined,
    sortBy: sortBy || undefined,
    sortDir: (sortDir as 'asc' | 'desc') || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  res.json(result);
});

// GET /api/analytics/trades/symbols?accountId=
// The symbols to offer in the trade-history filter.
router.get('/trades/symbols', async (req: AuthRequest, res: Response) => {
  const accountId = req.query.accountId as string | undefined;
  res.json(await getTradedSymbols(req.user!.id, accountId || undefined));
});

// GET /api/analytics/pnl?accountId=&period=1M|3M|6M
router.get('/pnl', async (req: AuthRequest, res: Response) => {
  const accountId = req.query.accountId as string | undefined;
  const period = (req.query.period as string) || '3M';

  if (!['1M', '3M', '6M'].includes(period)) {
    res.status(400).json({ error: 'Invalid period. Use 1M, 3M, or 6M.' });
    return;
  }

  // Per-user timezone drives day bucketing so calendar cells match what
  // the user sees on their clock — not UTC.
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { timezone: true },
  });
  const tz = user?.timezone || 'Asia/Bangkok';

  const pnl = await getDailyPnL(
    req.user!.id,
    accountId || undefined,
    period as '1M' | '3M' | '6M',
    tz,
  );
  res.json(pnl);
});

// GET /api/analytics/performance?accountId=
router.get('/performance', async (req: AuthRequest, res: Response) => {
  const accountId = req.query.accountId as string | undefined;
  const metrics = await getPerformanceMetrics(req.user!.id, accountId || undefined);
  res.json(metrics);
});

export default router;
