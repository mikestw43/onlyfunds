export interface Order {
  ticket: number;
  symbol: string;
  type: 'BUY' | 'SELL';
  lots: number;
  openPrice: number;
  currentPrice: number;
  profit: number;
  swap: number;
  commission: number;
  openTime: string;
  sl: number;
  tp: number;
}

export interface PendingOrder {
  ticket: number;
  symbol: string;
  type: 'BUY_LIMIT' | 'SELL_LIMIT' | 'BUY_STOP' | 'SELL_STOP' | 'BUY_STOP_LIMIT' | 'SELL_STOP_LIMIT';
  lots: number;
  openPrice: number;
  sl: number;
  tp: number;
  expiration: string | null;
}

export interface Account {
  id: string;
  name: string;
  broker: string;
  accountNumber: string;
  apiKey: string;
  status: 'online' | 'offline';
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number;
  drawdown: number;
  profit: number;
  openLots: number;
  buyLots: number;
  sellLots: number;
  pendingOrders: number;
  orders: Order[];
  pending: PendingOrder[];
  server: string;
  currency: string;
  leverage: number;
  groupId?: string | null;
  groupName?: string;
  groupColor?: string;
  isDemo?: boolean;
  /** True when any alert threshold is set on this account. */
  alertsArmed?: boolean;
  /** May the assistant send orders here without a confirmation? */
  brokerTimeOffset?: number; // seconds from UTC (e.g. 7200 = GMT+2)
  todayPnl?: number;          // realized P/L since broker midnight, computed in EA
  closedOrdersToday?: number; // count of closing deals included in todayPnl
  /// Whether the EA on this account will carry out commands. It is the EA
  /// that decides — its own EnableTrading input — and it says so on every
  /// push. Older reporters never say it, which is exactly right: they
  /// cannot execute anything and must never be sent a command to swallow.
  canExecute?: boolean;
  eaVersion?: string;
}
