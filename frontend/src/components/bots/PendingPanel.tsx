import type { PendingOrder, PendingOrderType } from '../../types';

interface Props {
  orders: PendingOrder[];
}

/**
 * The orders that have not happened yet.
 *
 * They were in the data the EA sends all along and nowhere on the screen,
 * so a card reading "2 open" on an account also holding three pending
 * orders showed two thirds of what was arranged.
 *
 * Two lines per row, like the positions above it, and for the same reason:
 * the first attempt was one line of seven columns, which on a 430px phone
 * squeezed the symbol — the one thing you look for — down to nothing and
 * pushed the expiry off the right edge.
 *
 * Read-only. Cancelling a pending order is a different MT5 call and the EA
 * cannot make it yet.
 */

const SIDE: Record<PendingOrderType, { label: string; color: string; buy: boolean }> = {
  BUY_LIMIT:       { label: 'buy limit',  color: 'var(--cyan)',   buy: true },
  BUY_STOP:        { label: 'buy stop',   color: 'var(--green)',  buy: true },
  BUY_STOP_LIMIT:  { label: 'buy s/l',    color: 'var(--green)',  buy: true },
  SELL_LIMIT:      { label: 'sell limit', color: 'var(--orange)', buy: false },
  SELL_STOP:       { label: 'sell stop',  color: 'var(--red)',    buy: false },
  SELL_STOP_LIMIT: { label: 'sell s/l',   color: 'var(--red)',    buy: false },
};

/**
 * Gold quotes to two places and the currency pairs to five; the size of the
 * number says which, the way it does in the positions table.
 *
 * Takes unknown on purpose. These rows come off the wire from a terminal,
 * and a missing field here threw inside render — which in React does not
 * blank one row, it blanks the whole dashboard. A dash is the right answer
 * to "no number".
 */
const fmtPrice = (v: unknown) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return n === 0 ? '—' : n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: n >= 100 ? 2 : 5,
  });
};

const fmtLots = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : '—';

const fmtExpiry = (iso: unknown) => {
  if (typeof iso !== 'string' || !iso) return 'GTC';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? 'GTC'
    : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export const PendingPanel = ({ orders }: Props) => {
  if (orders.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px 10px' }}>
      {orders.map(o => {
        const side = SIDE[o.type] ?? { label: String(o.type).toLowerCase(), color: 'var(--text-dim)', buy: true };
        return (
          <div
            key={o.ticket}
            style={{
              borderLeft: `2px solid ${side.color}`,
              background: 'var(--bg-input)',
              borderRadius: 'var(--radius-sm)',
              padding: '8px 10px',
              minWidth: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', minWidth: 0 }}>
              <span style={{
                fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{o.symbol}</span>
              <span style={{
                fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: side.color, flexShrink: 0,
              }}>{side.label} {fmtLots(o.lots)}</span>
              <span style={{ flex: 1 }} />
              <span style={{
                fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text)',
                fontVariantNumeric: 'tabular-nums', flexShrink: 0,
              }}>{fmtPrice(o.openPrice)}</span>
            </div>

            <div style={{
              display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '3px',
              fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-micro)', minWidth: 0,
            }}>
              <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{fmtExpiry(o.expiration)}</span>
              <span style={{ flex: 1 }} />
              <span style={{ color: o.sl ? 'var(--red)' : 'var(--text-muted)', flexShrink: 0 }}>
                SL {fmtPrice(o.sl)}
              </span>
              <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>·</span>
              <span style={{ color: o.tp ? 'var(--green)' : 'var(--text-muted)', flexShrink: 0 }}>
                TP {fmtPrice(o.tp)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};
