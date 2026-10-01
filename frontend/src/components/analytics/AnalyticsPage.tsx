import { useState, useEffect, useMemo } from 'react';
import { useAccountStore } from '../../stores/accountStore';
import { fetchTradeHistory } from '../../services/api';
import { EquityChart } from './EquityChart';
import { PerformanceCalendar } from './PerformanceCalendar';
import { PerformanceCards } from './PerformanceCards';
import type { ClosedTrade } from '../../types';
import { useTranslation } from '../../i18n/useTranslation';

type Tab = 'performance' | 'equity' | 'stats' | 'symbol';

const TABS: { key: Tab; labelKey: string }[] = [
  { key: 'performance', labelKey: 'analytics.performance' },
  { key: 'equity',      labelKey: 'analytics.equity_chart' },
  { key: 'stats',       labelKey: 'nav.stats' },
  { key: 'symbol',      labelKey: 'analytics.by_symbol' },
];

// ── By-Symbol breakdown ─────────────────────────────────────────────────────

interface SymbolRow {
  symbol: string;
  trades: number;
  wins: number;
  winRate: number;
  totalProfit: number;
  avgProfit: number;
  bestTrade: number;
  worstTrade: number;
}

const BySymbolTab = ({ accountId }: { accountId?: string }) => {
  const [allTrades, setAllTrades] = useState<ClosedTrade[]>([]);
  const [loading, setLoading]     = useState(false);
  const [sortCol, setSortCol]     = useState('totalProfit');
  const [sortDir, setSortDir]     = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    setLoading(true);
    fetchTradeHistory({ accountId: accountId || undefined, limit: 9999, sortBy: 'closeTime', sortDir: 'asc' })
      .then(res => setAllTrades(res.trades))
      .catch(() => setAllTrades([]))
      .finally(() => setLoading(false));
  }, [accountId]);

  const rows = useMemo((): SymbolRow[] => {
    const map = new Map<string, ClosedTrade[]>();
    for (const t of allTrades) {
      if (!map.has(t.symbol)) map.set(t.symbol, []);
      map.get(t.symbol)!.push(t);
    }
    const result: SymbolRow[] = [];
    for (const [symbol, trades] of map.entries()) {
      const wins = trades.filter(t => t.profit > 0).length;
      const totalProfit = trades.reduce((s, t) => s + t.profit, 0);
      const profits = trades.map(t => t.profit);
      result.push({
        symbol,
        trades: trades.length,
        wins,
        winRate: (wins / trades.length) * 100,
        totalProfit,
        avgProfit: totalProfit / trades.length,
        bestTrade: Math.max(...profits),
        worstTrade: Math.min(...profits),
      });
    }
    return result.sort((a, b) => {
      if (sortCol === 'symbol') {
        return sortDir === 'desc'
          ? b.symbol.localeCompare(a.symbol)
          : a.symbol.localeCompare(b.symbol);
      }
      const av = (a as unknown as Record<string, number>)[sortCol] ?? 0;
      const bv = (b as unknown as Record<string, number>)[sortCol] ?? 0;
      return sortDir === 'desc' ? bv - av : av - bv;
    });
  }, [allTrades, sortCol, sortDir]);

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  };
  const si = (col: string) => sortCol !== col ? '' : sortDir === 'asc' ? ' ↑' : ' ↓';

  const thB: React.CSSProperties = {
    fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', color: 'var(--text-dim)',
    letterSpacing: '.5px', padding: '9px 10px', borderBottom: '2px solid var(--border2)',
    fontWeight: 400, cursor: 'pointer', whiteSpace: 'nowrap',
  };
  const thR: React.CSSProperties = { ...thB, textAlign: 'right' };
  const td: React.CSSProperties = {
    padding: '8px 10px', borderBottom: '1px solid rgba(42,45,52,.3)',
    fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)', color: 'var(--text)', whiteSpace: 'nowrap',
  };
  const tdR: React.CSSProperties = { ...td, textAlign: 'right' };

  const fmt = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2);

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '40px', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)', color: 'var(--text-dim)' }}>
      Loading symbol data...
    </div>
  );

  if (!rows.length) return (
    <div style={{ textAlign: 'center', padding: '40px', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)', color: 'var(--text-dim)' }}>
      No closed trades found
    </div>
  );

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ marginBottom: '8px', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-dim)' }}>
        {rows.length} symbols · {allTrades.length} total trades
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '380px' }}>
        <thead>
          <tr style={{ background: 'var(--bg-card2)' }}>
            <th style={thB} onClick={() => handleSort('symbol')}>SYMBOL{si('symbol')}</th>
            <th style={thR} onClick={() => handleSort('trades')} className="an-col-trades">TRADES{si('trades')}</th>
            <th style={thR} onClick={() => handleSort('winRate')}>WIN%{si('winRate')}</th>
            <th style={thR} onClick={() => handleSort('totalProfit')}>P/L{si('totalProfit')}</th>
            <th style={thR} onClick={() => handleSort('avgProfit')} className="an-col-avg">AVG{si('avgProfit')}</th>
            <th style={thR} onClick={() => handleSort('bestTrade')} className="an-col-best">BEST{si('bestTrade')}</th>
            <th style={thR} onClick={() => handleSort('worstTrade')} className="an-col-best">WORST{si('worstTrade')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr
              key={r.symbol}
              onMouseEnter={e => ((e.currentTarget as HTMLTableRowElement).style.background = 'rgba(42,45,52,.25)')}
              onMouseLeave={e => ((e.currentTarget as HTMLTableRowElement).style.background = 'transparent')}
            >
              <td style={{ ...td, fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', letterSpacing: '.5px', color: 'var(--text-primary)' }}>
                {r.symbol}
              </td>
              <td style={{ ...tdR, color: 'var(--text-dim)' }} className="an-col-trades">{r.trades}</td>
              <td style={{ ...tdR, fontFamily: 'var(--ff-display)', fontSize: 'var(--fs-disp-sm)', lineHeight: 1,
                color: r.winRate >= 60 ? 'var(--success)' : r.winRate >= 45 ? 'var(--warning)' : 'var(--danger)',
              }}>
                {r.winRate.toFixed(1)}%
              </td>
              <td style={{ ...tdR, fontFamily: 'var(--ff-display)', fontSize: 'var(--fs-disp-sm)', lineHeight: 1,
                color: r.totalProfit >= 0 ? 'var(--success)' : 'var(--danger)',
              }}>
                {fmt(r.totalProfit)}
              </td>
              <td style={{ ...tdR, color: r.avgProfit >= 0 ? 'var(--success)' : 'var(--danger)' }} className="an-col-avg">
                {fmt(r.avgProfit)}
              </td>
              <td style={{ ...tdR, color: 'var(--success)' }} className="an-col-best">+{r.bestTrade.toFixed(2)}</td>
              <td style={{ ...tdR, color: 'var(--danger)' }} className="an-col-best">{r.worstTrade.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ── Main Component ───────────────────────────────────────────────────────────

export const AnalyticsPage = () => {
  const t = useTranslation();
  const accounts = useAccountStore(s => s.accounts);
  const [selectedAccount, setSelectedAccount] = useState<string>('');
  const [tab, setTab] = useState<Tab>('performance');

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '5px 11px',
    fontFamily: 'var(--ff-section)',
    fontSize: 'var(--fs-label)',
    letterSpacing: '.5px',
    border: active ? '1px solid var(--accent-blue)' : '1px solid var(--border2)',
    color: active ? 'var(--accent-blue)' : 'var(--text-muted)',
    background: active ? 'rgba(96,165,250,.08)' : 'none',
    cursor: 'pointer',
    transition: 'all .15s',
  });

  // Only live accounts for analytics
  const liveAccounts = accounts.filter(a => !a.isDemo);

  return (
    <div>
      {/* ── Section header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <div style={{ width: '7px', height: '7px', background: 'var(--accent-blue)',flexShrink: 0 }} />
        <span style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', color: 'var(--text-primary)', letterSpacing: '2px' }}>
          {t('analytics.title').toUpperCase()}
        </span>
        <div style={{ flex: 1, height: '1px', background: 'linear-gradient(90deg, var(--border2), transparent)' }} />
      </div>

      {/* ── Toolbar: tabs + account selector ── */}
      <div className="an-toolbar" style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <div className="an-tabs" style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {TABS.map(item => (
            <button key={item.key} onClick={() => setTab(item.key)} style={tabStyle(tab === item.key)}>
              {t(item.labelKey).toUpperCase()}
            </button>
          ))}
        </div>

        <div className="an-account-sel" style={{ marginLeft: 'auto' }}>
          <select
            value={selectedAccount}
            onChange={e => setSelectedAccount(e.target.value)}
            style={{
              background: 'var(--bg-input)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)',
              padding: '6px 10px', outline: 'none', cursor: 'pointer',
              width: '100%',
            }}
          >
            <option value="">All Accounts</option>
            {liveAccounts.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '14px' }}>
        {tab === 'performance' && (
          <PerformanceCalendar accountId={selectedAccount || undefined} />
        )}

        {/* Every other tab here answers for the whole portfolio when no
            account is picked. This one used to be the exception and asked
            the person to choose, which made All Accounts look broken. */}
        {tab === 'equity' && (
          <EquityChart accountId={selectedAccount || undefined} />
        )}

        {tab === 'stats' && (
          <PerformanceCards accountId={selectedAccount || undefined} />
        )}

        {tab === 'symbol' && (
          <BySymbolTab accountId={selectedAccount || undefined} />
        )}
      </div>

      <style>{`
        /* ── Analytics responsive ── */
        @media (max-width: 600px) {
          .an-toolbar { flex-direction: column !important; align-items: stretch !important; }
          .an-tabs    { width: 100% !important; }
          .an-tabs button { flex: 1 !important; text-align: center !important; padding: 7px 4px !important; }
          .an-account-sel { margin-left: 0 !important; width: 100% !important; }
        }
        @media (max-width: 560px) {
          .an-col-avg  { display: none !important; }
          .an-col-best { display: none !important; }
        }
        @media (max-width: 420px) {
          .an-col-trades { display: none !important; }
        }
      `}</style>
    </div>
  );
};
