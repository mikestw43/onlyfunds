import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchAccounts, openTrade, closePosition, setPositionSLTP, closeAllOrders, waitForCommand,
  priceRisk, type RiskSummary,
} from '../../services/api';
import { useTranslation } from '../../i18n/useTranslation';
import type { Account } from '../../types';

/**
 * The orders the assistant wrote out, and the button that sends them.
 *
 * It does not place trades — nothing it says reaches an EA. It fills the
 * form in; a person reads it and presses confirm. That is the whole
 * safety model, so every field that will be sent is on screen, in words,
 * with the account named and marked when it is real money.
 *
 * Two things are deliberately not taken from the model: the money, which
 * the server works out from the terminal's own contract figures, and the
 * numbers themselves, which can be corrected here before anything goes.
 *
 * On an account marked for it — a practice account — there is no button:
 * the card counts down and sends. That is the point of the setting.
 */

export interface Row {
  action: 'open' | 'close' | 'sltp' | 'closeAll';
  symbol?: string;
  side?: 'buy' | 'sell';
  lots?: number;
  orderType?: 'market' | 'limit' | 'stop';
  price?: number;
  sl?: number;
  tp?: number;
  /** A stop written as a distance — "20 points away" — which the server
   *  turns into a price from the terminal's own point size. */
  slPoints?: number;
  tpPoints?: number;
  ticket?: number;
}

export interface Plan {
  account: string;
  rows: Row[];
}

const BLOCK = /```[a-zA-Z]*\s*(\{[\s\S]*?\})\s*```/g;
const ACTIONS = ['open', 'close', 'sltp', 'closeAll'];

const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : undefined;
};

const asRow = (raw: unknown): Row | null => {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const action = String(r.action ?? '');
  if (!ACTIONS.includes(action)) return null;
  return {
    action: action as Row['action'],
    ...(typeof r.symbol === 'string' && { symbol: r.symbol }),
    ...(r.side === 'buy' || r.side === 'sell' ? { side: r.side } : {}),
    ...(num(r.lots) !== undefined && { lots: num(r.lots) }),
    ...(['market', 'limit', 'stop'].includes(String(r.orderType))
      ? { orderType: String(r.orderType) as Row['orderType'] } : {}),
    ...(num(r.price) !== undefined && { price: num(r.price) }),
    ...(num(r.sl) !== undefined && { sl: num(r.sl) }),
    ...(num(r.tp) !== undefined && { tp: num(r.tp) }),
    ...(num(r.slPoints) !== undefined && { slPoints: num(r.slPoints) }),
    ...(num(r.tpPoints) !== undefined && { tpPoints: num(r.tpPoints) }),
    ...(num(r.ticket) !== undefined && { ticket: num(r.ticket) }),
  };
};

/**
 * Pull the plan out of an answer and hand back the answer without it.
 *
 * Two shapes are accepted: the batch one, {account, orders:[…]}, and a
 * single order written at the top level, which is what the first version
 * of this asked for and what a model will sometimes write anyway.
 */
export const readPlan = (text: string): { plan: Plan | null; rest: string } => {
  for (const m of text.matchAll(BLOCK)) {
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(m[1]) as Record<string, unknown>; } catch { continue; }
    if (typeof parsed.account !== 'string') continue;

    const rows = Array.isArray(parsed.orders)
      // Twenty, because a grid is the reason anyone writes more than one
      // row at a time and ten stopped one entry plus a ten-leg ladder —
      // the shape that was actually asked for. The cap is not the guard
      // anyway: the card prices every row against the terminal and shows
      // what the lot goes to if they all stop, and nothing is sent until
      // that has been read and the button pressed.
      ? parsed.orders.map(asRow).filter((r): r is Row => !!r).slice(0, 20)
      : [asRow(parsed)].filter((r): r is Row => !!r);

    if (rows.length === 0) continue;
    return { plan: { account: parsed.account, rows }, rest: text.replace(m[0], '').trim() };
  }
  return { plan: null, rest: text };
};

type Outcome = { row: number; ok: boolean; text: string };
type State = 'idle' | 'counting' | 'sending' | 'done' | 'cancelled';

/** Seconds before an account that trades on its own goes ahead. */
const AUTO_DELAY = 5;

export const OrderDraftCard = ({ plan }: { plan: Plan }) => {
  const t = useTranslation();
  const [rows, setRows] = useState<Row[]>(plan.rows);
  const [state, setState] = useState<State>('idle');
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [risk, setRisk] = useState<RiskSummary | null>(null);
  const [countdown, setCountdown] = useState(AUTO_DELAY);
  const sentOnce = useRef(false);

  const { data: accounts } = useQuery<Account[]>({
    queryKey: ['accounts'],
    queryFn: fetchAccounts,
    staleTime: 30_000,
  });

  const wanted = plan.account.replace(/[^0-9]/g, '');
  const account = (accounts ?? []).find(a => a.accountNumber.replace(/[^0-9]/g, '') === wanted);
  const auto = !!account?.aiAutoTrade;
  const opens = rows.filter(r => r.action === 'open');

  // What it costs if every stop is hit. Asked of the server, because the
  // model's arithmetic is not what should decide that number.
  useEffect(() => {
    if (!account || opens.length === 0) { setRisk(null); return; }
    let alive = true;
    void priceRisk(account.id, opens.map(r => ({
      symbol: r.symbol ?? '',
      side: r.side ?? 'buy',
      // Only a pending order has a price of its own. A market order is
      // filled at whatever the market is, and a price on one is either
      // left over from an edit or, as happened here, invented by the
      // model to work a stop out from — feeding that back in as the
      // entry made every check agree with the invention, including the
      // one that exists to catch a stop on the wrong side. Leave it out
      // and the server prices it off the terminal's own bid and ask.
      ...(r.orderType && r.orderType !== 'market' && r.price ? { entry: r.price } : {}),
      ...(r.sl ? { sl: r.sl } : {}),
      ...(r.tp ? { tp: r.tp } : {}),
      ...(r.slPoints ? { slPoints: r.slPoints } : {}),
      ...(r.tpPoints ? { tpPoints: r.tpPoints } : {}),
      lots: r.lots ?? 0,
    }))).then(r => {
      if (!alive) return;
      setRisk(r);
      // Show what the distance comes to, so there is a price to check
      // against — but keep the distance itself on the row. A market order
      // carries it all the way to the EA, which measures it from the price
      // it actually fills at; this preview is against the last quote and
      // will be a little out by the time it fills, which is the whole
      // reason the distance travels rather than the price.
      setRows(list => {
        let changed = false;
        const next = list.map(row => {
          if (!row.slPoints && !row.tpPoints) return row;
          const priced = r.rows[list.filter(x => x.action === 'open').indexOf(row)];
          if (!priced) return row;
          if ((priced.sl ?? 0) === (row.sl ?? 0) && (priced.tp ?? 0) === (row.tp ?? 0)) return row;
          changed = true;
          return {
            ...row,
            ...(priced.sl ? { sl: priced.sl } : {}),
            ...(priced.tp ? { tp: priced.tp } : {}),
          };
        });
        return changed ? next : list;
      });
    }).catch(() => {});
    return () => { alive = false; };
  }, [account?.id, JSON.stringify(opens)]);

  const sendAll = async () => {
    if (!account || state === 'sending') return;
    setState('sending');
    const results: Outcome[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        let commandId = '';
        if (r.action === 'open') {
          commandId = (await openTrade(account.id, {
            symbol: r.symbol ?? '',
            action: r.side === 'sell' ? 'SELL' : 'BUY',
            volume: r.lots ?? 0,
            orderType: r.orderType ?? 'market',
            ...(r.orderType && r.orderType !== 'market' ? { price: r.price ?? 0 } : {}),
            // The distance wins where it survives: only a market order
            // gains anything from it, and only until someone types a price.
            ...(r.slPoints ? { slPoints: r.slPoints } : r.sl ? { sl: r.sl } : {}),
            ...(r.tpPoints ? { tpPoints: r.tpPoints } : r.tp ? { tp: r.tp } : {}),
          })).commandId;
        } else if (r.action === 'close') {
          commandId = (await closePosition(account.id, r.ticket ?? 0, r.lots)).commandId;
        } else if (r.action === 'sltp') {
          commandId = (await setPositionSLTP(account.id, r.ticket ?? 0, r.sl ?? 0, r.tp ?? 0)).commandId;
        } else {
          commandId = ((await closeAllOrders(account.id)) as { commandId?: string }).commandId ?? '';
        }

        const outcome = commandId ? await waitForCommand(account.id, commandId) : null;
        results.push(outcome
          ? { row: i, ok: outcome.status === 'done', text: outcome.result || (outcome.status === 'done' ? t('draft.done') : t('draft.refused')) }
          : { row: i, ok: true, text: t('draft.sent_no_answer') });
      } catch (err) {
        const data = (err as { response?: { data?: { error?: string; message?: string } } }).response?.data;
        results.push({ row: i, ok: false, text: data?.error || data?.message || t('ai.unreachable') });
      }
      setOutcomes([...results]);
    }
    setState('done');
  };

  // Always the newest version, so a row edited during the countdown is
  // the row that gets sent — not the one this card was born with.
  const sendRef = useRef(sendAll);
  sendRef.current = sendAll;

  /**
   * An account that trades on its own still waits a few seconds, so a
   * plan that is plainly wrong can be stopped by whoever is watching.
   *
   * The deadline is a timestamp rather than a countdown variable, and
   * the guard is "has it been sent" rather than "has it started": in
   * development React mounts every component twice, which cleared the
   * first interval and left the card counting 5… for ever.
   */
  useEffect(() => {
    if (!auto || !account || sentOnce.current) return;
    setState('counting');
    const deadline = Date.now() + AUTO_DELAY * 1000;
    const tick = setInterval(() => {
      const left = Math.ceil((deadline - Date.now()) / 1000);
      setCountdown(Math.max(0, left));
      if (left > 0) return;
      clearInterval(tick);
      if (sentOnce.current) return;
      sentOnce.current = true;
      void sendRef.current();
    }, 250);
    return () => clearInterval(tick);
  }, [auto, account?.id]);

  const edit = (i: number, field: keyof Row, value: string) => {
    setRows(list => list.map((r, k) => {
      if (k !== i) return r;
      const next: Row = { ...r, [field]: field === 'symbol' ? value : Number(value) };
      // Typing a stop means that stop, at that price. Keeping the distance
      // as well would have the EA recompute it from the fill and quietly
      // overwrite what was just typed.
      if (field === 'sl') delete next.slPoints;
      if (field === 'tp') delete next.tpPoints;
      return next;
    }));
    setRisk(null);
  };

  const money = (n: number): string =>
    `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${risk?.currency ?? ''}`;

  const label = (r: Row): string => {
    if (r.action === 'close') return `${t('draft.close')} #${r.ticket}${r.lots ? ` · ${r.lots} lot` : ''}`;
    if (r.action === 'closeAll') return t('draft.close_all');
    if (r.action === 'sltp') return `#${r.ticket} · SL ${r.sl || '—'} · TP ${r.tp || '—'}`;
    const side = r.side === 'sell' ? t('draft.sell') : t('draft.buy');
    const kind = r.orderType ?? 'market';
    return `${side} ${r.symbol} · ${kind === 'market' ? t('draft.at_market') : kind}`;
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border2)',
    borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
    fontFamily: 'var(--ff-body)', fontSize: '15px', padding: '7px 8px', outline: 'none',
    boxSizing: 'border-box', textAlign: 'right',
  };
  const cap: React.CSSProperties = {
    fontFamily: 'var(--ff-label)', fontSize: 'var(--fs-micro)', letterSpacing: '.5px',
    color: 'var(--text-muted)', display: 'block', marginBottom: '3px',
  };

  const busy = state === 'sending';
  const finished = state === 'done';

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: `1px solid ${finished ? 'var(--border2)' : auto ? 'var(--warning)' : 'var(--accent-blue)'}`,
      borderRadius: 'var(--radius-sm)', padding: '12px', minWidth: 0,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px',
        fontFamily: 'var(--ff-label)', fontSize: 'var(--fs-micro)', letterSpacing: '1px',
        color: auto ? 'var(--warning)' : 'var(--accent-blue)',
      }}>
        <span>{auto ? t('draft.auto_title') : t('draft.title')}</span>
        <span style={{ marginLeft: 'auto', color: 'var(--text-primary)', letterSpacing: 0 }}>
          {account ? `${account.name} · #${account.accountNumber}` : `#${wanted}`}
          {account && (account.isDemo
            ? <span style={{ color: 'var(--text-muted)' }}> · DEMO</span>
            : <span style={{ color: 'var(--warning)' }}> · {t('draft.live')}</span>)}
        </span>
      </div>

      {rows.map((r, i) => {
        const priced = risk?.rows[opens.indexOf(r)];
        const outcome = outcomes.find(o => o.row === i);
        return (
          <div key={i} style={{
            padding: '9px 0',
            borderTop: i === 0 ? 'none' : '1px dashed var(--border-color)',
          }}>
            <div style={{
              fontFamily: 'var(--ff-body)', fontSize: '15.5px', color: 'var(--text-primary)',
              fontWeight: 600, marginBottom: r.action === 'open' ? '8px' : 0,
            }}>{label(r)}</div>

            {r.action === 'open' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                {([
                  ['lots', t('draft.lots')],
                  ['price', r.orderType === 'market' ? t('draft.price_market') : t('draft.price')],
                  ['sl', 'SL'],
                  ['tp', 'TP'],
                ] as const).map(([field, caption]) => (
                  <label key={field}>
                    <span style={cap}>{caption}</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={(r[field] as number | undefined) ?? ''}
                      disabled={busy || finished || r.orderType === 'market' && field === 'price'}
                      onChange={e => edit(i, field, e.target.value)}
                      style={inputStyle}
                    />
                  </label>
                ))}
              </div>
            )}

            {priced && (priced.risk != null || priced.problems.length > 0) && (
              <div style={{
                marginTop: '6px', fontFamily: 'var(--ff-body)', fontSize: '13px', lineHeight: 1.6,
                color: priced.problems.length ? 'var(--danger)' : 'var(--text-muted)',
              }}>
                {priced.problems.length
                  ? priced.problems.join(' · ')
                  : `${t('draft.risk')} ${money(priced.risk ?? 0)}${priced.rr ? ` · RR 1:${priced.rr}` : ''}`}
              </div>
            )}

            {outcome && (
              <div style={{
                marginTop: '6px', fontFamily: 'var(--ff-body)', fontSize: '13.5px', lineHeight: 1.6,
                color: outcome.ok ? 'var(--success)' : 'var(--danger)',
              }}>{outcome.ok ? '✓ ' : '✕ '}{outcome.text}</div>
            )}
          </div>
        );
      })}

      {/* What the whole plan costs if every stop is hit — the line that
          stops a plan that looked reasonable row by row. */}
      {risk && risk.totalRisk > 0 && (
        <div style={{
          marginTop: '10px', padding: '9px 10px', borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-input)',
          fontFamily: 'var(--ff-body)', fontSize: '14px', lineHeight: 1.6,
          color: (risk.riskPercent ?? 0) > 5 ? 'var(--danger)' : 'var(--text-primary)',
        }}>
          {t('draft.all_stops')} <strong>−{money(risk.totalRisk)}</strong>
          {risk.riskPercent != null && ` · ${risk.riskPercent}% ${t('draft.of_equity')}`}
        </div>
      )}

      {!account && (
        <div style={{
          marginTop: '8px', fontFamily: 'var(--ff-body)', fontSize: '13.5px',
          color: 'var(--danger)', lineHeight: 1.6,
        }}>{t('draft.no_account')}</div>
      )}

      {state === 'cancelled' && (
        <div style={{ marginTop: '10px', fontFamily: 'var(--ff-body)', fontSize: '14px', color: 'var(--text-muted)' }}>
          {t('draft.cancelled')}
        </div>
      )}

      {(state === 'idle' || state === 'counting' || busy) && account && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          <button
            onClick={() => { sentOnce.current = true; void sendAll(); }}
            disabled={busy}
            style={{
              flex: 2, padding: '11px', borderRadius: 'var(--radius-sm)', border: 'none',
              background: auto ? 'var(--warning)' : 'var(--accent-blue)', color: '#12151a',
              fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', letterSpacing: '.5px',
              cursor: busy ? 'default' : 'pointer', opacity: busy ? .6 : 1,
            }}
          >
            {busy ? t('draft.sending')
              : state === 'counting' ? `${t('draft.auto_in')} ${countdown}…`
              : rows.length > 1 ? `${t('draft.confirm_all')} (${rows.length})`
              : t('draft.confirm')}
          </button>
          <button
            onClick={() => { sentOnce.current = true; setState('cancelled'); }}
            disabled={busy}
            style={{
              flex: 1, padding: '11px', borderRadius: 'var(--radius-sm)',
              background: 'none', border: '1px solid var(--border2)', color: 'var(--text-primary)',
              fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', letterSpacing: '.5px',
              cursor: busy ? 'default' : 'pointer',
            }}
          >{t('common.cancel')}</button>
        </div>
      )}
    </div>
  );
};


/* ------------------------------------------------------------------ *
 * "Remember this?"
 *
 * The other thing an answer can carry. A model cannot learn from being
 * talked to, so the nearest thing is asking for a line to be kept and
 * read back to it on every future question. It asks; the person keeps
 * it or does not.
 * ------------------------------------------------------------------ */

export const readMemoryOffer = (text: string): { offer: string | null; rest: string } => {
  for (const m of text.matchAll(/```[a-zA-Z]*\s*(\{[\s\S]*?\})\s*```/g)) {
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(m[1]) as Record<string, unknown>; } catch { continue; }
    if (typeof parsed.text !== 'string' || parsed.action || parsed.orders) continue;
    const offer = parsed.text.trim();
    if (offer.length < 3) continue;
    return { offer, rest: text.replace(m[0], '').trim() };
  }
  return { offer: null, rest: text };
};
