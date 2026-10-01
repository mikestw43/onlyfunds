import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchDailyPnL } from '../../services/api';
import { useTranslation } from '../../i18n/useTranslation';
import type { DailyPnL } from '../../types';

interface Props {
  accountId?: string;
}

const MONTHS_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * Cell formatter — hard 6-character cap so the bigger VT font never
 * overflows the day box. Backend already returns USD.
 *   < $10        → +$X.XX  (6 chars, 2 decimals)
 *   $10 – $99    → +$XX.X  (6 chars, 1 decimal)
 *   $100 – $999  → +$XXX   (5 chars, no decimals)
 *   $1k – $9.9k  → +$X.Xk  (6 chars, 1 decimal)
 *   $10k – $999k → +$XXk / +$XXXk (5-6 chars, no decimals)
 *   ≥ $1M        → +$X.XM  (6 chars, 1 decimal)
 */
const fmtCell = (n: number, compact = false): string => {
  const abs = Math.abs(n);
  const sign = n >= 0 ? '+' : '-';
  // On a phone eight columns leave each day roughly 45px, and six characters
  // of the display font do not fit — shrinking the type far enough to make
  // them fit would make them unreadable instead. The currency symbol is the
  // one character that carries no information here: every figure on the page
  // is USD and the header says so. Dropping it buys a whole character.
  const cur = compact ? '' : '$';
  if (abs >= 1e6)  return `${sign}${cur}${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e4)  return `${sign}${cur}${Math.round(abs / 1000)}k`;
  if (abs >= 1000) return `${sign}${cur}${(abs / 1000).toFixed(1)}k`;
  if (abs >= 100)  return `${sign}${cur}${Math.round(abs)}`;
  if (abs >= 10)   return `${sign}${cur}${abs.toFixed(1)}`;
  return `${sign}${cur}${abs.toFixed(2)}`;
};

/** True while the viewport is narrow enough that the day cells are cramped. */
const useNarrow = (): boolean => {
  const query = '(max-width: 768px)';
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return narrow;
};

/** Monthly P/L total — full precision with thousands separator. USD. */
const fmtFull = (n: number): string => {
  const sign = n >= 0 ? '+' : '-';
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/**
 * Green for a day up, red for a day down, one depth each.
 *
 * It used to be three depths a side, by size of the day — which asked the
 * eye to rank nine shades, and the number is already printed in the cell
 * and ranked properly in BEST DAY and WORST DAY above the grid. The depth
 * added nothing the figures did not say better.
 *
 * The top band also carried a tinted border, which is what made the three
 * biggest days of the month look boxed in while the rest looked open: it
 * was the only border visible, and a cell's border cannot be rounded in a
 * collapsed table, so it drew a hard rectangle. One rule for every day,
 * and nothing stands out as a box.
 */
const heatBg = (pnl: number | undefined): string => {
  if (pnl === undefined || pnl === 0) return 'transparent';
  return pnl > 0 ? 'rgba(52,211,153,.14)' : 'rgba(248,113,113,.14)';
};

export const PerformanceCalendar = ({ accountId }: Props) => {
  const t = useTranslation();
  const narrow = useNarrow();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-based

  // Fetch 6M of data — covers most navigation; user can navigate back ~6 months.
  // Auto-refresh every 30s so newly closed trades show up without manual reload.
  const { data = [] as DailyPnL[], isLoading: loading } = useQuery<DailyPnL[]>({
    queryKey: ['daily-pnl', accountId ?? 'all'],
    queryFn: () => fetchDailyPnL(accountId || undefined, '6M'),
    refetchInterval: 30_000,
  });

  // Build pnl-by-date map for current month. `verified` travels with the
  // figure: a day MT5 itself reported is a fact, a day rebuilt from the trades
  // we stored is an estimate, and the cell says which it is.
  const dayMap = useMemo(() => {
    const m = new Map<number, { profit: number; verified: boolean }>();
    const ymPrefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
    for (const d of data) {
      if (d.date.startsWith(ymPrefix)) {
        const day = parseInt(d.date.slice(8, 10), 10);
        m.set(day, { profit: d.profit, verified: d.verified !== false });
      }
    }
    return m;
  }, [data, year, month]);

  // Per-month stats
  const stats = useMemo(() => {
    const vals = Array.from(dayMap.values()).map(v => v.profit);
    const total = vals.reduce((s, v) => s + v, 0);
    const verified = Array.from(dayMap.values()).every(v => v.verified);
    const wins = vals.filter(v => v > 0).length;
    const losses = vals.filter(v => v < 0).length;
    const best = vals.length ? Math.max(...vals) : 0;
    const worst = vals.length ? Math.min(...vals) : 0;
    return { total, wins, losses, best, worst, verified };
  }, [dayMap]);

  // Calendar cells
  const grid = useMemo(() => {
    const firstDow = new Date(year, month, 1).getDay();
    const startCol = (firstDow + 6) % 7; // Monday-first
    const dim = new Date(year, month + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < startCol; i++) cells.push(null);
    for (let d = 1; d <= dim; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    const rows: (number | null)[][] = [];
    for (let r = 0; r < cells.length / 7; r++) {
      rows.push(cells.slice(r * 7, r * 7 + 7));
    }
    return rows;
  }, [year, month]);

  const todayKey = today.getFullYear() === year && today.getMonth() === month ? today.getDate() : -1;
  // Column index (Monday-first) of today's day-of-week, or -1 if today is
  // outside the currently-viewed month/year. Used to highlight the matching
  // weekday header in cyan.
  const todayDow = todayKey >= 0 ? (today.getDay() + 6) % 7 : -1;

  const changeMonth = (dir: -1 | 1) => {
    let m = month + dir;
    let y = year;
    if (m < 0) { m = 11; y -= 1; }
    else if (m > 11) { m = 0; y += 1; }
    setMonth(m); setYear(y);
  };

  /* ── Styles ───────────────────────────────────── */
  const hdrStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: '8px', flexWrap: 'wrap', marginBottom: '12px',
  };
  // On a phone the header wraps to three rows and the month, the one control
  // in it, sat hard against the left edge with its arrows. Centred, it reads
  // as the title of what is below it. On a wide screen the row does not wrap,
  // so this has nothing to centre and changes nothing.
  const monthNavStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '8px',
    flex: '1 1 100%', justifyContent: 'center',
  };
  const navBtn: React.CSSProperties = {
    width: '26px', height: '26px', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)',
    color: 'var(--text)', cursor: 'pointer', fontSize: '13px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'none', transition: 'border-color .15s',
  };
  const monthLbl: React.CSSProperties = {
    fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)',
    color: 'var(--text-primary)', letterSpacing: '1px',
    minWidth: '88px', textAlign: 'center',
  };
  const pstatLbl: React.CSSProperties = {
    fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)',
    color: 'var(--text-dim)', letterSpacing: '.5px',
    display: 'block', marginBottom: '3px',
  };
  const pstatVal: React.CSSProperties = {
    fontFamily: 'var(--ff-display)', fontSize: 'var(--fs-disp-sm)', lineHeight: 1,
    display: 'block',
  };
  const totalWrap: React.CSSProperties = {
    fontSize: 'var(--fs-micro)', color: 'var(--text-dim)', fontFamily: 'var(--ff-body)',
    display: 'flex', alignItems: 'center', gap: '6px',
  };

  const thStyle: React.CSSProperties = {
    fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)',
    color: 'var(--text-dim)', padding: '9px 4px',
    textAlign: 'center', borderBottom: '2px solid var(--border2)',
    letterSpacing: '.5px', fontWeight: 400,
  };
  const thWeek: React.CSSProperties = {
    ...thStyle, color: 'var(--accent-blue)',
    borderLeft: '1px solid var(--border2)', minWidth: '60px',
  };

  const tdBase: React.CSSProperties = {
    padding: '5px 7px', textAlign: 'left',
    // No borderRadius here: a collapsed table drops it. The rounding lives
    // on .pcal-fill, which is a block and can keep it.
    border: '1px solid var(--border)',
    verticalAlign: 'top', height: '70px', position: 'relative',
  };

  /* ── Render ───────────────────────────────────── */
  return (
    <div>
      {/* Header: month nav + stats + total */}
      <div className="pcal-hdr" style={hdrStyle}>
        <div className="pcal-monthnav" style={monthNavStyle}>
          <button
            onClick={() => changeMonth(-1)}
            style={navBtn}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-blue)'; e.currentTarget.style.color = 'var(--accent-blue)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border2)'; e.currentTarget.style.color = 'var(--text)'; }}
          >
            ◁
          </button>
          <div style={monthLbl}>{MONTHS_SHORT[month]} {year}</div>
          <button
            onClick={() => changeMonth(1)}
            style={navBtn}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-blue)'; e.currentTarget.style.color = 'var(--accent-blue)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border2)'; e.currentTarget.style.color = 'var(--text)'; }}
          >
            ▷
          </button>
        </div>

        {/* Per-day stats */}
        <div className="perf-stats-row" style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <span style={pstatLbl}>WIN DAYS</span>
            <span style={{ ...pstatVal, color: 'var(--success)' }}>{stats.wins}</span>
          </div>
          <div>
            <span style={pstatLbl}>LOSS DAYS</span>
            <span style={{ ...pstatVal, color: 'var(--danger)' }}>{stats.losses}</span>
          </div>
          <div>
            <span style={pstatLbl}>BEST DAY</span>
            <span style={{ ...pstatVal, color: 'var(--success)' }}>{fmtCell(stats.best)}</span>
          </div>
          <div>
            <span style={pstatLbl}>WORST DAY</span>
            <span style={{ ...pstatVal, color: 'var(--danger)' }}>{fmtCell(stats.worst)}</span>
          </div>
        </div>

        {/* Monthly P&L total */}
        <div className="pcal-total" style={totalWrap}>
          <span>MONTHLY P&amp;L</span>
          <span style={{
            fontFamily: 'var(--ff-display)', fontSize: 'var(--fs-disp-sm)', lineHeight: 1,
            color: stats.total > 0 ? 'var(--success)' : stats.total < 0 ? 'var(--danger)' : 'var(--text-dim)',
          }}>
            {dayMap.size > 0
              ? `${stats.verified ? '' : '≈'}${fmtFull(stats.total)}`
              : '—'}
          </span>
        </div>
      </div>

      {/* Calendar table */}
      <div className="pcal-wrap" style={{ overflowX: 'auto' }}>
        <table className="pcal" style={{ width: '100%', borderCollapse: 'collapse', minWidth: '480px', tableLayout: 'fixed' }}>
          <thead>
            <tr style={{ background: 'var(--bg-card2)' }}>
              {['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((d, i) => (
                <th
                  key={d}
                  className="pcal-th"
                  style={{
                    ...thStyle,
                    // Highlight the weekday header that matches today's
                    // day-of-week (only when today falls inside the viewed month).
                    color: todayDow === i ? 'var(--accent-blue)' : thStyle.color,
                    background: todayDow === i ? 'rgba(96,165,250,.08)' : undefined,
                  }}
                >
                  {d}
                </th>
              ))}
              <th className="pcal-th pcal-th-wk" style={thWeek}>WEEK</th>
            </tr>
          </thead>
          <tbody>
            {grid.map((row, ri) => {
              let weekSum = 0;
              let hasDay = false;
              // A week is only as confirmed as its least confirmed day.
              let weekVerified = true;
              const dayCells = row.map((day, ci) => {
                if (day === null) {
                  return <td key={ci} className="pcal-td pcal-empty" style={{ ...tdBase, border: '1px solid transparent', background: 'transparent' }} />;
                }
                const cell = dayMap.get(day);
                const pnl = cell?.profit;
                if (pnl !== undefined) { weekSum += pnl; hasDay = true; }
                const estimated = cell !== undefined && !cell.verified;
                if (estimated) weekVerified = false;
                const isToday = day === todayKey;
                // "Today" is now signalled by a cyan circle around the date
                // number itself — heat colouring on the cell stays so the
                // P/L glance still works even on the current day.
                const bg = heatBg(pnl);
                const pnlColor = pnl !== undefined
                  ? (pnl > 0 ? 'var(--success)' : pnl < 0 ? 'var(--danger)' : 'var(--text-dim)')
                  : 'var(--text-dim)';
                return (
                  <td
                    key={ci}
                    className="pcal-td"
                    title={cell === undefined ? undefined : estimated ? t('calendar.estimated_cell') : t('calendar.verified_cell')}
                    style={tdBase}
                  >
                    {/* The colour sits on this, not on the cell. A table cell
                        in a collapsed table cannot have rounded corners —
                        browsers drop the radius — so a tinted cell was always
                        going to be a hard rectangle. A block inside it rounds
                        like anything else. */}
                    <div className="pcal-fill" style={{ background: bg }} />
                    <span className={`pcal-dn${isToday ? ' pcal-dn-today' : ''}`} style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: 'var(--ff-body)',
                      fontSize: '13px',
                      lineHeight: 1, marginBottom: '4px',
                      minWidth: isToday ? '20px' : 'auto',
                      height: isToday ? '20px' : 'auto',
                      padding: isToday ? '0 5px' : 0,
                      borderRadius: isToday ? '50%' : 0,
                      background: isToday ? 'var(--accent-blue)' : 'transparent',
                      color: isToday ? '#25272c' : 'var(--text-dim)',
                      fontWeight: isToday ? 700 : 400,
                    }}>
                      {day}
                    </span>
                    {pnl !== undefined && (
                      <span className="pcal-pnl" style={{
                        display: 'block', fontFamily: 'var(--ff-display)',
                        fontSize: '24px', lineHeight: 1, color: pnlColor,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'clip',
                      }}>
                        {fmtCell(pnl, narrow)}
                      </span>
                    )}
                    {estimated && <span className="pcal-approx">≈</span>}
                  </td>
                );
              });
              const weekColor = weekSum > 0 ? 'var(--success)' : weekSum < 0 ? 'var(--danger)' : 'var(--text-dim)';
              return (
                <tr key={ri}>
                  {dayCells}
                  <td className="pcal-td pcal-wk-sum" style={{
                    ...tdBase,
                    background: 'var(--bg-card2)',
                    borderLeft: '2px solid var(--border2)',
                    textAlign: 'center', verticalAlign: 'middle',
                    padding: '0 6px', minWidth: '62px',
                  }}>
                    {/* Per-row WEEK label removed — the column header already
                        identifies this column, so we just show the sum. */}
                    <span className="pcal-pnl" style={{
                      display: 'block', fontFamily: 'var(--ff-display)',
                      fontSize: '24px', lineHeight: 1, color: weekColor,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'clip',
                    }}>
                      {hasDay ? fmtCell(weekSum, narrow) : '—'}
                    </span>
                    {hasDay && !weekVerified && <span className="pcal-approx">≈</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {loading && data.length === 0 && (
        <div style={{ textAlign: 'center', padding: '12px', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-dim)' }}>
          Loading...
        </div>
      )}

      {/* Only shown while any visible day is still an estimate, so it stops
          appearing once every day on screen came from MT5. */}
      {Array.from(dayMap.values()).some(v => !v.verified) && (
        <div style={{
          marginTop: '10px', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-micro)',
          color: 'var(--text-dim)', lineHeight: 1.5,
        }}>
          {t('calendar.estimated_note')}
        </div>
      )}

      {/* ── Mobile responsive — drop horizontal scroll, shrink cells ── */}
      <style>{`
        /* The estimate mark sits in the cell's corner rather than in front of
           the figure: on a phone the day box is barely wide enough for the
           number itself, and a leading character pushed the last digit out of
           view — a marker that hides the value it qualifies is worse than no
           marker. */
        /* The day's colour. Inset by a pixel so the grid line still reads as
           the grid line, rounded because it can be, and behind the figures
           rather than over them. */
        .pcal-fill {
          position: absolute;
          inset: 1px;
          border-radius: var(--radius-sm);
          pointer-events: none;
          z-index: 0;
        }
        /* Everything else in the cell sits above the fill.
           The estimate mark is excluded: it is positioned absolutely in the
           cell's corner, and a blanket position:relative here would drop
           it back into the text flow — on its own line under the figure,
           stretching the row. It gets its own z-index below instead. */
        .pcal-td > *:not(.pcal-fill):not(.pcal-approx) { position: relative; z-index: 1; }
        .pcal-approx {
          position: absolute;
          z-index: 1;
          top: 3px; right: 5px;
          font-family: var(--ff-body);
          font-size: 12px; line-height: 1;
          color: var(--text-dim); opacity: .75;
          pointer-events: none;
        }
        /* Only while the header wraps; on a wide screen the month stays on the
           left of a single row, where it belongs. */
        @media (min-width: 769px) {
          .pcal-monthnav { flex: 0 0 auto !important; justify-content: flex-start !important; }
        }
        @media (max-width: 768px) {
          /* The header wraps to three rows here, so the three blocks are
             really three rows and their order is ours to choose. The month
             total belongs with the month that names it, centred under it,
             not stranded below the four per-day figures. On a wide screen
             the header is one row and this does not apply. */
          .pcal-hdr > .pcal-monthnav { order: 1; }
          .pcal-hdr > .pcal-total {
            order: 2;
            flex: 1 1 100%;
            justify-content: center;
          }
          .pcal-hdr > .perf-stats-row { order: 3; }
          .pcal-approx { top: 2px; right: 3px; font-size: 10px; }
          .pcal-wrap { overflow-x: visible !important; }
          .pcal { min-width: 0 !important; table-layout: fixed !important; }
          .pcal-th { padding: 6px 1px !important; font-size: 10px !important; letter-spacing: 0 !important; }
          .pcal-td { padding: 3px 3px !important; height: 52px !important; }
          .pcal-td.pcal-wk-sum { min-width: 0 !important; padding: 2px 2px !important; }
          .pcal-dn { font-size: 11px !important; margin-bottom: 3px !important; }
          .pcal-dn.pcal-dn-today { min-width: 17px !important; height: 17px !important; }
          /* Seven days plus a week column share the screen, so the space a
             figure gets is a fixed fraction of the viewport — which makes the
             type size one too, rather than a staircase of breakpoints that is
             always slightly wrong between two of its steps. */
          .pcal-pnl { font-size: clamp(10px, 3vw, 17px) !important; }
        }
        @media (max-width: 480px) {
          .pcal-approx { top: 1px; right: 2px; font-size: 9px; }
          .pcal-th { padding: 5px 1px !important; font-size: 9px !important; }
          .pcal-td { padding: 2px 2px !important; height: 44px !important; }
          .pcal-dn { font-size: 10px !important; }
          .pcal-dn.pcal-dn-today { min-width: 15px !important; height: 15px !important; padding: 0 4px !important; }
        }
        @media (max-width: 400px) {
          .pcal-td { padding: 2px 1px !important; }
        }
      `}</style>
    </div>
  );
};
