import { useState, useEffect, useRef } from 'react';
import type { Account, AccountGroup, Order, PendingOrder } from '../../types';
import { formatLots, formatPercent, getDrawdownColor, formatBrokerShort } from '../../utils/formatters';
import { FlashNumber } from '../ui/FlashNumber';
import { CloseAllDialog } from './CloseAllDialog';
import { ProtectionSettings } from '../settings/ProtectionSettings';
import { PositionPanel } from './PositionPanel';
import { NewTradeDialog } from './NewTradeDialog';
import { PendingPanel } from './PendingPanel';
import { useQueryClient } from '@tanstack/react-query';
import { useUIStore } from '../../stores/uiStore';
import { fetchGroups, assignAccountGroup } from '../../services/api';
import { useTranslation } from '../../i18n/useTranslation';

interface Props {
  account: Account;
  todayPnl?: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const fmtNum = (v: number) =>
  Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtPrice = (v: number) =>
  v === 0 ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const getDdBadgeStyle = (dd: number, offline: boolean) => {
  if (offline) return {
    border: '1px solid rgba(248,113,113,.5)',
    color: 'var(--danger)',
    background: 'rgba(248,113,113,.08)',
  };
  if (dd < 10) return {
    border: '1px solid rgba(52,211,153,.5)',
    color: 'var(--success)',
    background: 'rgba(52,211,153,.08)',
  };
  if (dd < 30) return {
    border: '1px solid rgba(251,191,36,.5)',
    color: 'var(--warning)',
    background: 'rgba(251,191,36,.07)',
  };
  return {
    border: '1px solid rgba(248,113,113,.5)',
    color: 'var(--danger)',
    background: 'rgba(248,113,113,.08)',
  };
};

export const BotCard = ({ account, todayPnl = 0 }: Props) => {
  const t = useTranslation();
  const [showCloseAll, setShowCloseAll] = useState(false);
  const [showProtection, setShowProtection] = useState(false);
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [showPositions, setShowPositions] = useState(false);
  const [showNewTrade, setShowNewTrade] = useState(false);
  const [groups, setGroups] = useState<AccountGroup[]>([]);
  const groupRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { addToast } = useUIStore();
  const openTradeHistory = useUIStore(s => s.openTradeHistory);

  useEffect(() => {
    if (!showGroupPicker) return;
    const handler = (e: MouseEvent) => {
      if (groupRef.current && !groupRef.current.contains(e.target as Node)) {
        setShowGroupPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showGroupPicker]);

  const handleGroupPicker = async () => {
    if (!showGroupPicker) {
      try { setGroups(await fetchGroups()); } catch { /* ignore */ }
    }
    setShowGroupPicker(prev => !prev);
  };

  const handleAssignGroup = async (groupId: string | null) => {
    try {
      await assignAccountGroup(account.id, groupId);
      setShowGroupPicker(false);
      addToast({ type: 'success', title: groupId ? 'Group assigned' : 'Group removed' });
    } catch {
      addToast({ type: 'error', title: 'Failed to assign group' });
    }
  };

  const isOnline = account.status === 'online';
  const isDemo = account.isDemo ?? false;
  const orderCount = typeof account.orders === 'number' ? account.orders : account.orders.length;
  const ordersArray: Order[] = Array.isArray(account.orders) ? account.orders : [];
  // Sent by the EA on every push and, until now, shown nowhere: a card
  // reading "0 open" on an account holding nine pending orders looked like
  // an account doing nothing.
  const pendingArray: PendingOrder[] = Array.isArray(account.pending) ? account.pending : [];

  /**
   * What this account traded last, for the NEW TRADE box to open on.
   *
   * Newest open position first, then the newest pending order. Both are
   * already on screen, so nothing is fetched for it — and an account that
   * has done nothing yet simply opens on an empty box, as before.
   */
  const last = (() => {
    const newest = [...ordersArray].sort(
      (a, b) => new Date(b.openTime).getTime() - new Date(a.openTime).getTime())[0];
    if (newest) return { symbol: newest.symbol, lots: newest.lots };
    const p = pendingArray[pendingArray.length - 1];
    return p ? { symbol: p.symbol, lots: p.lots } : null;
  })();
  // USDC is a dollar stablecoin and the server converts it 1:1; mapping it to
  // USC here displayed it as cents, a hundredfold away from the KPI tiles.
  const cur = account.currency || 'USD';

  const onSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['overview'] });
    queryClient.invalidateQueries({ queryKey: ['heatmap-orders'] });
  };

  const ddBadge = getDdBadgeStyle(account.drawdown, !isOnline);
  const ddPct = Math.min(account.drawdown, 100);

  return (
    <>
      <div className={`bot-card${isDemo ? ' bc-demo' : !isOnline ? ' bc-offline' : ''}`}>

        {/* ── bc-top ── */}
        <div style={{
          padding: '10px 12px 8px',
          background: 'var(--bg-tertiary)',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            {/* Status dot */}
            <div className={isOnline ? 'sdot-on' : 'sdot-off'} />

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{
                  fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', fontWeight: 400,
                  color: isOnline ? 'var(--text-primary)' : 'var(--text-muted)',
                }}>
                  {account.name}
                </span>
                {isDemo && (
                  <span style={{
                    fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)',
                    padding: '2px 5px',
                    border: '1px solid rgba(251,191,36,.4)',
                    color: 'var(--warning)',
                    background: 'rgba(251,191,36,.08)',
                    letterSpacing: '.3px',
                    flexShrink: 0,
                  }}>DEMO</span>
                )}
              </div>
              <div style={{
                fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)',
                color: 'var(--text-muted)', marginTop: '4px',
                display: 'flex', alignItems: 'center', gap: '4px',
              }}>
                #{account.accountNumber}
                <span style={{
                  border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '1px 4px',
                  fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', color: 'var(--text-muted)',
                }}>{cur}</span>
                {/* Group picker */}
                <div style={{ position: 'relative' }} ref={groupRef}>
                  <button
                    onClick={handleGroupPicker}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '2px',
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text-muted)', fontFamily: 'inherit', fontSize: 'inherit',
                      padding: '0 2px',
                    }}
                    title={account.groupName || 'Assign group'}
                  >
                    {account.groupName ? (
                      <>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: account.groupColor || '#6b7280' }} />
                        <span style={{ maxWidth: '50px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{account.groupName}</span>
                      </>
                    ) : (
                      <span>⊙</span>
                    )}
                  </button>
                  {showGroupPicker && (
                    <div style={{
                      position: 'absolute', left: 0, top: '100%', marginTop: '2px',
                      width: '150px', background: 'var(--bg-card)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)',
                      zIndex: 50, maxHeight: '160px', overflowY: 'auto',
                    }}>
                      {account.groupId && (
                        <button onClick={() => handleAssignGroup(null)} style={{ width: '100%', padding: '6px 10px', textAlign: 'left', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer' }}>
                          ✕ Remove group
                        </button>
                      )}
                      {groups.map(g => (
                        <button key={g.id} onClick={() => handleAssignGroup(g.id)} style={{ width: '100%', padding: '6px 10px', textAlign: 'left', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: account.groupId === g.id ? 'var(--accent-blue)' : 'var(--text-primary)', background: account.groupId === g.id ? 'rgba(96,165,250,.08)' : 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: g.color, flexShrink: 0 }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</span>
                        </button>
                      ))}
                      {groups.length === 0 && <p style={{ padding: '8px 10px', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-muted)' }}>No groups</p>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* DD Badge */}
          <div style={{
            fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', fontWeight: 400,
            padding: '3px 8px',
            ...ddBadge,
            ...((!isOnline) ? { animation: 'blink-border .8s step-end infinite' } : {}),
          }}>
            {isOnline ? `DD ${formatPercent(account.drawdown)}` : 'OFFLINE'}
          </div>
        </div>

        {/* ── Progress bar ── */}
        <div style={{ height: '3px', background: 'var(--border-color)' }}>
          <div style={{
            height: '100%',
            width: isOnline ? `${ddPct}%` : '100%',
            background: isOnline
              ? `linear-gradient(90deg, var(--success), var(--accent-blue))`
              : `linear-gradient(90deg, var(--danger), #fb923c)`,
            transition: 'width .4s',
          }} />
        </div>

        {/* ── bc-body ── */}
        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>

          {/* Row 1: Balance | Equity | Orders */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
            {[
              { label: t('bot.balance'), value: fmtPrice(account.balance), color: 'var(--text-primary)' },
              { label: t('bot.equity'),  value: fmtPrice(account.equity),  color: account.equity >= account.balance ? 'var(--text-primary)' : 'var(--danger)' },
              { label: t('bot.orders'),  value: `${orderCount} ${t('bot.open_suffix')}`,      color: orderCount > 0 ? 'var(--text-primary)' : 'var(--text-muted)' },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <div className="bc-label" style={{ marginBottom: '2px' }}>{label}</div>
                <div className="bc-value" style={{ color }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Row 2: Margin | Margin Level */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
            {[
              { label: t('bot.margin'), value: isOnline ? fmtPrice(account.margin ?? 0) : '—', color: 'var(--text-primary)' },
              { label: t('bot.margin_level'), value: isOnline && (account.marginLevel ?? 0) > 0 ? `${(account.marginLevel ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : '—', color: 'var(--text-primary)' },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <div className="bc-label" style={{ marginBottom: '2px' }}>{label}</div>
                <div className="bc-value" style={{ color }}>{value}</div>
              </div>
            ))}
            <div /> {/* empty */}
          </div>

          {/* P/L section */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            {/* Today P/L */}
            <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
              <div className="bc-label" style={{ marginBottom: '3px' }}>{t('bot.today')}</div>
              <div
                className="bc-value-lg"
                style={{
                  color: todayPnl > 0 ? 'var(--success)' : todayPnl < 0 ? 'var(--danger)' : 'var(--text-muted)',
                }}
              >
                {todayPnl > 0 ? '+' : todayPnl < 0 ? '-' : ''}{fmtNum(Math.abs(todayPnl))}
              </div>
            </div>
            {/* Floating P/L */}
            <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
              <div className="bc-label" style={{ marginBottom: '3px' }}>{t('bot.floating_pl')}</div>
              <FlashNumber
                value={account.profit}
                format={(v) => `${v >= 0 ? '+' : '-'}${fmtNum(Math.abs(v))}`}
                positiveGreen
                className="bc-value-lg"
              />
            </div>
          </div>

          {/* Lot exposure + broker on the same row (broker pushed right). */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className="bc-label">{t('bot.lot_exposure')}</span>
            <span className="bc-chip" style={{ padding: '3px 7px', fontWeight: 700, background: 'rgba(96,165,250,.12)', color: 'var(--accent-blue)', border: '1px solid rgba(96,165,250,.3)' }}>
              B:{formatLots(account.buyLots)}
            </span>
            <span className="bc-chip" style={{ padding: '3px 7px', fontWeight: 700, background: 'rgba(248,113,113,.12)', color: 'var(--danger)', border: '1px solid rgba(248,113,113,.3)' }}>
              S:{formatLots(account.sellLots)}
            </span>
            <span className="bc-label" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--text-muted)', flexShrink: 0 }} />
              {formatBrokerShort(account.broker)}
            </span>
          </div>
        </div>

        {/* ── bc-footer — tight padding so the action row reads compact ── */}
        <div style={{
          padding: '5px 10px',
          borderTop: '1px solid var(--border-color)',
          display: 'flex', gap: '5px',
          background: 'var(--bg-tertiary)',
        }}>
          {isOnline ? (
            <>
              {/* ORDERS — primary cyan fill, toggles the open-positions panel */}
              {/* Filled blue made it read as the one thing to press, when it is
                  one of four equal ways into the account. It is outlined like
                  the others; being open is said by the caret and by the panel
                  that is open below it. */}
              <button
                onClick={() => setShowPositions(p => !p)}
                aria-expanded={showPositions}
                className="bc-action"
                style={{
                  flex: 1,
                  border: `1px solid ${showPositions ? 'var(--accent-blue)' : 'var(--border2)'}`,
                  borderRadius: 'var(--radius-sm)',
                  color: showPositions ? 'var(--accent-blue)' : 'var(--text-muted)',
                  background: showPositions ? 'rgba(96,165,250,.08)' : 'none',
                  cursor: 'pointer', textAlign: 'center',
                  transition: 'all .15s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent-blue)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent-blue)'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(96,165,250,.08)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = showPositions ? 'var(--accent-blue)' : 'var(--border2)'; (e.currentTarget as HTMLButtonElement).style.color = showPositions ? 'var(--accent-blue)' : 'var(--text-muted)'; (e.currentTarget as HTMLButtonElement).style.background = showPositions ? 'rgba(96,165,250,.08)' : 'none'; }}
              >
                {showPositions ? `▾ ${t('bot.orders')}` : t('bot.orders')}
              </button>

              {/* HISTORY — this button used to call the very same toggle as the
                  one beside it, so the card had two ways to do one thing and
                  no way to reach the closed trades. Open positions live on
                  the left, closed ones a tap to the right. */}
              <button
                onClick={() => openTradeHistory(account.id)}
                className="bc-action"
                style={{
                  flex: 1,
                  border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-muted)',
                  background: 'none',
                  cursor: 'pointer', textAlign: 'center',
                  transition: 'all .15s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent-blue)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent-blue)'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(96,165,250,.08)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border2)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
              >
                {t('bot.history')}
              </button>

              {/* + TRADE */}
              <button
                onClick={() => setShowNewTrade(true)}
                className="bc-action"
                style={{
                  flex: 1,
                  border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-muted)',
                  background: 'none',
                  cursor: 'pointer', textAlign: 'center',
                  transition: 'all .15s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent-blue)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent-blue)'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(96,165,250,.08)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border2)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
              >
                {t('bot.trade')}
              </button>

              {/* Close all — ✕ (uses bc-action so height matches the other 3) */}
              <button
                onClick={() => setShowCloseAll(true)}
                className="bc-action"
                style={{
                  flexBasis: '28px', flexShrink: 0,
                  fontSize: '12px',
                  border: '1px solid rgba(248,113,113,.4)',
                  color: 'var(--danger)',
                  background: 'none',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all .15s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(248,113,113,.08)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--danger)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(248,113,113,.4)'; }}
                title="Close All Positions"
              >
                ✕
              </button>
            </>
          ) : (
            <>
              {/* RECONNECT */}
              <button
                className="bc-action"
                style={{
                  flex: 2,
                  border: '1px solid rgba(248,113,113,.4)',
                  color: 'var(--danger)',
                  background: 'none',
                  cursor: 'default', textAlign: 'center',
                }}
              >
                {t('bot.reconnect')}
              </button>
              <button
                onClick={() => setShowPositions(p => !p)}
                className="bc-action"
                style={{
                  flex: 1,
                  border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-muted)',
                  background: 'none',
                  cursor: 'pointer', textAlign: 'center',
                }}
              >
                {t('bot.orders')}
              </button>
              <button
                onClick={() => setShowCloseAll(true)}
                className="bc-action"
                style={{
                  flexBasis: '28px', flexShrink: 0,
                  fontSize: '12px',
                  border: '1px solid rgba(248,113,113,.4)',
                  color: 'var(--danger)',
                  background: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                ✕
              </button>
            </>
          )}
        </div>

        {/* ── Positions panel (inline — expands card downward) ── */}
        {showPositions && (
          <div style={{ borderTop: '2px solid var(--border2)' }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '6px 12px',
              borderBottom: '1px solid var(--border-color)',
              background: 'var(--bg-tertiary)',
            }}>
              <span style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', color: 'var(--text-primary)', fontWeight: 600, letterSpacing: '1px' }}>
                OPEN POSITIONS ({ordersArray.length})
              </span>
              <button
                onClick={() => setShowPositions(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '12px' }}
              >✕</button>
            </div>
            <PositionPanel
              accountId={account.id}
              accountName={account.name}
              orders={ordersArray}
              currency={account.currency}
            />

            {/* Waiting, not working. Below the positions and behind its own
                heading, because the two answer different questions: what is
                at risk now, and what is set to happen. */}
            {pendingArray.length > 0 && (
              <>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 12px',
                  borderTop: '1px solid var(--border2)',
                  borderBottom: '1px solid var(--border-color)',
                  background: 'var(--bg-tertiary)',
                }}>
                  <span style={{
                    fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)',
                    color: 'var(--text-primary)', fontWeight: 600, letterSpacing: '1px',
                  }}>
                    PENDING ORDERS ({pendingArray.length})
                  </span>
                </div>
                <PendingPanel orders={pendingArray} />
              </>
            )}
          </div>
        )}
      </div>

      {/* Dialogs */}
      {showCloseAll && (
        <CloseAllDialog accountId={account.id} accountName={account.name} onClose={() => setShowCloseAll(false)} onSuccess={onSuccess} />
      )}
      {showProtection && (
        <ProtectionSettings accountId={account.id} accountName={account.name} onClose={() => setShowProtection(false)} />
      )}
      {showNewTrade && (
        <NewTradeDialog
          accountId={account.id}
          accountName={account.name}
          currency={account.currency}
          lastSymbol={last?.symbol}
          lastVolume={last?.lots}
          onClose={() => setShowNewTrade(false)}
        />
      )}
    </>
  );
};
