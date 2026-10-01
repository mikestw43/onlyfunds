import prisma from '../lib/prisma';
import { usdRate } from './fxService';

const SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
// A year, not a quarter. The calendar and the statistics pages both offer
// six months, and at 90 days half of what they offered was already deleted —
// silently, by the nightly clean. A year of this account's volume is on the
// order of 80,000 rows, which SQLite does not notice.
const MAX_AGE_DAYS = 365;

// In-memory cache of last snapshot time per account
const lastSnapshot = new Map<string, number>();

/**
 * Record an equity snapshot if enough time has passed since last one.
 */
export const recordSnapshot = async (
  accountId: string,
  equity: number,
  balance: number,
  drawdown: number,
): Promise<void> => {
  const now = Date.now();
  const last = lastSnapshot.get(accountId) || 0;
  if (now - last < SNAPSHOT_INTERVAL_MS) return;

  lastSnapshot.set(accountId, now);
  await prisma.equitySnapshot.create({
    data: { accountId, equity, balance, drawdown },
  });
};

type Timeframe = '1D' | '1W' | '1M' | '3M';

const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1D': 24 * 60 * 60 * 1000,
  '1W': 7 * 24 * 60 * 60 * 1000,
  '1M': 30 * 24 * 60 * 60 * 1000,
  '3M': 90 * 24 * 60 * 60 * 1000,
};

/**
 * Get equity history for a specific account within a timeframe.
 *
 * Scoped to the owner. It used to take the account id alone and hand back
 * whatever it found, so anybody signed in could read any account's equity
 * curve by naming its id.
 */
export const getEquityHistory = async (
  userId: string,
  accountId: string,
  timeframe: Timeframe = '1M',
) => {
  const owned = await prisma.account.findFirst({
    where: { id: accountId, userId },
    select: { id: true },
  });
  if (!owned) return null;

  const cutoff = new Date(Date.now() - TIMEFRAME_MS[timeframe]);
  return prisma.equitySnapshot.findMany({
    where: { accountId, timestamp: { gte: cutoff } },
    orderBy: { timestamp: 'asc' },
    select: { id: true, equity: true, balance: true, drawdown: true, timestamp: true },
  });
};

/** How wide a step the combined curve is drawn in, per timeframe. */
const BUCKET_MS: Record<Timeframe, number> = {
  '1D': 60 * 60 * 1000,
  '1W': 60 * 60 * 1000,
  '1M': 24 * 60 * 60 * 1000,
  '3M': 24 * 60 * 60 * 1000,
};

/**
 * One curve for every account the person has, added up.
 *
 * Not as simple as summing the rows by time. Each account's snapshot is
 * written when its own terminal pushes, so no two accounts share a
 * timestamp, and adding up whatever falls inside a bucket would draw a
 * portfolio that collapses whenever an account happened not to report in
 * that hour — a sawtooth made entirely of missing data.
 *
 * So each account's last known figure is carried forward, and every bucket
 * is the sum of where all of them stood at that moment. Accounts are
 * seeded with their last snapshot from before the window too, otherwise
 * the curve would start near zero and climb as each one first reported,
 * which looks like a portfolio that grew tenfold in an afternoon.
 *
 * Figures are converted to USD, because an account in one currency and an
 * account in another cannot be added up any other way, and the dashboard's
 * totals are USD everywhere else.
 */
export const getPortfolioEquityHistory = async (
  userId: string,
  timeframe: Timeframe = '1M',
) => {
  const accounts = await prisma.account.findMany({
    where: { userId },
    select: { id: true, currency: true },
  });
  if (accounts.length === 0) return [];

  const rate = new Map(accounts.map(a => [a.id, usdRate(a.currency || 'USD')]));
  const ids = accounts.map(a => a.id);
  const cutoff = new Date(Date.now() - TIMEFRAME_MS[timeframe]);

  const [rows, seeds] = await Promise.all([
    prisma.equitySnapshot.findMany({
      where: { accountId: { in: ids }, timestamp: { gte: cutoff } },
      orderBy: { timestamp: 'asc' },
      select: { accountId: true, equity: true, balance: true, timestamp: true },
    }),
    // Where each account stood going into the window.
    Promise.all(ids.map(id => prisma.equitySnapshot.findFirst({
      where: { accountId: id, timestamp: { lt: cutoff } },
      orderBy: { timestamp: 'desc' },
      select: { accountId: true, equity: true, balance: true },
    }))),
  ]);

  const latest = new Map<string, { equity: number; balance: number }>();
  for (const seed of seeds) {
    if (seed) latest.set(seed.accountId, { equity: seed.equity, balance: seed.balance });
  }
  if (rows.length === 0 && latest.size === 0) return [];

  const bucketMs = BUCKET_MS[timeframe];
  const out: { id: string; equity: number; balance: number; drawdown: number; timestamp: Date }[] = [];

  const emit = (at: number) => {
    let equity = 0;
    let balance = 0;
    for (const [id, v] of latest) {
      const r = rate.get(id) ?? 1;
      equity += v.equity * r;
      balance += v.balance * r;
    }
    out.push({
      id: `p-${at}`,
      equity: Math.round(equity * 100) / 100,
      balance: Math.round(balance * 100) / 100,
      // The portfolio's own drawdown, not an average of the accounts'.
      drawdown: balance > 0 ? Math.round(Math.max(0, (balance - equity) / balance * 10000) / 100 * 100) / 100 : 0,
      timestamp: new Date(at),
    });
  };

  let bucket = rows.length
    ? Math.floor(rows[0].timestamp.getTime() / bucketMs) * bucketMs
    : 0;

  for (const row of rows) {
    const b = Math.floor(row.timestamp.getTime() / bucketMs) * bucketMs;
    // Each bucket is closed before the next one's rows are taken in, so a
    // point reports where things stood at the end of that step.
    while (b > bucket) { emit(bucket); bucket += bucketMs; }
    latest.set(row.accountId, { equity: row.equity, balance: row.balance });
  }
  if (rows.length) emit(bucket);

  return out;
};

/**
 * Clean snapshots older than MAX_AGE_DAYS.
 */
export const cleanOldSnapshots = async (): Promise<number> => {
  const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  const result = await prisma.equitySnapshot.deleteMany({
    where: { timestamp: { lt: cutoff } },
  });
  if (result.count > 0) {
    console.log(`[Equity] Cleaned ${result.count} old snapshots`);
  }
  return result.count;
};
