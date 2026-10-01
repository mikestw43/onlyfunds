import prisma from '../lib/prisma';
import { commandQueue } from './commandQueue';
import type { Account, Order, PendingOrder } from '../mock/data';

const makePastTime = (minutesAgo: number) => {
  const d = new Date(Date.now() - minutesAgo * 60 * 1000);
  return d.toISOString();
};

// Demo mock orders to populate on startup (same as original mock/data.ts)
const DEMO_ORDERS: Record<string, { orders: Order[]; pending: PendingOrder[]; status: Account['status']; balance: number; equity: number; margin: number; freeMargin: number; marginLevel: number; drawdown: number; profit: number; openLots: number; buyLots: number; sellLots: number; pendingOrders: number }> = {
  'xm_live_demo_gold_scalper_001': {
    status: 'online', balance: 5000, equity: 5243.5, margin: 432.1, freeMargin: 4811.4, marginLevel: 1213.7, drawdown: 4.2, profit: 243.5, openLots: 1.2, buyLots: 0.8, sellLots: 0.4, pendingOrders: 2,
    orders: [
      { ticket: 10001, symbol: 'XAUUSD', type: 'BUY', lots: 0.5, openPrice: 2310.5, currentPrice: 2318.2, profit: 385.0, swap: 0, commission: 0, openTime: makePastTime(45), sl: 2290.0, tp: 2350.0 },
      { ticket: 10002, symbol: 'XAUUSD', type: 'BUY', lots: 0.3, openPrice: 2315.0, currentPrice: 2318.2, profit: 96.0, swap: 0, commission: 0, openTime: makePastTime(20), sl: 2300.0, tp: 2340.0 },
      { ticket: 10003, symbol: 'EURUSD', type: 'SELL', lots: 0.4, openPrice: 1.0850, currentPrice: 1.0832, profit: 72.0, swap: 0, commission: 0, openTime: makePastTime(90), sl: 1.0900, tp: 1.0780 },
    ],
    pending: [
      { ticket: 20001, symbol: 'XAUUSD', type: 'BUY_LIMIT', lots: 0.5, openPrice: 2295.0, sl: 2280.0, tp: 2340.0, expiration: null },
      { ticket: 20002, symbol: 'XAUUSD', type: 'SELL_STOP', lots: 0.3, openPrice: 2280.0, sl: 2295.0, tp: 2250.0, expiration: null },
    ],
  },
  'ex_live_demo_grid_trader_002': {
    status: 'offline', balance: 10000, equity: 9543.2, margin: 890.5, freeMargin: 8652.7, marginLevel: 1071.6, drawdown: 4.6, profit: -456.8, openLots: 3.5, buyLots: 2.0, sellLots: 1.5, pendingOrders: 4,
    orders: [
      { ticket: 10010, symbol: 'GBPUSD', type: 'BUY', lots: 1.0, openPrice: 1.2710, currentPrice: 1.2695, profit: -150.0, swap: 0, commission: 0, openTime: makePastTime(180), sl: 1.2650, tp: 1.2800 },
      { ticket: 10011, symbol: 'GBPUSD', type: 'BUY', lots: 1.0, openPrice: 1.2690, currentPrice: 1.2695, profit: 50.0, swap: 0, commission: 0, openTime: makePastTime(120), sl: 1.2630, tp: 1.2780 },
      { ticket: 10012, symbol: 'USDJPY', type: 'SELL', lots: 1.5, openPrice: 154.20, currentPrice: 154.55, profit: -356.8, swap: 0, commission: 0, openTime: makePastTime(240), sl: 155.00, tp: 153.00 },
    ],
    pending: [
      { ticket: 20010, symbol: 'GBPUSD', type: 'BUY_LIMIT', lots: 1.0, openPrice: 1.2670, sl: 1.2620, tp: 1.2760, expiration: null },
      { ticket: 20011, symbol: 'GBPUSD', type: 'BUY_LIMIT', lots: 1.0, openPrice: 1.2650, sl: 1.2600, tp: 1.2740, expiration: null },
      { ticket: 20012, symbol: 'USDJPY', type: 'SELL_STOP', lots: 1.5, openPrice: 155.50, sl: 156.00, tp: 153.00, expiration: null },
      { ticket: 20013, symbol: 'USDJPY', type: 'SELL_STOP', lots: 2.0, openPrice: 156.00, sl: 156.50, tp: 152.00, expiration: null },
    ],
  },
  'ic_live_demo_trend_follow_003': {
    status: 'online', balance: 3000, equity: 3287.4, margin: 215.8, freeMargin: 3071.6, marginLevel: 1523.4, drawdown: 2.1, profit: 287.4, openLots: 0.6, buyLots: 0.6, sellLots: 0.0, pendingOrders: 1,
    orders: [
      { ticket: 10020, symbol: 'XAUUSD', type: 'BUY', lots: 0.3, openPrice: 2285.0, currentPrice: 2318.2, profit: 994.8, swap: 0, commission: 0, openTime: makePastTime(1440), sl: 2250.0, tp: 2400.0 },
      { ticket: 10021, symbol: 'EURUSD', type: 'BUY', lots: 0.3, openPrice: 1.0790, currentPrice: 1.0832, profit: 126.0, swap: 0, commission: 0, openTime: makePastTime(720), sl: 1.0730, tp: 1.1000 },
    ],
    pending: [
      { ticket: 20020, symbol: 'XAUUSD', type: 'BUY_STOP', lots: 0.5, openPrice: 2325.0, sl: 2300.0, tp: 2400.0, expiration: null },
    ],
  },
  'fbs_live_demo_martingale_004': {
    status: 'online', balance: 2500, equity: 2189.3, margin: 1234.5, freeMargin: 954.8, marginLevel: 177.3, drawdown: 28.4, profit: -310.7, openLots: 4.8, buyLots: 4.8, sellLots: 0.0, pendingOrders: 0,
    orders: [
      { ticket: 10030, symbol: 'EURUSD', type: 'BUY', lots: 0.1, openPrice: 1.0900, currentPrice: 1.0832, profit: -68.0, swap: 0, commission: 0, openTime: makePastTime(300), sl: 0, tp: 1.1000 },
      { ticket: 10031, symbol: 'EURUSD', type: 'BUY', lots: 0.2, openPrice: 1.0870, currentPrice: 1.0832, profit: -76.0, swap: 0, commission: 0, openTime: makePastTime(250), sl: 0, tp: 1.1000 },
      { ticket: 10032, symbol: 'EURUSD', type: 'BUY', lots: 0.4, openPrice: 1.0850, currentPrice: 1.0832, profit: -72.0, swap: 0, commission: 0, openTime: makePastTime(200), sl: 0, tp: 1.1000 },
      { ticket: 10033, symbol: 'EURUSD', type: 'BUY', lots: 0.8, openPrice: 1.0840, currentPrice: 1.0832, profit: -64.0, swap: 0, commission: 0, openTime: makePastTime(150), sl: 0, tp: 1.1000 },
      { ticket: 10034, symbol: 'EURUSD', type: 'BUY', lots: 1.6, openPrice: 1.0835, currentPrice: 1.0832, profit: -48.0, swap: 0, commission: 0, openTime: makePastTime(100), sl: 0, tp: 1.1000 },
      { ticket: 10035, symbol: 'EURUSD', type: 'BUY', lots: 1.7, openPrice: 1.0833, currentPrice: 1.0832, profit: -17.0, swap: 0, commission: 0, openTime: makePastTime(50), sl: 0, tp: 1.1000 },
    ],
    pending: [],
  },
  'pp_live_demo_hedge_master_005': {
    status: 'online', balance: 8000, equity: 8543.1, margin: 650.2, freeMargin: 7892.9, marginLevel: 1313.9, drawdown: 5.8, profit: 543.1, openLots: 2.0, buyLots: 1.0, sellLots: 1.0, pendingOrders: 3,
    orders: [
      { ticket: 10040, symbol: 'XAUUSD', type: 'BUY', lots: 0.5, openPrice: 2290.0, currentPrice: 2318.2, profit: 1410.0, swap: 0, commission: 0, openTime: makePastTime(2880), sl: 2260.0, tp: 2400.0 },
      { ticket: 10041, symbol: 'XAUUSD', type: 'SELL', lots: 0.5, openPrice: 2330.0, currentPrice: 2318.2, profit: 590.0, swap: 0, commission: 0, openTime: makePastTime(1440), sl: 2360.0, tp: 2250.0 },
      { ticket: 10042, symbol: 'GBPUSD', type: 'BUY', lots: 0.5, openPrice: 1.2700, currentPrice: 1.2695, profit: -25.0, swap: 0, commission: 0, openTime: makePastTime(360), sl: 1.2640, tp: 1.2800 },
      { ticket: 10043, symbol: 'GBPUSD', type: 'SELL', lots: 0.5, openPrice: 1.2720, currentPrice: 1.2695, profit: 125.0, swap: 0, commission: 0, openTime: makePastTime(360), sl: 1.2780, tp: 1.2600 },
    ],
    pending: [
      { ticket: 20040, symbol: 'XAUUSD', type: 'BUY_LIMIT', lots: 0.5, openPrice: 2280.0, sl: 2260.0, tp: 2350.0, expiration: null },
      { ticket: 20041, symbol: 'XAUUSD', type: 'SELL_STOP_LIMIT', lots: 0.5, openPrice: 2340.0, sl: 2360.0, tp: 2270.0, expiration: null },
      { ticket: 20042, symbol: 'GBPUSD', type: 'BUY_STOP', lots: 0.5, openPrice: 1.2760, sl: 1.2720, tp: 1.2850, expiration: null },
    ],
  },
};

class RuntimeAccountStore {
  private store = new Map<string, Account[]>();

  async initialize(): Promise<void> {
    const dbAccounts = await prisma.account.findMany({
      include: {
        user: { select: { id: true } },
        group: { select: { id: true, name: true, color: true } },
      },
    });

    for (const dbAcc of dbAccounts) {
      const demo = DEMO_ORDERS[dbAcc.apiKey];
      const account: Account = {
        id: dbAcc.id,
        name: dbAcc.name,
        broker: dbAcc.broker,
        accountNumber: dbAcc.accountNumber,
        apiKey: dbAcc.apiKey,
        server: dbAcc.server,
        currency: dbAcc.currency,
        leverage: dbAcc.leverage,
        groupId: dbAcc.groupId ?? null,
        groupName: dbAcc.group?.name,
        groupColor: dbAcc.group?.color,
        isDemo: dbAcc.isDemo,
        // Demo accounts run on mock data. Everything else comes back as the
        // last snapshot its EA pushed, so a restart doesn't wipe the numbers
        // back to invented ones. Status stays offline until a push proves
        // the EA is alive again.
        status: demo?.status ?? 'offline',
        balance: demo?.balance ?? dbAcc.balance,
        equity: demo?.equity ?? dbAcc.equity,
        margin: demo?.margin ?? dbAcc.margin,
        freeMargin: demo?.freeMargin ?? dbAcc.freeMargin,
        marginLevel: demo?.marginLevel ?? dbAcc.marginLevel,
        drawdown: demo?.drawdown ?? dbAcc.drawdown,
        profit: demo?.profit ?? dbAcc.profit,
        openLots: demo?.openLots ?? dbAcc.openLots,
        buyLots: demo?.buyLots ?? dbAcc.buyLots,
        sellLots: demo?.sellLots ?? dbAcc.sellLots,
        pendingOrders: demo?.pendingOrders ?? dbAcc.pendingOrders,
        // Open positions are live-only; the EA re-sends them on its next push.
        orders: demo?.orders ?? [],
        pending: demo?.pending ?? [],
        ...(dbAcc.todayPnl != null && { todayPnl: dbAcc.todayPnl }),
        ...(dbAcc.closedOrdersToday != null && { closedOrdersToday: dbAcc.closedOrdersToday }),
        ...(dbAcc.brokerTimeOffset != null && { brokerTimeOffset: dbAcc.brokerTimeOffset }),
      };

      const userId = dbAcc.userId;
      const existing = this.store.get(userId) || [];
      existing.push(account);
      this.store.set(userId, existing);
    }

    console.log(`[RuntimeStore] Loaded ${dbAccounts.length} accounts for ${this.store.size} users`);
  }

  getAccountsByUser(userId: string): Account[] {
    return this.store.get(userId) || [];
  }

  getAllAccounts(): Account[] {
    return Array.from(this.store.values()).flat();
  }

  async addAccount(userId: string, accountData: {
    name: string; broker: string; accountNumber: string; apiKey: string;
    server: string; currency: string; leverage: number; groupId?: string;
    isDemo?: boolean;
  }): Promise<Account> {
    const dbAcc = await prisma.account.create({
      data: { ...accountData, userId },
    });

    const account: Account = {
      id: dbAcc.id,
      name: dbAcc.name,
      broker: dbAcc.broker,
      accountNumber: dbAcc.accountNumber,
      apiKey: dbAcc.apiKey,
      server: dbAcc.server,
      currency: dbAcc.currency,
      leverage: dbAcc.leverage,
      isDemo: dbAcc.isDemo,
      status: 'offline',
      // All financial fields start at 0 — the EA will push real numbers
      // on its first POST. Seeding with non-zero placeholders made the
      // dashboard show fake balance + impossible margin levels for
      // accounts that hadn't connected yet.
      balance: 0, equity: 0, margin: 0, freeMargin: 0,
      marginLevel: 0, drawdown: 0, profit: 0,
      openLots: 0, buyLots: 0, sellLots: 0, pendingOrders: 0,
      orders: [], pending: [],
    };

    const existing = this.store.get(userId) || [];
    existing.push(account);
    this.store.set(userId, existing);
    return account;
  }

  async removeAccount(userId: string, accountId: string): Promise<boolean> {
    const accounts = this.store.get(userId);
    if (!accounts) return false;
    const idx = accounts.findIndex(a => a.id === accountId);
    if (idx === -1) return false;

    // Clear any pending commands for this account
    commandQueue.clear(accounts[idx].apiKey);
    accounts.splice(idx, 1);
    await prisma.account.delete({ where: { id: accountId } });
    return true;
  }

  findAccountByApiKey(apiKey: string): { account: Account; userId: string } | null {
    for (const [userId, accounts] of this.store.entries()) {
      const account = accounts.find(a => a.apiKey === apiKey);
      if (account) return { account, userId };
    }
    return null;
  }

  updateAccount(userId: string, updatedAccount: Account): void {
    const accounts = this.store.get(userId);
    if (!accounts) return;
    const idx = accounts.findIndex(a => a.id === updatedAccount.id);
    if (idx !== -1) accounts[idx] = updatedAccount;
  }

  updateAllAccounts(updated: Account[]): void {
    // Rebuild per-user buckets from flat array
    const newStore = new Map<string, Account[]>();
    for (const [userId, accounts] of this.store.entries()) {
      const updatedAccounts = accounts.map(existing => {
        const match = updated.find(u => u.id === existing.id);
        return match ?? existing;
      });
      newStore.set(userId, updatedAccounts);
    }
    this.store = newStore;
  }

  /** Update group assignment in runtime (after DB write) */
  setAccountGroup(userId: string, accountId: string, groupId: string | null, groupName?: string, groupColor?: string): void {
    const accounts = this.store.get(userId);
    if (!accounts) return;
    const acc = accounts.find(a => a.id === accountId);
    if (acc) {
      acc.groupId = groupId;
      acc.groupName = groupName;
      acc.groupColor = groupColor;
    }
  }

  removeUserAccounts(userId: string): void {
    this.store.delete(userId);
  }
}

export const runtimeStore = new RuntimeAccountStore();
