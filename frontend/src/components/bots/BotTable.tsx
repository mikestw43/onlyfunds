import { useRef, useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Account } from '../../types';
import { formatLots, formatPercent } from '../../utils/formatters';

/** Returns a fading green/red background colour for a value that just changed. */
const useFlashBg = (value: number): string | undefined => {
  const prev = useRef(value);
  const [flash, setFlash] = useState<'up' | 'dn' | null>(null);
  useEffect(() => {
    if (prev.current !== value) {
      setFlash(value > prev.current ? 'up' : 'dn');
      prev.current = value;
      const t = setTimeout(() => setFlash(null), 600);
      return () => clearTimeout(t);
    }
  }, [value]);
  return flash === 'up' ? 'rgba(52,211,153,.25)' : flash === 'dn' ? 'rgba(248,113,113,.25)' : undefined;
};

/** Flash a green/red background on a <td> when `value` changes. */
const FlashCell = ({ value, style, children }: { value: number; style?: CSSProperties; children: ReactNode }) => {
  const bg = useFlashBg(value);
  return (
    <td style={{ ...style, backgroundColor: bg, transition: 'background-color .6s' }}>
      {children}
    </td>
  );
};

interface Props {
  accounts: Account[];
  todayPnlMap: Record<string, number>;

}

/** USC (USD-cents) accounts don't show a $ prefix — the value is raw cents.
 *  USDC is a dollar stablecoin, not cents: the server converts it 1:1, so
 *  calling it cents here put the two a hundredfold apart. */
const isUsc = (currency?: string) => (currency || '').toUpperCase() === 'USC';

const fmtMoneyFull = (v: number) =>
  Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const signedFull = (v: number, prefix: string) =>
  v >= 0 ? `+${prefix}${fmtMoneyFull(v)}` : `-${prefix}${fmtMoneyFull(v)}`;

/** Compact money: 5,238.55 → 5.2k, 1,234,567 → 1.2M, sub-1k stays whole. */
function fmtMoneyK(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs < 1000) return `${sign}${abs.toFixed(0)}`;
  if (abs < 1e6)  return `${sign}${(abs / 1000).toFixed(1)}k`;
  return `${sign}${(abs / 1e6).toFixed(2)}M`;
}

const signedK = (v: number, prefix: string) => {
  const k = fmtMoneyK(v);
  if (v >= 0) return `+${prefix}${k}`;
  return `-${prefix}${k.slice(1)}`; // drop the leading '-' from fmtMoneyK
};

const ddColor = (dd: number, offline: boolean) => {
  if (offline) return 'var(--danger)';
  if (dd < 10) return 'var(--success)';
  if (dd < 30) return 'var(--warning)';
  return 'var(--danger)';
};

const plColor = (v: number) => (v > 0 ? 'var(--success)' : v < 0 ? 'var(--danger)' : 'var(--text-muted)');

/**
 * Money cell — full precision on desktop, k-unit on mobile. Each row
 * renders both spans; CSS hides the one that doesn't match the viewport.
 * USC/USDC accounts drop the $ prefix (the value is raw cents, not dollars).
 */
const Money = ({ value, signed = false, currency, noK = false }: {
  value: number; signed?: boolean; currency?: string;
  /** Render the full format on every viewport — skip the k-unit mobile swap. */
  noK?: boolean;
}) => {
  const prefix = isUsc(currency) ? '' : '$';
  const fullText = signed ? signedFull(value, prefix) : `${prefix}${fmtMoneyFull(value)}`;
  if (noK) return <>{fullText}</>;
  return (
    <>
      <span className="num-full">{fullText}</span>
      <span className="num-k">{signed ? signedK(value, prefix) : `${prefix}${fmtMoneyK(value)}`}</span>
    </>
  );
};

/**
 * Tabular view of accounts.
 * Mobile (≤768px) shows only Name, Today P/L, Floating, DD% — no horizontal scroll.
 * Desktop adds balance, equity, lots, margin level.
 * (Broker name has been removed from the table view per UI request — it's
 *  still visible on the card view.)
 */
export const BotTable = ({ accounts, todayPnlMap }: Props) => {

  const thStyle: React.CSSProperties = {
    fontFamily: 'var(--ff-section)',
    fontSize: 'var(--fs-section)',
    color: 'var(--text-muted)',
    letterSpacing: '1px',
    textAlign: 'left',
    padding: '8px 10px',
    borderBottom: `1px solid var(--border2)`,
    whiteSpace: 'nowrap',
  };

  const tdStyle: React.CSSProperties = {
    fontFamily: 'var(--ff-body)',
    fontSize: 'var(--fs-body)',
    color: 'var(--text-primary)',
    padding: '10px',
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap',
  };

  return (
    <div
      className="bot-table-wrap"
      style={{
        // The same card the calendar's news list is drawn in. This used to
        // be a 2px frame in blue for live accounts and yellow for demo —
        // two saturated rectangles around the longest thing on the page,
        // repeating a distinction the section heading above each one
        // already makes in words.
        background: 'var(--bg-card)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-card)',
        marginTop: '10px',
        overflowX: 'auto',
        overflowY: 'hidden',
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, width: '24px', padding: '8px 4px 8px 10px' }}>{/* status dot */}</th>
            <th style={thStyle}>NAME</th>
            <th className="col-balance" style={{ ...thStyle, textAlign: 'right' }}>BALANCE</th>
            <th className="col-equity"  style={{ ...thStyle, textAlign: 'right' }}>EQUITY</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>TODAY</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>FLOATING</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>DD%</th>
            <th className="col-lots" style={{ ...thStyle, textAlign: 'right' }}>LOTS</th>
            <th className="col-ml"   style={{ ...thStyle, textAlign: 'right' }}>ML%</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map(a => {
            const offline = a.status === 'offline';
            const today = todayPnlMap[a.id] ?? 0;
            return (
              <tr key={a.id} className="bot-row" style={{ opacity: offline ? 0.55 : 1 }}>
                {/* Status dot */}
                <td style={{ ...tdStyle, padding: '10px 4px 10px 10px' }}>
                  <span
                    title={a.status}
                    style={{
                      display: 'inline-block',
                      width: '8px', height: '8px',
                      background: offline ? 'var(--danger)' : 'var(--success)',
                    }}
                  />
                </td>

                {/* Name + equity below — equity is the live "right now" value
                    of the account, sized to match the other data columns so
                    it's actually readable on mobile. Colour follows floating
                    P/L: green / red / white. No background flash — the
                    colour change on tick is enough signal. */}
                <td style={tdStyle}>
                  <div style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', color: 'var(--text-primary)', letterSpacing: '.5px' }}>
                    {a.name}
                  </div>
                  <div style={{
                    display: 'flex', alignItems: 'baseline', gap: '6px',
                    marginTop: '3px',
                  }}>
                    <span style={{ fontSize: 'var(--fs-body-sm)', color: 'var(--text-muted)' }}>Eq</span>
                    <span style={{
                      fontFamily: 'var(--ff-display)',
                      fontSize: 'var(--fs-display)',
                      color: a.profit > 0
                        ? 'var(--success)'
                        : a.profit < 0
                          ? 'var(--danger)'
                          : 'var(--text-primary)',
                    }}>
                      <Money value={a.equity} currency={a.currency} noK />
                    </span>
                  </div>
                </td>

<td className="col-balance" style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--ff-display)', fontSize: 'var(--fs-display)' }}>
                  <Money value={a.balance} currency={a.currency} />
                </td>

                <td className="col-equity" style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--ff-display)', fontSize: 'var(--fs-display)' }}>
                  <Money value={a.equity} currency={a.currency} />
                </td>

                <td style={{ ...tdStyle, textAlign: 'right', color: plColor(today), fontFamily: 'var(--ff-display)', fontSize: 'var(--fs-display)' }}>
                  <Money value={today} signed currency={a.currency} />
                </td>

                {/* Floating P/L — flashes green/red on change, same as card view */}
                <FlashCell
                  value={a.profit}
                  style={{ ...tdStyle, textAlign: 'right', color: plColor(a.profit), fontFamily: 'var(--ff-display)', fontSize: 'var(--fs-display)' }}
                >
                  <Money value={a.profit} signed currency={a.currency} />
                </FlashCell>

                <td style={{ ...tdStyle, textAlign: 'right', color: ddColor(a.drawdown, offline), fontFamily: 'var(--ff-display)', fontSize: 'var(--fs-display)' }}>
                  {formatPercent(a.drawdown)}
                </td>

                <td className="col-lots" style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--ff-display)', fontSize: 'var(--fs-display)' }}>
                  {formatLots(a.openLots)}
                </td>

                <td className="col-ml" style={{ ...tdStyle, textAlign: 'right', color: a.marginLevel > 0 && a.marginLevel < 200 ? 'var(--warning)' : 'var(--text-primary)', fontFamily: 'var(--ff-display)', fontSize: 'var(--fs-display)' }}>
                  {a.marginLevel > 0
                    ? `${a.marginLevel.toLocaleString('en-US', { maximumFractionDigits: 0 })}%`
                    : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <style>{`
        .bot-table-wrap .bot-row:hover { background: rgba(96,165,250,.04); }

        /* Default (desktop): show full money, hide k-format */
        .bot-table-wrap .num-k { display: none; }

        @media (max-width: 768px) {
          /* overflow:visible, not overflow-x:hidden. CSS will not let one axis
             be visible while the other is not, so overflow-x:hidden quietly
             turned overflow-y into auto and left a scroll container with
             nothing to scroll. iOS swallows a drag that starts inside one
             instead of passing it to the page, which is why the dashboard felt
             stuck — it springs back — while every other page scrolled fine.
             Columns are hidden at this width and the table is 100% wide, so
             there is nothing to scroll sideways here either. */
          .bot-table-wrap { overflow: visible !important; }

          /* Swap money formats */
          .bot-table-wrap .num-full { display: none; }
          .bot-table-wrap .num-k    { display: inline; }

          /* Hide non-essential columns */
          .bot-table-wrap .col-balance,
          .bot-table-wrap .col-equity,
          .bot-table-wrap .col-lots,
          .bot-table-wrap .col-ml { display: none !important; }

          /* Tighten padding so 5 visible columns fit ~375px */
          .bot-table-wrap th,
          .bot-table-wrap td { padding: 8px 6px !important; }
          .bot-table-wrap th:first-child,
          .bot-table-wrap td:first-child { padding-left: 8px !important; }
        }
      `}</style>
    </div>
  );
};
