import { useMemo, useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAccountStore } from '../../stores/accountStore';
import { useUIStore } from '../../stores/uiStore';
import { fetchGroups, fetchTodayPnl } from '../../services/api';
import type { Account, AccountGroup } from '../../types';
import { BotCard } from './BotCard';
import { BotTable } from './BotTable';
import { GroupManager } from '../groups/GroupManager';
import { Dialog } from '../ui/Dialog';
import { useTranslation } from '../../i18n/useTranslation';
import { IconFilter } from '../icons';

const DEFAULT_FILTER = { status: 'all', broker: 'all', search: '', sort: 'name', group: 'all' };
type BotFilter = typeof DEFAULT_FILTER;

const SORT_OPTIONS = [
  { value: 'name',     label: 'Name A-Z' },
  { value: 'profit',   label: 'P/L ↓' },
  { value: 'balance',  label: 'Balance ↓' },
  { value: 'drawdown', label: 'DD% ↓' },
  { value: 'status',   label: 'Online first' },
];

// ── Section header matching mockup ──────────────────────────────────────────
const SecHdr = ({ title, count, dot = 'var(--accent-blue)' }: { title: string; count?: string; dot?: string }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
    <div style={{ width: '7px', height: '7px', background: dot,flexShrink: 0 }} />
    <span style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', color: 'var(--text-primary)', letterSpacing: '2px' }}>
      {title}
    </span>
    <div style={{ flex: 1, height: '1px', background: 'linear-gradient(90deg, var(--border2), transparent)' }} />
    {count && (
      <span style={{
        fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)',
        color: 'var(--text-muted)',
        padding: '4px 10px',
        border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)',
      }}>{count}</span>
    )}
  </div>
);

export const BotList = () => {
  const t = useTranslation();
  const accounts = useAccountStore(s => s.accounts);
  const { botFilter, setBotFilter, botViewMode, setBotViewMode } = useUIStore();
  const [groups, setGroups] = useState<AccountGroup[]>([]);
  const [showGroupManager, setShowGroupManager] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  // Draft state for the modal — committed to botFilter only when user presses Apply
  const [draft, setDraft] = useState<BotFilter>(botFilter as BotFilter);

  const { data: todayPnlData } = useQuery({
    queryKey: ['today-pnl'],
    queryFn: fetchTodayPnl,
    refetchInterval: 10_000,
  });

  const loadGroups = useCallback(() => {
    fetchGroups().then(setGroups).catch(() => {});
  }, []);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  // Reset draft to current committed filter every time the modal opens, so the
  // user always starts from "what's currently applied" — not a stale draft.
  useEffect(() => {
    if (showFilter) setDraft(botFilter as BotFilter);
  }, [showFilter, botFilter]);

  // Split live / demo — MUST be declared before `filtered` useMemo
  const liveAccounts = accounts.filter(a => !a.isDemo);
  const demoAccounts = accounts.filter(a => a.isDemo);
  const onlineCount = liveAccounts.filter(a => a.status === 'online').length;
  const demoOnlineCount = demoAccounts.filter(a => a.status === 'online').length;

  const brokers = useMemo(() => {
    const b = new Set(liveAccounts.map(a => a.broker));
    return ['all', ...Array.from(b)];
  }, [liveAccounts]);

  const filtered = useMemo(() => {
    let result = [...liveAccounts];
    if (botFilter.status !== 'all') result = result.filter(a => a.status === botFilter.status);
    if (botFilter.broker !== 'all') result = result.filter(a => a.broker === botFilter.broker);
    if (botFilter.group !== 'all') {
      if (botFilter.group === 'ungrouped') result = result.filter(a => !a.groupId);
      else result = result.filter(a => a.groupId === botFilter.group);
    }
    if (botFilter.search.trim()) {
      const q = botFilter.search.toLowerCase();
      result = result.filter(a =>
        a.name.toLowerCase().includes(q) ||
        a.broker.toLowerCase().includes(q) ||
        a.accountNumber.includes(q)
      );
    }
    result.sort((a, b) => {
      switch (botFilter.sort) {
        case 'profit': return b.profit - a.profit;
        case 'balance': return b.balance - a.balance;
        case 'drawdown': return b.drawdown - a.drawdown;
        case 'status': return a.status === 'online' ? -1 : 1;
        default: return a.name.localeCompare(b.name);
      }
    });
    return result;
  }, [liveAccounts, botFilter]);

  const clearFilters = () => {
    setBotFilter(DEFAULT_FILTER);
  };

  const applyDraft = () => {
    setBotFilter(draft);
    setShowFilter(false);
  };

  const clearDraft = () => setDraft(DEFAULT_FILTER);

  // Number of non-default filter/sort fields currently committed — shown as a
  // badge on the FILTER button so the user can tell at a glance how many
  // filters are active without opening the popup.
  const activeFilterCount = (Object.keys(DEFAULT_FILTER) as (keyof BotFilter)[])
    .filter(k => (botFilter as BotFilter)[k] !== DEFAULT_FILTER[k])
    .length;

  // button style factory
  const ftabStyle = (active: boolean) => ({
    padding: '5px 10px',
    fontFamily: 'var(--ff-section)',
    fontSize: 'var(--fs-section)',
    border: active ? '1px solid var(--accent-blue)' : '1px solid var(--border2)',
    color: active ? 'var(--accent-blue)' : 'var(--text-muted)',
    background: active ? 'rgba(96,165,250,.08)' : 'none',
    cursor: 'pointer',
    transition: 'all .15s',
  } as React.CSSProperties);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

      {/* ── MY ACCOUNTS — no wrapper box, cards fill width (matches mockup) ── */}
      <div>
        <SecHdr title={t('dashboard.my_accounts')} count={`${onlineCount} / ${liveAccounts.length}`} />

        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          {/* Opens the modal; the badge shows how many filter/sort fields are set. */}
          <button
            onClick={() => setShowFilter(true)}
            style={{ ...ftabStyle(activeFilterCount > 0), display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <IconFilter size={14} /> {t('filter.filter')}
            {activeFilterCount > 0 && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                minWidth: '18px', height: '16px', padding: '0 5px',
                fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-micro)',
                color: 'var(--bg-primary)', background: 'var(--accent-blue)',
                letterSpacing: 0,
              }}>{activeFilterCount}</span>
            )}
          </button>

          {/* VIEW MODE TOGGLE — pushed to the right side of the toolbar.
              Applies to both live and demo sections. */}
          <button
            onClick={() => setBotViewMode(botViewMode === 'card' ? 'table' : 'card')}
            title={botViewMode === 'card' ? 'Switch to table view' : 'Switch to card view'}
            style={{ ...ftabStyle(false), marginLeft: 'auto' }}
          >
            {botViewMode === 'card' ? `▤ ${t('filter.table')}` : `▦ ${t('filter.cards')}`}
          </button>
        </div>

        {/* Filter & sort modal — draft state, only committed on Apply */}
        <Dialog open={showFilter} onClose={() => setShowFilter(false)} title="FILTER & SORT">
          {/* Search */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', color: 'var(--text-muted)', letterSpacing: '.5px', marginBottom: '6px' }}>SEARCH</div>
            <input
              type="text"
              placeholder="name, broker, account #"
              value={draft.search}
              onChange={e => setDraft(d => ({ ...d, search: e.target.value }))}
              style={{
                width: '100%', background: 'var(--bg-input)',
                border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
                padding: '8px 10px', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)',
                outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Broker */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', color: 'var(--text-muted)', letterSpacing: '.5px', marginBottom: '6px' }}>BROKER</div>
            <select
              value={draft.broker}
              onChange={e => setDraft(d => ({ ...d, broker: e.target.value }))}
              style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', padding: '8px 10px', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)', outline: 'none', cursor: 'pointer', boxSizing: 'border-box' }}
            >
              {brokers.map(b => <option key={b} value={b}>{b === 'all' ? 'All brokers' : b}</option>)}
            </select>
          </div>

          {/* Group */}
          {groups.length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', color: 'var(--text-muted)', letterSpacing: '.5px', marginBottom: '6px' }}>GROUP</div>
              <select
                value={draft.group}
                onChange={e => setDraft(d => ({ ...d, group: e.target.value }))}
                style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', padding: '8px 10px', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)', outline: 'none', cursor: 'pointer', boxSizing: 'border-box' }}
              >
                <option value="all">All</option>
                <option value="ungrouped">Ungrouped</option>
                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
          )}

          {/* Sort */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', color: 'var(--text-muted)', letterSpacing: '.5px', marginBottom: '6px' }}>SORT BY</div>
            <select
              value={draft.sort}
              onChange={e => setDraft(d => ({ ...d, sort: e.target.value }))}
              style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', padding: '8px 10px', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)', outline: 'none', cursor: 'pointer', boxSizing: 'border-box' }}
            >
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* Footer buttons */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={clearDraft}
              style={{
                flex: 1, padding: '9px',
                fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)',
                border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)',
                background: 'none', cursor: 'pointer', letterSpacing: '.5px',
              }}
            >
              CLEAR ALL
            </button>
            <button
              onClick={applyDraft}
              style={{
                flex: 1, padding: '9px',
                fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)',
                border: '1px solid var(--cyan)', color: 'var(--cyan)',
                background: 'rgba(96,165,250,.1)', cursor: 'pointer', letterSpacing: '.5px',
              }}
            >
              APPLY
            </button>
          </div>
        </Dialog>

        {/* Bot grid — 3 columns matching mockup */}
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)' }}>
            No bots match your filters
            {botFilter.status !== 'all' || botFilter.broker !== 'all' || botFilter.search ? (
              <div style={{ marginTop: '8px' }}>
                <button onClick={clearFilters} style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', color: 'var(--accent-blue)', background: 'none', border: 'none', cursor: 'pointer' }}>
                  CLEAR FILTERS
                </button>
              </div>
            ) : null}
          </div>
        ) : botViewMode === 'table' ? (
          <BotTable accounts={filtered} todayPnlMap={todayPnlData ?? {}} />
        ) : (
          <div
            style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginTop: '10px' }}
            className="bot-grid-responsive"
          >
            {filtered.map((account: Account) => (
              <BotCard key={account.id} account={account} todayPnl={todayPnlData?.[account.id] ?? 0} />
            ))}
          </div>
        )}
      </div>

      {/* ── DEMO ACCOUNTS — no wrapper box ────────────────────────────── */}
      {demoAccounts.length > 0 && (
        <div>
          {/* Demo section header — yellow dot + SANDBOX badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <div style={{ width: '7px', height: '7px', background: 'var(--warning)',flexShrink: 0 }} />
            <span style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', color: 'var(--warning)', letterSpacing: '2px' }}>
              DEMO ACCOUNTS
            </span>
            <div style={{ flex: 1, height: '1px', background: 'linear-gradient(90deg, rgba(251,191,36,.3), transparent)' }} />
            <span style={{
              fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)',
              color: 'var(--warning)',
              padding: '3px 8px',
              border: '1px solid rgba(251,191,36,.4)',
              background: 'rgba(251,191,36,.06)',
              letterSpacing: '.5px',
            }}>SANDBOX</span>
            <span style={{
              fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)',
              color: 'var(--text-muted)',
              padding: '4px 10px',
              border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)',
            }}>{demoOnlineCount} / {demoAccounts.length}</span>
          </div>

          <div style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-muted)', marginBottom: '10px', letterSpacing: '.3px' }}>
            ⚠ Demo accounts are excluded from KPI stats and performance reports
          </div>

          {botViewMode === 'table' ? (
            <BotTable accounts={demoAccounts} todayPnlMap={todayPnlData ?? {}} />
          ) : (
            <div
              style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}
              className="bot-grid-responsive"
            >
              {demoAccounts.map((account: Account) => (
                <BotCard key={account.id} account={account} todayPnl={todayPnlData?.[account.id] ?? 0} />
              ))}
            </div>
          )}
        </div>
      )}

      <style>{`
        @media (max-width: 1280px) { .bot-grid-responsive { grid-template-columns: repeat(2,1fr) !important; } }
        @media (max-width: 900px)  { .bot-grid-responsive { grid-template-columns: 1fr !important; } }
      `}</style>

      <GroupManager open={showGroupManager} onClose={() => setShowGroupManager(false)} onGroupsChanged={loadGroups} />
    </div>
  );
};
