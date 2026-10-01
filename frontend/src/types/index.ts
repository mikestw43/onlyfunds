export type AccountStatus = 'online' | 'offline';

export type OrderType = 'BUY' | 'SELL';

export type PendingOrderType =
  | 'BUY_LIMIT'
  | 'SELL_LIMIT'
  | 'BUY_STOP'
  | 'SELL_STOP'
  | 'BUY_STOP_LIMIT'
  | 'SELL_STOP_LIMIT';

export interface Order {
  ticket: number;
  symbol: string;
  type: OrderType;
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
  type: PendingOrderType;
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
  status: AccountStatus;
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
  orders: Order[] | number;
  pending: PendingOrder[] | number;
  server: string;
  currency: string;
  leverage: number;
  groupId?: string | null;
  groupName?: string;
  groupColor?: string;
  isDemo?: boolean;
  protectionEnabled?: boolean;
  protectionDrawdown?: number | null;
  brokerTimeOffset?: number | null;
}

export interface OverviewStats {
  totalAccounts: number;
  onlineAccounts: number;
  offlineAccounts: number;
  totalBalance: number;
  totalEquity: number;
  totalProfit: number;
  totalTodayPnl: number;
  totalOpenLots: number;
  totalBuyLots: number;
  totalSellLots: number;
  totalPendingOrders: number;
}

export interface HeatmapAccount {
  id: string;
  name: string;
  broker: string;
  status: AccountStatus;
  balance: number;
  equity: number;
  drawdown: number;
  marginLevel: number;
  profit: number;
  currency: string;
}

export interface HeatmapOrder {
  ticket: number;
  symbol: string;
  type: OrderType;
  lots: number;
  openPrice: number;
  currentPrice: number;
  profit: number;
  openTime: string;
  sl: number;
  tp: number;
  accountName: string;
  accountId: string;
  broker: string;
  durationMin: number;
}

export interface HeatmapPending {
  ticket: number;
  symbol: string;
  type: PendingOrderType;
  lots: number;
  openPrice: number;
  sl: number;
  tp: number;
  expiration: string | null;
  accountName: string;
  accountId: string;
  broker: string;
}

export interface WsMessage {
  type: 'SNAPSHOT' | 'UPDATE';
  data: Account[];
}

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  name?: string | null;
  displayName?: string | null;
  mobile?: string | null;
  phoneCountry?: string | null;
  timezone?: string | null;
  avatarUrl?: string | null;
  hasPassword?: boolean;
  hasGoogleLinked?: boolean;
  createdAt?: string | null;
  lastLoginAt?: string | null;
}

export interface UserInfo {
  id: string;
  email: string;
  name: string | null;
  displayName: string | null;
  mobile: string | null;
  phoneCountry: string | null;
  role: string;     // 'user' | 'vip' | 'admin'
  status: string;   // 'active' | 'pending' | 'rejected' | 'suspended'
  createdAt: string;
  lastLoginAt: string | null;
  // How this account gets in. A Google-only account has no password, which is
  // why a password reset can do nothing for it.
  signIn?: 'password' | 'google' | 'both' | 'none';
  /** Whether this person may ask the assistant, and how many questions a
   *  day (0 = no limit). An admin is never limited. */
  aiEnabled?: boolean;
  aiDailyLimit?: number;
  _count: { accounts: number };
}

export interface TelegramSettings {
  telegramChatId: string | null;
  telegramBotToken: string | null;
  configured: boolean;
}

export interface AccountAlerts {
  id: string;
  alertDrawdown: number | null;
  alertEquityBelow: number | null;
  alertMarginLevel: number | null;
  alertOffline: boolean;
  /** Minutes the same alert must stay quiet before it may repeat. 0 = no floor. */
  alertRepeatMins: number;
}

// --- Analytics / History / Groups ---

export interface EquitySnapshot {
  id: string;
  equity: number;
  balance: number;
  drawdown: number;
  timestamp: string;
}

export interface ClosedTrade {
  id: string;
  accountId: string;
  ticket: number;
  symbol: string;
  type: string;
  lots: number;
  openPrice: number;
  closePrice: number;
  profit: number;
  swap: number;
  commission: number;
  openTime: string;
  closeTime: string;
  sl: number;
  tp: number;
  /** The account's own currency — USC on a cent account, where `profit` is a
   *  hundred times the dollar figure. */
  currency: string;
  /** profit + swap + commission, in the account's currency. */
  net: number;
  /** `net` converted to USD. The only figure safe to add up across accounts. */
  profitUsd: number;
  account?: { name: string; broker: string; currency?: string };
}

export interface DailyPnL {
  date: string;
  profit: number;
  trades: number;
  /** True when MT5 itself reported the day's total. False means the day was
   *  rebuilt from the trades we stored and may not match the terminal. */
  verified?: boolean;
}

export interface PerformanceMetrics {
  totalTrades: number;
  winRate: number;
  avgProfit: number;
  avgLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  grossProfit: number;
  grossLoss: number;
}

export interface NotificationLogEntry {
  id: string;
  userId: string;
  accountId: string | null;
  type: string;
  message: string;
  success: boolean;
  sentAt: string;
}

export interface AccountGroup {
  id: string;
  name: string;
  color: string;
  userId: string;
  _count?: { accounts: number };
  createdAt: string;
  updatedAt: string;
}

export interface TradeHistoryResponse {
  trades: ClosedTrade[];
  total: number;
  page: number;
  limit: number;
}

export interface NotificationResponse {
  logs: NotificationLogEntry[];
  total: number;
  page: number;
  limit: number;
}

// --- Report / Protection / Audit / Preferences ---

export interface ReportSettings {
  reportEnabled: boolean;
  reportFrequency: string;
  reportTime: string;
  reportDay: number;
}

export interface ProtectionSettings {
  id: string;
  protectionEnabled: boolean;
  protectionDrawdown: number | null;
}

export interface AuditLogEntry {
  id: string;
  userId: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  details: string | null;
  ipAddress: string | null;
  createdAt: string;
  user?: { email: string; name: string | null };
}

export interface AuditLogResponse {
  logs: AuditLogEntry[];
  total: number;
  page: number;
  limit: number;
}

export interface UserPreferences {
  language: string;
  theme: string;
  timezone?: string;
}

// ─── Economic Calendar ───────────────────────────────────────────────────────
export interface EconomicEvent {
  title: string;
  country: string;
  date: string;        // ISO datetime e.g. "2025-01-06T08:30:00+00:00"
  impact: 'High' | 'Medium' | 'Low' | 'Non-Economic' | string;
  forecast: string;
  previous: string;
  actual: string;
  /** 'better' = beat forecast (green), 'worse' = missed (red), else neutral. */
  actualSentiment?: 'better' | 'worse' | 'neutral';
}
