import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { fetchAccountSpecs, fetchAccountSymbols, openTrade, waitForCommand, type SymbolSpec } from '../../services/api';
import { useUIStore } from '../../stores/uiStore';
import { useTranslation } from '../../i18n/useTranslation';

interface Props {
  accountId: string;
  accountName: string;
  currency: string;
  /** What this account traded last, so the box opens on it, the way MT5 does. */
  lastSymbol?: string;
  lastVolume?: number;
  onClose: () => void;
}

/** How far a ticked stop or target starts from the entry, in MT5 points. */
const DEFAULT_STOP_POINTS = 1000;

type OrderType = 'market' | 'limit' | 'stop';

const inp: React.CSSProperties = {
  width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)',
  color: 'var(--text)', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)',
  padding: '7px 10px', outline: 'none', boxSizing: 'border-box', minWidth: 0,
};
const lbl: React.CSSProperties = {
  display: 'block', fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)',
  color: 'var(--text-dim)', letterSpacing: '.5px', marginBottom: '6px',
};

export const NewTradeDialog = ({
  accountId, accountName, currency, lastSymbol, lastVolume, onClose,
}: Props) => {
  const { addToast } = useUIStore();
  const t = useTranslation();
  const [loading, setLoading] = useState(false);
  const [symbol, setSymbol] = useState(lastSymbol ?? '');
  const [action, setAction] = useState<'BUY' | 'SELL'>('BUY');
  const [volume, setVolume] = useState(lastVolume ? lastVolume.toFixed(2) : '0.01');
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [price, setPrice] = useState('');
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');

  /**
   * A stop is on or off, and only then does it have a price.
   *
   * It used to be a number where 0 meant "no stop", which is a rule you
   * have to be told and cannot see. The tick says which of the two you
   * meant, and ticking it fills in a starting price to drag from rather
   * than an empty box to work out from scratch.
   */
  const [useSl, setUseSl] = useState(false);
  const [useTp, setUseTp] = useState(false);

  /**
   * Where the question got to.
   *
   * 'form' is the box. 'sending' is after the button, while the EA is
   * being asked. 'result' is the answer — which used to arrive as a toast
   * over whatever page you had moved on to, because the dialog closed the
   * instant the command was queued and "queued" is not an outcome.
   */
  const [phase, setPhase] = useState<'form' | 'sending' | 'result'>('form');
  const [result, setResult] = useState<{ ok: boolean; title: string; detail: string } | null>(null);

  const [specs, setSpecs] = useState<SymbolSpec[]>([]);

  // Suggestions: every symbol this account has held or traded. The box stays
  // a text field on top of them, so an instrument we have never seen can
  // still be typed in full.
  const [known, setKnown] = useState<string[]>([]);
  const [fromBroker, setFromBroker] = useState(0);
  const [openList, setOpenList] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const rawCur = currency || 'USD';

  useEffect(() => {
    let alive = true;
    fetchAccountSymbols(accountId)
      .then(({ symbols, fromBroker: n }) => {
        if (!alive) return;
        setKnown(symbols);
        setFromBroker(n);
      })
      .catch(() => { /* suggestions are a convenience, not a requirement */ });
    fetchAccountSpecs(accountId)
      .then(rows => { if (alive) setSpecs(rows); })
      // Only EA v1.4 sends these. Without them the box fills nothing in,
      // which is the old behaviour, not a broken one.
      .catch(() => { /* nothing to prefill with, and that is survivable */ });
    return () => { alive = false; };
  }, [accountId]);

  /** The terminal's figures for whatever is in the symbol box. */
  const spec = useMemo(() => {
    const q = symbol.trim().toUpperCase();
    return q ? specs.find(sp => sp.symbol.toUpperCase() === q) ?? null : null;
  }, [symbol, specs]);

  const round = (n: number) => Number(n.toFixed(spec?.digits ?? 5));

  /** What this order would be filled at, as best as is known right now. */
  const entryNow = (): number | null => {
    if (orderType !== 'market') {
      const p = parseFloat(price);
      if (p > 0) return p;
    }
    if (!spec) return null;
    return action === 'BUY' ? spec.ask : spec.bid;
  };

  /** A stop or a target DEFAULT_STOP_POINTS away, on the side it belongs. */
  const suggest = (kind: 'sl' | 'tp'): string => {
    const entry = entryNow();
    if (!entry || !spec?.point) return '';
    const away = DEFAULT_STOP_POINTS * spec.point;
    const below = (kind === 'sl') === (action === 'BUY');
    return String(round(below ? entry - away : entry + away));
  };

  // Type "xa" and every symbol holding those letters comes up, wherever they
  // sit in the name: a broker's gold is XAUUSD on one server and XAUUSD.v on
  // the next, and someone typing "gold" should not come away empty.
  const matches = useMemo(() => {
    const q = symbol.trim().toUpperCase();
    if (!q) return known.slice(0, 12);
    const starts = known.filter(s => s.toUpperCase().startsWith(q));
    const holds = known.filter(s => !s.toUpperCase().startsWith(q) && s.toUpperCase().includes(q));
    return [...starts, ...holds].slice(0, 12);
  }, [symbol, known]);

  // A click anywhere else closes the list. Without this it survives a tap on
  // the price field and covers it.
  useEffect(() => {
    if (!openList) return;
    const away = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpenList(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [openList]);

  const pick = (s: string) => { setSymbol(s); setOpenList(false); };

  const onSymbolKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!openList || matches.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => (h + 1) % matches.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => (h - 1 + matches.length) % matches.length); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(matches[Math.min(highlight, matches.length - 1)]); }
    else if (e.key === 'Escape') { setOpenList(false); }
  };

  const needsPrice = orderType !== 'market';

  /**
   * A pending order opens on the current price, the way MT5 does, and is
   * dragged from there. An empty box asks someone to remember where gold
   * is trading to five figures, which nobody does.
   */
  useEffect(() => {
    if (!needsPrice || price !== '' || !spec) return;
    setPrice(String(round(action === 'BUY' ? spec.ask : spec.bid)));
  }, [needsPrice, spec, action]);   // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async () => {
    const vol = parseFloat(volume);
    if (!symbol.trim()) { addToast({ type: 'error', title: 'Symbol is required' }); return; }
    if (!vol || vol <= 0) { addToast({ type: 'error', title: 'Volume must be > 0' }); return; }
    if (needsPrice && (!price || parseFloat(price) <= 0)) {
      addToast({ type: 'error', title: `Price is required for ${orderType} orders` });
      return;
    }
    setLoading(true);
    setPhase('sending');
    try {
      const { commandId } = await openTrade(accountId, {
        symbol: symbol.trim(), action, volume: vol,
        orderType,
        price: needsPrice ? parseFloat(price) : 0,
        sl: useSl ? parseFloat(sl) || 0 : 0,
        tp: useTp ? parseFloat(tp) || 0 : 0,
      });

      // "Queued" is not an outcome. Wait here, in front of the person who
      // pressed the button, until the EA answers — a ticket, or the reason
      // it was refused.
      const outcome = await waitForCommand(accountId, commandId);
      if (outcome?.status === 'done') {
        setResult({ ok: true, title: t('trade.placed'), detail: outcome.result ?? '' });
      } else if (outcome) {
        setResult({ ok: false, title: t('trade.refused'), detail: outcome.result ?? t('trade.no_reason') });
      } else {
        setResult({ ok: true, title: t('trade.sent_no_answer'), detail: t('trade.check_terminal') });
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? t('trade.queue_failed');
      setResult({ ok: false, title: t('trade.refused'), detail: msg });
    } finally {
      setLoading(false);
      setPhase('result');
    }
  };

  /** Back to the box with everything still in it, to place another. */
  const again = () => { setResult(null); setPhase('form'); };

  const buyColor = action === 'BUY' ? 'var(--green)' : 'var(--text-dim)';
  const sellColor = action === 'SELL' ? 'var(--red)' : 'var(--text-dim)';
  const disabled = loading || !symbol || !parseFloat(volume) || (needsPrice && !parseFloat(price));

  // The answer, in the box that asked the question.
  if (phase !== 'form') {
    const done = phase === 'result' && result;
    return (
      <Dialog open onClose={onClose} title={`NEW TRADE — ${accountName}`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0, padding: '8px 0' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <div style={{
              width: '34px', height: '34px', flexShrink: 0, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '18px', lineHeight: 1,
              background: !done ? 'var(--bg-input)' : result.ok ? 'rgba(52,211,153,.15)' : 'rgba(248,113,113,.15)',
              color: !done ? 'var(--text-dim)' : result.ok ? 'var(--green)' : 'var(--red)',
              border: `1px solid ${!done ? 'var(--border2)' : result.ok ? 'var(--green)' : 'var(--red)'}`,
            }}>{!done ? '·' : result.ok ? '✓' : '✕'}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-body)', letterSpacing: '.5px',
                color: !done ? 'var(--text-dim)' : result.ok ? 'var(--green)' : 'var(--red)',
              }}>{!done ? t('trade.sending') : result.title}</div>
              <div style={{
                marginTop: '4px', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)',
                color: 'var(--text-dim)', wordBreak: 'break-word',
              }}>
                {`${action} ${parseFloat(volume).toFixed(2)} ${symbol.trim()}`}
                {needsPrice && price && ` @ ${price}`}
                {done && result.detail ? ` — ${result.detail}` : ''}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              onClick={again}
              disabled={!done}
              style={{
                fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', padding: '9px 16px',
                background: 'none', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)',
                color: 'var(--text-dim)', cursor: done ? 'pointer' : 'not-allowed',
                opacity: done ? 1 : .5, letterSpacing: '.5px',
              }}
            >{t('trade.another')}</button>
            <button
              onClick={onClose}
              disabled={!done}
              style={{
                fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', padding: '9px 16px',
                background: 'var(--bg-input)', border: '1px solid var(--border2)',
                borderRadius: 'var(--radius-sm)', color: 'var(--text)',
                cursor: done ? 'pointer' : 'not-allowed', opacity: done ? 1 : .5, letterSpacing: '.5px',
              }}
            >{t('common.close')}</button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onClose} title={`NEW TRADE — ${accountName}`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 }}>

        {/* Warning */}
        <div style={{ padding: '10px 12px', background: 'rgba(251,191,36,.06)', border: '1px solid rgba(251,191,36,.3)', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-dim)', lineHeight: 1.6 }}>
          {t('trade.warning')}
        </div>

        {/* Symbol + Action */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div ref={boxRef} style={{ position: 'relative', minWidth: 0 }}>
            <label style={lbl}>{t('trade.symbol')}</label>
            <input
              type="text"
              value={symbol}
              onChange={e => { setSymbol(e.target.value); setOpenList(true); setHighlight(0); }}
              onFocus={() => setOpenList(true)}
              onKeyDown={onSymbolKey}
              placeholder="XAUUSD"
              // Deliberately not upper-cased, here or on the way out: MT5
              // symbol names are case-sensitive and this broker's gold is
              // XAUUSD.v, which XAUUSD.V would not find.
              style={inp}
              autoComplete="off"
              // No autofocus where focusing means a keyboard sliding over
              // half the dialog. On a tablet or a phone the first thing to
              // read is the warning, not a keyboard.
              autoFocus={typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches}
            />
            {openList && known.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 40,
                marginTop: '4px', maxHeight: '190px', overflowY: 'auto',
                background: 'var(--bg-card)', border: '1px solid var(--border2)',
                borderRadius: 'var(--radius-sm)', boxShadow: '0 8px 20px rgba(0,0,0,.45)',
              }}>
                {matches.length === 0 && (
                  <div style={{ padding: '8px 10px', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-muted)' }}>
                    {t('trade.no_symbols')}
                  </div>
                )}
                {matches.map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    onMouseDown={e => { e.preventDefault(); pick(s); }}
                    onMouseEnter={() => setHighlight(i)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '8px 10px', border: 'none', cursor: 'pointer',
                      background: i === highlight ? 'var(--bg-input)' : 'transparent',
                      color: 'var(--text)', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)',
                    }}
                  >{s}</button>
                ))}

                {/* Where these names come from. Until the reporter EA sends
                    the broker's list this is only what the account has
                    touched, and saying so beats looking incomplete. */}
                <div style={{
                  position: 'sticky', bottom: 0,
                  padding: '6px 10px', borderTop: '1px solid var(--border2)',
                  background: 'var(--bg-card)',
                  fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-micro)',
                  color: 'var(--text-muted)', lineHeight: 1.5,
                }}>
                  {fromBroker > 0
                    ? `${known.length} ${t('trade.from_broker')}`
                    : t('trade.from_history')}
                </div>
              </div>
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <label style={lbl}>{t('trade.action')}</label>
            <div style={{ display: 'flex', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)' }}>
              <button
                onClick={() => setAction('BUY')}
                style={{ flex: 1, minWidth: 0, padding: '7px', fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', cursor: 'pointer', background: action === 'BUY' ? 'var(--green)' : 'none', color: action === 'BUY' ? '#25272c' : buyColor, border: 'none', letterSpacing: '.5px' }}
              >BUY</button>
              <button
                onClick={() => setAction('SELL')}
                style={{ flex: 1, minWidth: 0, padding: '7px', fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', cursor: 'pointer', background: action === 'SELL' ? 'var(--red)' : 'none', color: action === 'SELL' ? '#fff' : sellColor, border: 'none', borderLeft: '1px solid var(--border2)', letterSpacing: '.5px' }}
              >SELL</button>
            </div>
          </div>
        </div>

        {/* Volume + Order Type */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div style={{ minWidth: 0 }}>
            <label style={lbl}>{t('trade.volume')}</label>
            <input type="number" step="0.01" min="0.01" value={volume} onChange={e => setVolume(e.target.value)} style={inp} />
          </div>
          <div style={{ minWidth: 0 }}>
            <label style={lbl}>{t('trade.order_type')}</label>
            <select value={orderType} onChange={e => setOrderType(e.target.value as OrderType)} style={inp}>
              <option value="market">{t('trade.market')}</option>
              <option value="limit">{t('trade.limit')}</option>
              <option value="stop">{t('trade.stop')}</option>
            </select>
          </div>
        </div>

        {/* Pending price. A limit waits for the price to come back to it, a
            stop waits for it to break through — so the field says which. */}
        {needsPrice && (
          <div>
            <label style={lbl}>{orderType === 'limit' ? t('trade.limit_price') : t('trade.stop_price')}</label>
            <input type="number" step="0.00001" value={price} onChange={e => setPrice(e.target.value)} placeholder={t('trade.entry_price')} style={inp} />
          </div>
        )}

        {/* SL + TP. The tick says whether there is one at all; the box
            below it only exists once there is, and opens on a price a
            thousand points out to drag from rather than empty. */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div style={{ minWidth: 0 }}>
            <label style={{ ...lbl, display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={useSl}
                onChange={e => {
                  setUseSl(e.target.checked);
                  if (e.target.checked) { if (!sl) setSl(suggest('sl')); } else setSl('');
                }}
                style={{ width: '16px', height: '16px', accentColor: 'var(--red)', cursor: 'pointer' }}
              />
              {t('trade.stop_loss')}
            </label>
            {useSl && (
              <input type="number" step="0.00001" value={sl} onChange={e => setSl(e.target.value)} style={inp} />
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <label style={{ ...lbl, display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={useTp}
                onChange={e => {
                  setUseTp(e.target.checked);
                  if (e.target.checked) { if (!tp) setTp(suggest('tp')); } else setTp('');
                }}
                style={{ width: '16px', height: '16px', accentColor: 'var(--green)', cursor: 'pointer' }}
              />
              {t('trade.take_profit')}
            </label>
            {useTp && (
              <input type="number" step="0.00001" value={tp} onChange={e => setTp(e.target.value)} style={inp} />
            )}
          </div>
        </div>
        {(useSl || useTp) && !spec && (
          <div style={{
            fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-muted)',
          }}>{t('trade.no_specs')}</div>
        )}

        {/* Summary preview */}
        {symbol && parseFloat(volume) > 0 && (
          <div style={{
            padding: '10px 12px',
            background: action === 'BUY' ? 'rgba(52,211,153,.08)' : 'rgba(248,113,113,.08)',
            border: `1px solid ${action === 'BUY' ? 'rgba(52,211,153,.3)' : 'rgba(248,113,113,.3)'}`,
            fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)', color: 'var(--text-dim)',
            wordBreak: 'break-word',
          }}>
            <span style={{ color: action === 'BUY' ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{action}</span>
            {orderType !== 'market' && <span style={{ color: 'var(--text-dim)' }}> {orderType.toUpperCase()}</span>}
            {' '}{parseFloat(volume).toFixed(2)} lots{' '}
            <span style={{ color: 'var(--text)' }}>{symbol.trim()}</span>
            {needsPrice && price && ` @ ${price}`}
            {useSl && parseFloat(sl) > 0 && <span style={{ color: 'var(--red)' }}> SL:{sl}</span>}
            {useTp && parseFloat(tp) > 0 && <span style={{ color: 'var(--green)' }}> TP:{tp}</span>}
            <span style={{ color: 'var(--text-dim)' }}> on {accountName} ({rawCur})</span>
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', paddingTop: '4px' }}>
          <button onClick={onClose} disabled={loading}
            style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', padding: '9px 16px', background: 'none', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', color: 'var(--text-dim)', cursor: 'pointer', letterSpacing: '.5px' }}>
            {t('trade.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={disabled}
            style={{
              fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', padding: '9px 16px', letterSpacing: '.5px',
              background: action === 'BUY' ? 'var(--green)' : 'var(--red)',
              color: action === 'BUY' ? '#25272c' : '#fff',
              border: `1px solid ${action === 'BUY' ? 'var(--green)' : 'var(--red)'}`,
              borderRadius: 'var(--radius-sm)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? .5 : 1,
            }}
          >
            {loading ? t('trade.sending') : `${t('trade.confirm')} ${action}`}
          </button>
        </div>
      </div>
    </Dialog>
  );
};
