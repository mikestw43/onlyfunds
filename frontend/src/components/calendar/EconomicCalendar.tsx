import { useState, useMemo } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import type { EconomicEvent } from '../../types';
import { lastCalendarMeta, fetchEconomicCalendar } from '../../services/api';
import { useTranslation } from '../../i18n/useTranslation';

// ─── Constants ───────────────────────────────────────────────────────────────

const CURRENCY_FLAGS: Record<string, string> = {
  USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵',
  AUD: '🇦🇺', NZD: '🇳🇿', CAD: '🇨🇦', CHF: '🇨🇭',
  CNY: '🇨🇳', CNH: '🇨🇳',
};

interface ImpactCfg {
  label: string;
  color: string;
  bg: string;
  border: string;
  dot: string;
}

const IMPACT_CFG: Record<string, ImpactCfg> = {
  High:           { label: 'HIGH', color: 'var(--red)',     bg: 'rgba(248,113,113,.12)',  border: 'rgba(248,113,113,.35)',  dot: 'var(--red)' },
  Medium:         { label: 'MED',  color: 'var(--orange)',  bg: 'rgba(251,146,60,.12)', border: 'rgba(251,146,60,.35)', dot: 'var(--orange)' },
  Low:            { label: 'LOW',  color: 'var(--warning)', bg: 'rgba(251,191,36,.12)', border: 'rgba(251,191,36,.35)', dot: 'var(--warning)' },
  'Non-Economic': { label: 'N/E',  color: '#4a4e57',        bg: 'rgba(58,62,71,.08)',  border: 'rgba(58,62,71,.2)',   dot: '#3b3e46' },
};

const ALL_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF', 'CNY'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtTime = (dateStr: string) =>
  new Date(dateStr).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

const fmtDateLabel = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

const getImpactCfg = (impact: string): ImpactCfg =>
  IMPACT_CFG[impact] ?? IMPACT_CFG['Low'];

interface DayGroup { label: string | null; events: EconomicEvent[] }
interface EventTableProps { groups: DayGroup[]; now: Date }

/**
 * One continuous table, the way ForexFactory reads: a day band, then its
 * events, then the next day. Rendering a separate bordered table per day
 * (what this did before) turned a week into a stack of boxes that pushed
 * the actual events off a phone screen.
 */
const EventTable = ({ groups, now }: EventTableProps) => {
  const t = useTranslation();
  return (
  <div className="evt-wrap">
    <table>
      <thead>
        <tr>
          <th className="evcol-time">{t('calendar.time')}</th>
          <th className="evcol-ccy">{t('calendar.ccy')}</th>
          <th className="evcol-imp" aria-label="Impact" />
          <th className="evcol-event">{t('calendar.event')}</th>
          <th className="evcol-actual">
            <span className="lbl-full">{t('calendar.actual')}</span><span className="lbl-short">{t('calendar.actual_short')}</span>
          </th>
          <th className="evcol-forecast">
            <span className="lbl-full">{t('calendar.forecast')}</span><span className="lbl-short">{t('calendar.forecast_short')}</span>
          </th>
          <th className="evcol-prev">{t('calendar.previous')}</th>
        </tr>
      </thead>
      {groups.map(({ label, events }) => (
        <tbody key={label ?? 'all'}>
          {label && (
            <tr className="evt-day">
              <td colSpan={7}>
                {label}
                {events.some(e => e.impact === 'High') && (
                  <span className="evt-day-high">
                    {events.filter(e => e.impact === 'High').length} {t('calendar.high')}
                  </span>
                )}
              </td>
            </tr>
          )}
          {events.map((event, i) => {
            const past   = new Date(event.date) < now;
            const cfg    = getImpactCfg(event.impact);
            const isHigh = event.impact === 'High';

            return (
              <tr key={`${event.date}-${i}`} className={past ? 'evt-row evt-past' : 'evt-row'}>
                <td className="evcol-time ev-mono">{fmtTime(event.date)}</td>
                <td className="evcol-ccy">
                  <span className="ev-ccy-wrap">
                    <span className="evcol-flag">{CURRENCY_FLAGS[event.country] ?? '\u{1F3F3}\uFE0F'}</span>
                    <span className="ev-mono">{event.country}</span>
                  </span>
                </td>
                <td className="evcol-imp">
                  {/* Colored square — sole impact indicator, as on ForexFactory. */}
                  <span className="ev-imp" title={cfg.label} style={{ background: cfg.dot, borderColor: cfg.border }} />
                </td>
                <td className={isHigh ? 'evcol-event ev-high' : 'evcol-event'}>
                  <span className="ev-title" title={event.title}>{event.title}</span>
                </td>
                {/* ACTUAL — green when it beat forecast, red when it missed. */}
                <td
                  className="evcol-actual ev-mono"
                  style={{
                    color: !event.actual
                      ? 'var(--text-dim)'
                      : event.actualSentiment === 'better'
                        ? 'var(--success)'
                        : event.actualSentiment === 'worse'
                          ? 'var(--danger)'
                          : 'var(--text)',
                  }}
                >
                  {event.actual || '\u2014'}
                </td>
                <td className="evcol-forecast ev-mono">{event.forecast || '\u2014'}</td>
                <td className="evcol-prev ev-mono">{event.previous || '\u2014'}</td>
              </tr>
            );
          })}
        </tbody>
      ))}
    </table>

    <style>{`
      .evt-wrap {
        background: var(--bg-card);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-card);
        overflow: hidden;
      }
      .evt-wrap table { width: 100%; table-layout: fixed; border-collapse: collapse; }

      .evt-wrap th {
        font-family: var(--ff-section);
        font-size: var(--fs-micro);
        color: var(--text-dim);
        letter-spacing: .5px;
        font-weight: 400;
        text-align: left;
        padding: 7px 6px;
        white-space: nowrap;
        background: var(--bg-card2);
        border-bottom: 1px solid var(--border2);
      }
      .evt-wrap td {
        padding: 6px;
        font-family: var(--ff-body);
        font-size: var(--fs-body-sm);
        color: var(--text-dim);
        white-space: nowrap;
        border-bottom: 1px solid rgba(42,45,52,.35);
      }

      /* Day band — the thing that makes a week scannable. */
      .evt-wrap .evt-day td {
        background: var(--bg-card2);
        font-family: var(--ff-section);
        font-size: var(--fs-label);
        color: var(--text);
        letter-spacing: 1px;
        padding: 6px 8px;
        border-bottom: 1px solid var(--border2);
      }
      .evt-wrap .evt-day-high {
        margin-left: 8px;
        font-size: var(--fs-micro);
        color: var(--red);
        letter-spacing: .5px;
      }

      .evt-wrap .evt-past { opacity: .55; }
      .evt-wrap .evt-row:hover td { background: rgba(42,45,52,.25); }

      .evt-wrap .ev-mono { font-family: var(--ff-display); line-height: 1.1; color: var(--text); }
      .evt-wrap .evt-past .ev-mono { color: var(--text-dim); }

      .evt-wrap .ev-ccy-wrap { display: flex; align-items: center; gap: 4px; }
      .evt-wrap .evcol-flag { font-size: var(--fs-body-sm); line-height: 1; }

      .evt-wrap .ev-imp {
        display: inline-block;
        width: 10px; height: 10px;
        border: 1px solid;
      }

      /* EVENT is the only wrapping cell; two lines max so one long title
         cannot make its row three times the height of its neighbours. */
      .evt-wrap .evcol-event { white-space: normal; color: var(--text-primary); }
      /* The clamp lives on a span: a <td> given display:-webkit-box stops
         behaving like a table cell, so the clamp was ignored and a third line
         spilled over the row below. */
      .evt-wrap .ev-title {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        word-break: break-word;
        line-height: 1.25;
      }
      .evt-wrap .ev-high { color: var(--text); }

      /* Percentages, not pixels: with table-layout:fixed a column hidden at
         a breakpoint still holds on to its pixel width, and EVENT — the one
         column that has to wrap real text — was left with a quarter of the
         table while a hidden PREV sat on the rest. */
      .evt-wrap .evcol-time     { width: 9%; }
      .evt-wrap .evcol-ccy      { width: 12%; }
      .evt-wrap .evcol-imp      { width: 5%; text-align: center; padding: 6px 2px; }
      .evt-wrap .evcol-event    { width: 42%; }
      .evt-wrap .evcol-actual,
      .evt-wrap .evcol-forecast,
      .evt-wrap .evcol-prev     { width: 10.6%; text-align: right; }

      .evt-wrap .lbl-short { display: none; }

      @media (max-width: 768px) {
        /* Phone: drop the flag and the PREV column, shrink the number
           columns, and hand every pixel that frees up to EVENT. */
        .evt-wrap .evcol-flag,
        .evt-wrap .evcol-prev { display: none; }
        .evt-wrap .lbl-full   { display: none; }
        .evt-wrap .lbl-short  { display: inline; }

        .evt-wrap th, .evt-wrap td { padding: 5px 4px; }
        /* Six visible columns, summing to 100% so EVENT keeps the rest. */
        .evt-wrap .evcol-time   { width: 12%; }
        .evt-wrap .evcol-ccy    { width: 11%; }
        .evt-wrap .evcol-imp    { width: 7%; }
        .evt-wrap .evcol-event  { width: 44%; }
        .evt-wrap .evcol-actual,
        .evt-wrap .evcol-forecast { width: 13%; }
      }
    `}</style>
  </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

export const EconomicCalendar = () => {
  const t = useTranslation();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery<EconomicEvent[]>({
    queryKey: ['economic-calendar'],
    queryFn: () => fetchEconomicCalendar(false),
    staleTime: 15 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
  });

  /** Manual refresh — bypass backend 30-min cache and seed the query
   *  cache with the fresh payload. Using useMutation gives us a real
   *  pending flag for the button's disabled / spinner state. */
  const refreshMutation = useMutation<EconomicEvent[]>({
    mutationFn: () => fetchEconomicCalendar(true),
    onSuccess: (fresh) => {
      queryClient.setQueryData(['economic-calendar'], fresh);
    },
  });
  const refreshing = refreshMutation.isPending;
  const handleRefresh = () => {
    if (!refreshing) refreshMutation.mutate();
  };

  // Week by default: a filtered TODAY often holds a single row, which is a
  // whole screen spent on one event. ForexFactory opens on the week too.
  // Today, not the week. The page is opened to see what is coming in the
  // next few hours; the whole week is a thing you ask for.
  const [viewMode,  setViewMode]  = useState<'today' | 'week'>('today');
  // Filters stay folded away — on a phone the expanded panel used to take
  // half the screen before a single event appeared.
  const [showFilters, setShowFilters] = useState(false);
  // Default currency filter: USD only — most traders care about US events.
  // User can deselect with ✕ CLEAR or pick more chips.
  const [selected,  setSelected]  = useState<string[]>(['USD']);
  const [minImpact, setMinImpact] = useState<'all' | 'medium' | 'high'>('all');

  const now = new Date();

  const filtered = useMemo(() => {
    if (!data || !Array.isArray(data)) return [];

    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd   = new Date(todayStart.getTime() + 86_400_000);
    // Week runs Sunday→Saturday, as ForexFactory's calendar does. Starting it
    // on Monday meant that on a Sunday "THIS WEEK" showed the six days that
    // had just finished and none of the week the trader is about to trade.
    const weekStart = new Date(todayStart);
    weekStart.setDate(todayStart.getDate() - now.getDay());
    const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);

    return data
      .filter(e => {
        const d = new Date(e.date);
        if (viewMode === 'today' ? (d < todayStart || d >= todayEnd) : (d < weekStart || d >= weekEnd)) return false;
        if (selected.length > 0 && !selected.includes(e.country)) return false;
        if (minImpact === 'high'   && e.impact !== 'High') return false;
        if (minImpact === 'medium' && (e.impact === 'Low' || e.impact === 'Non-Economic')) return false;
        return true;
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [data, viewMode, selected, minImpact]); // eslint-disable-line react-hooks/exhaustive-deps

  const todayHighCount = useMemo(() => {
    if (!data || !Array.isArray(data)) return 0;
    const s = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const e = new Date(s.getTime() + 86_400_000);
    return data.filter(ev => { const d = new Date(ev.date); return d >= s && d < e && ev.impact === 'High'; }).length;
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Loading ────────────────────────────────────────────────────────────
  if (isLoading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: '28px', height: '28px', border: '2px solid var(--cyan)', borderTopColor: 'transparent',
          borderRadius: '50%', margin: '0 auto 12px', animation: 'spin 0.8s linear infinite',
        }} />
        <p style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)', color: 'var(--text-dim)' }}>
          {t('calendar.loading')}
        </p>
      </div>
    </div>
  );

  // ─── Error ───────────────────────────────────────────────────────────────
  if (error) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '28px', marginBottom: '12px' }}>⚠</div>
        <p style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', color: 'var(--red)', marginBottom: '8px', letterSpacing: '.5px' }}>
          FAILED TO LOAD CALENDAR
        </p>
        <p style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-dim)', marginBottom: '16px' }}>
          Could not reach ForexFactory. Check network connectivity.
        </p>
        <button
          onClick={handleRefresh}
          style={{
            fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', letterSpacing: '.5px',
            padding: '9px 16px', background: 'var(--cyan)', color: '#25272c',
            border: '1px solid var(--cyan)', cursor: 'pointer',
          }}
        >
          TRY AGAIN
        </button>
      </div>
    </div>
  );

  // TODAY is one unlabelled group; WEEK gets a band per day.
  const dayGroups: DayGroup[] = viewMode === 'today'
    ? [{ label: null, events: filtered }]
    : Object.entries(
        filtered.reduce<Record<string, EconomicEvent[]>>((acc, ev) => {
          const label = fmtDateLabel(ev.date);
          (acc[label] ??= []).push(ev);
          return acc;
        }, {}),
      ).map(([label, events]) => ({ label, events }));

  const tabBtn = (active: boolean): React.CSSProperties => ({
    fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', letterSpacing: '.5px',
    padding: '6px 12px', cursor: 'pointer',
    border: active ? '1px solid var(--success)' : '1px solid transparent',
    background: active ? 'rgba(52,211,153,.08)' : 'none',
    color: active ? 'var(--success)' : 'var(--text-dim)',
    transition: 'all .15s',
  });

  const impactBtn = (active: boolean): React.CSSProperties => ({
    fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', letterSpacing: '.5px',
    padding: '5px 10px', cursor: 'pointer',
    border: active ? '1px solid var(--cyan)' : '1px solid var(--border2)',
    background: active ? 'rgba(96,165,250,.1)' : 'none',
    color: active ? 'var(--cyan)' : 'var(--text-dim)',
  });

  const ccyBtn = (active: boolean): React.CSSProperties => ({
    fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', letterSpacing: '.5px',
    display: 'inline-flex', alignItems: 'center', gap: '3px',
    padding: '4px 7px', cursor: 'pointer',
    border: active ? '1px solid rgba(96,165,250,.6)' : '1px solid var(--border2)',
    background: active ? 'rgba(96,165,250,.1)' : 'none',
    color: active ? 'var(--cyan)' : 'var(--text-dim)',
  });

  return (
    <div>
      {/* ── Header — single row: dot, title, HIGH badge, refresh icon (right) ── */}
      <div style={{ marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <div style={{ width: '7px', height: '7px', background: 'var(--cyan)',flexShrink: 0 }} />
          <span style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', color: 'var(--text)', letterSpacing: '2px',}}>
            {t('calendar.title')}
          </span>
          {todayHighCount > 0 && (
            <span style={{
              fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', letterSpacing: '.5px',
              display: 'inline-flex', alignItems: 'center', gap: '5px',
              padding: '3px 8px', border: '1px solid rgba(248,113,113,.4)', color: 'var(--red)',
              flexShrink: 0,
            }}>
              <span style={{ width: '5px', height: '5px', background: 'var(--red)', display: 'inline-block' }} />
              {todayHighCount} {t('calendar.high_today')}
            </span>
          )}
          {/* Refresh — icon-only, pushed to the far right of the title row. */}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            title={refreshing ? 'Refreshing…' : 'Refresh calendar (bypass cache)'}
            style={{
              marginLeft: 'auto', flexShrink: 0,
              width: '28px', height: '28px',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '18px', lineHeight: 1,
              background: 'none', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)',
              color: refreshing ? 'var(--text-dim)' : 'var(--text)',
              cursor: refreshing ? 'not-allowed' : 'pointer',
              opacity: refreshing ? .5 : 1,
              padding: 0,
              animation: refreshing ? 'spin 1s linear infinite' : undefined,
            }}
          >
            ↻
          </button>
        </div>
        <p style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-dim)', marginLeft: '15px' }}>
          {t('calendar.source')}
        </p>
      </div>

      {/* ── Filter bar — one line, expands on demand ── */}
      <div style={{ marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', flexShrink: 0 }}>
            <button onClick={() => setViewMode('today')} style={tabBtn(viewMode === 'today')}>{t('calendar.today')}</button>
            <button
              onClick={() => setViewMode('week')}
              style={{ ...tabBtn(viewMode === 'week'), borderLeft: '1px solid var(--border2)' }}
            >{t('calendar.week')}</button>
          </div>

          {/* What's active, so the folded panel still tells you what you're seeing. */}
          <span style={{
            fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-dim)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {selected.length === 0 ? t('calendar.all_ccy') : selected.join(' ')}
            {minImpact !== 'all' && ` · ${minImpact === 'medium' ? t('calendar.med') : t('calendar.high')}`}
            {` · ${filtered.length}`}
          </span>

          {/* The two feeds do not carry the same events and the standby one
              carries fewer, so a list that quietly came from it just looks
              short for no reason. */}
          {lastCalendarMeta.source === 'investing' && (
            <span
              title={t('calendar.backup_feed_why')}
              style={{
                fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-micro)',
                color: 'var(--warning)', border: '1px solid var(--warning)',
                borderRadius: '999px', padding: '1px 7px', flexShrink: 0,
              }}
            >{t('calendar.backup_feed')}</span>
          )}

          <button
            onClick={() => setShowFilters(v => !v)}
            style={{ ...impactBtn(showFilters), marginLeft: 'auto', flexShrink: 0 }}
          >
            {t('filter.filter')} {showFilters ? '\u25B4' : '\u25BE'}
          </button>
        </div>

        {showFilters && (
          <div style={{
            display: 'flex', flexDirection: 'column', gap: '8px',
            marginTop: '8px', padding: '10px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-card)',
          }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-micro)', color: 'var(--text-dim)', letterSpacing: '.5px', marginRight: '2px' }}>
                {t('calendar.currency')}
              </span>
              {ALL_CURRENCIES.map(cur => (
                <button
                  key={cur}
                  onClick={() => setSelected(p => p.includes(cur) ? p.filter(c => c !== cur) : [...p, cur])}
                  style={ccyBtn(selected.includes(cur))}
                >
                  {cur}
                </button>
              ))}
              {selected.length > 0 && (
                <button
                  onClick={() => setSelected([])}
                  style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-micro)', color: 'var(--text-dim)', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '.5px' }}
                >
                  ✕ {t('calendar.clear')}
                </button>
              )}
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-micro)', color: 'var(--text-dim)', letterSpacing: '.5px', marginRight: '2px' }}>
                {t('calendar.impact')}
              </span>
              {(['all', 'medium', 'high'] as const).map(key => (
                <button key={key} onClick={() => setMinImpact(key)} style={impactBtn(minImpact === key)}>
                  {key === 'all' ? t('calendar.all') : key === 'medium' ? t('calendar.med') : t('calendar.high')}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Events ── */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 0' }}>
          <div style={{ fontSize: '24px', marginBottom: '10px', color: 'var(--text-dim)' }}>📅</div>
          <p style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', color: 'var(--text-dim)', letterSpacing: '.5px' }}>
            {t('calendar.no_events')}
          </p>
        </div>
      ) : (
        <EventTable groups={dayGroups} now={now} />
      )}
    </div>
  );
};
