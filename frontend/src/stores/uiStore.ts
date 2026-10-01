import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface Toast {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message?: string;
}

type Language = 'en' | 'th';
type Theme = 'dark' | 'light';
type BotViewMode = 'card' | 'table';

/** One turn on screen. `at` is a timestamp so the time can be shown; on a
 *  message loaded from the server it is when it was actually said. */
export interface AiMsg {
  id: string;
  who: 'me' | 'ai';
  text: string;
  at: number;
  /** Only ever on a message still in this browser — photos are not kept
   *  on the server, so a loaded conversation shows a count instead. */
  images?: string[];
  photos?: number;
  model?: string | null;
  /** Set once the order written out in this message has been sent. */
  ordersSentAt?: string | null;
}

interface UIState {
  toasts: Toast[];
  botFilter: { status: string; broker: string; search: string; sort: string; group: string };
  botViewMode: BotViewMode;
  activeTab: string;
  currentPage: 'dashboard' | 'profile' | 'settings' | 'admin' | 'analytics' | 'trade-history' | 'command-log' | 'audit' | 'privacy' | 'calendar' | 'ea-repository' | 'announce' | 'download';
  language: Language;
  theme: Theme;
  /** Account the trade-history page should open filtered to, set by whoever
   *  navigates there. Consumed and cleared on arrival, and deliberately not
   *  persisted: it is a one-way handoff, not a saved preference. */
  tradeHistoryAccountId: string | null;
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  setBotFilter: (filter: Partial<UIState['botFilter']>) => void;
  setBotViewMode: (mode: BotViewMode) => void;
  setActiveTab: (tab: string) => void;
  setCurrentPage: (page: UIState['currentPage']) => void;
  /** The assistant is a sheet over whatever page you are on, not a page. */
  aiOpen: boolean;
  setAiOpen: (open: boolean) => void;
  /**
   * The conversation, kept out here rather than inside the sheet.
   *
   * The sheet unmounts when it closes, so anything it held went with it —
   * close it to look at a position and the exchange you were in the middle
   * of was gone. Held for the session; a reload still starts fresh, and
   * conversations that survive that belong on the server, with the model.
   */
  aiMessages: AiMsg[];
  addAiMessage: (m: Omit<AiMsg, 'id' | 'at'> & { id?: string; at?: number }) => void;
  clearAiMessages: () => void;
  /** Replace the lot — loading a saved conversation from the server. */
  setAiMessages: (messages: AiMsg[]) => void;
  /** Drop this message and everything said after it (editing, or asking
   *  again). */
  truncateAiFrom: (id: string) => void;
  /** The order written out in this answer has been sent. */
  markAiOrderSent: (id: string) => void;
  /** The conversation on the server these messages belong to. Null until
   *  the first answer comes back with one. */
  aiChatId: string | null;
  setAiChatId: (id: string | null) => void;
  /** Go to the trade history already filtered to one account. */
  openTradeHistory: (accountId: string) => void;
  clearTradeHistoryAccount: () => void;
  setLanguage: (lang: Language) => void;
  setTheme: (theme: Theme) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      toasts: [],
      botFilter: { status: 'all', broker: 'all', search: '', sort: 'name', group: 'all' },
      botViewMode: 'card',
      activeTab: 'overview',
      currentPage: 'dashboard',
      aiOpen: false,
      aiMessages: [],
      aiChatId: null,
      language: 'en',
      theme: 'dark',
      tradeHistoryAccountId: null,
      addToast: (toast) => {
        const id = Math.random().toString(36).slice(2);
        set(s => ({ toasts: [...s.toasts, { ...toast, id }] }));
        setTimeout(() => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), 4000);
      },
      removeToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
      setBotFilter: (filter) => set(s => ({ botFilter: { ...s.botFilter, ...filter } })),
      setBotViewMode: (botViewMode) => set({ botViewMode }),
      setActiveTab: (tab) => set({ activeTab: tab }),
      setCurrentPage: (page) => set({ currentPage: page }),
      setAiOpen: (open) => set({ aiOpen: open }),
      addAiMessage: (m) => set(state => ({
        aiMessages: [...state.aiMessages, {
          ...m,
          // The server's id once there is one; until then something of our
          // own, so React has a key and edit has something to point at.
          id: m.id ?? `local-${Date.now()}-${state.aiMessages.length}`,
          at: m.at ?? Date.now(),
        }],
      })),
      clearAiMessages: () => set({ aiMessages: [], aiChatId: null }),
      setAiMessages: (aiMessages) => set({ aiMessages }),
      // Kept here as well as on the server. The card is rebuilt from the
      // message, and within a session the message comes from this store
      // rather than from a fresh fetch — so telling only the server left
      // the card armed until the next reload.
      markAiOrderSent: (id) => set(state => ({
        aiMessages: state.aiMessages.map(m =>
          m.id === id ? { ...m, ordersSentAt: new Date().toISOString() } : m),
      })),
      truncateAiFrom: (id) => set(state => {
        const at = state.aiMessages.findIndex(m => m.id === id);
        return at < 0 ? {} : { aiMessages: state.aiMessages.slice(0, at) };
      }),
      setAiChatId: (aiChatId) => set({ aiChatId }),
      openTradeHistory: (accountId) =>
        set({ currentPage: 'trade-history', tradeHistoryAccountId: accountId }),
      clearTradeHistoryAccount: () => set({ tradeHistoryAccountId: null }),
      setLanguage: (language) => set({ language }),
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'onlyfunds_ui',
      partialize: (s) => ({
        botFilter: s.botFilter,
        botViewMode: s.botViewMode,
        language: s.language,
        theme: s.theme,
      }),
      // Normalize legacy 'hud' theme to 'dark' when rehydrating
      merge: (persistedState, currentState) => {
        const persisted = { ...(persistedState as Record<string, unknown> ?? {}) };
        if (persisted.theme !== 'dark' && persisted.theme !== 'light') persisted.theme = 'dark';
        return { ...currentState, ...persisted } as UIState;
      },
    }
  )
);
