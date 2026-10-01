import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUIStore } from '../../stores/uiStore';
import { useTranslation } from '../../i18n/useTranslation';
import {
  getState as getPushState, enablePush, disablePush, sendTestPush, listDevices, prepare, diagnostics,
  type PushState, type PushDevice,
} from '../../services/push';
import { useAuthStore } from '../../stores/authStore';
import { AiSettings } from './AiSettings';
import { AiMemory } from './AiMemory';
import {
  getTelegramSettings, saveTelegramSettings, testTelegramMessage,
  fetchNotifications,
} from '../../services/api';
import { exportToCSV } from '../../utils/export';
import { AccountsSection } from '../accounts/AccountsSection';
import { ReportSettings } from './ReportSettings';
import { TickerSettings } from './TickerSettings';
import type { NotificationLogEntry } from '../../types';
import { IconCard, IconSend, IconReport, IconTicker, IconBell, IconSpark, IconBookmark } from '../icons';
import type { ReactElement } from 'react';

type Tab = 'account' | 'telegram' | 'reports' | 'ticker' | 'notifications' | 'memory' | 'ai';

/* ── shared styles ────────────────────────────────────── */
const card: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)',
  padding: '20px 22px',
};
const cardTitle: React.CSSProperties = {
  fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)',
  color: 'var(--text-primary)', fontWeight: 600, letterSpacing: '1px',
  marginBottom: '14px',
};
const lbl: React.CSSProperties = {
  fontFamily: 'var(--ff-label)', fontSize: 'var(--fs-label)', color: 'var(--text-dim)',
  letterSpacing: '.5px', display: 'block', marginBottom: '6px',
};
const inp: React.CSSProperties = {
  width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)',
  color: 'var(--text)', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-input)',
  padding: '8px 10px', outline: 'none', boxSizing: 'border-box',
};
const btnPrimary = (disabled = false): React.CSSProperties => ({
  fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', letterSpacing: '.5px',
  padding: '9px 16px', background: 'var(--cyan)', color: '#25272c',
  border: '1px solid var(--cyan)', cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? .5 : 1,
});
const btnGhost: React.CSSProperties = {
  fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', letterSpacing: '.5px',
  padding: '9px 16px', background: 'none', color: 'var(--text)',
  border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
};

/** Drawn on the shell's own 24x24 grid. They were typographic glyphs and one
 *  ✈ emoji, which every phone renders at its own weight, colour and baseline —
 *  the plane arrived in full colour beside four grey marks. */
const TABS: { key: Tab; Icon: (p: { size?: number }) => ReactElement; labelKey: string }[] = [
  { key: 'account',       Icon: IconCard,   labelKey: 'settings.tab_account' },
  { key: 'telegram',      Icon: IconSend,   labelKey: 'settings.tab_telegram' },
  { key: 'reports',       Icon: IconReport, labelKey: 'settings.tab_reports' },
  { key: 'ticker',        Icon: IconTicker, labelKey: 'settings.tab_ticker' },
  { key: 'notifications', Icon: IconBell,   labelKey: 'settings.tab_notifications' },
  { key: 'memory',        Icon: IconBookmark, labelKey: 'settings.tab_memory' },
  { key: 'ai',            Icon: IconSpark,  labelKey: 'nav.ai' },
];

export const SettingsPage = () => {
  const setCurrentPage = useUIStore(s => s.setCurrentPage);
  const t = useTranslation();
  const isAdmin = useAuthStore(s => s.user?.role) === 'admin';
  const [tab, setTab] = useState<Tab>('account');

  // Connecting a model is an admin's job, and the tab would only lead to a
  // 403 for anyone else.
  const tabs = TABS.filter(x => x.key !== 'ai' || isAdmin);

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      {/* Back bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
        <button
          onClick={() => setCurrentPage('dashboard')}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            background: 'none', border: 'none', color: 'var(--cyan)',
            fontFamily: 'var(--ff-label)', fontSize: 'var(--fs-label)',
            letterSpacing: '.5px', cursor: 'pointer',
          }}
        >
          ‹ {t('settings.back')}
        </button>
        <span style={{ width: '6px', height: '6px', background: 'var(--cyan)',}} />
        <span style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-title)', color: 'var(--text-primary)', fontWeight: 600, letterSpacing: '2px',}}>
          {t('settings.title')}
        </span>
        <div style={{ flex: 1, height: '1px', background: 'var(--border2)' }} />
      </div>

      <div className="settings-layout" style={{
        display: 'grid',
        gridTemplateColumns: '180px 1fr',
        gap: '12px',
        alignItems: 'flex-start',
      }}>
        {/* Left nav */}
        <div className="settings-nav" style={{
          background: 'var(--bg-card)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)',
          padding: '8px',
          display: 'flex', flexDirection: 'column', gap: '2px',
          position: 'sticky', top: '12px',
        }}>
          {tabs.map(({ key, Icon, labelKey }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  width: '100%', padding: '9px 12px',
                  fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)',
                  color: active ? 'var(--cyan)' : 'var(--text-dim)',
                  background: active ? 'rgba(96,165,250,.08)' : 'none',
                  border: `1px solid ${active ? 'var(--cyan)' : 'transparent'}`,
                  cursor: 'pointer', textAlign: 'left',
                  transition: 'all .15s',
                }}
              >
                <Icon size={15} />
                {t(labelKey)}
              </button>
            );
          })}
        </div>

        {/* Right content */}
        <div className="settings-body">
          {tab === 'account'       && <AccountsSection />}
          {tab === 'telegram'      && <TelegramTab />}
          {tab === 'reports'       && <ReportSettings />}
          {tab === 'ticker'        && <TickerSettings />}
          {tab === 'notifications' && <NotificationsTab />}
          {tab === 'memory' && <AiMemory />}
          {tab === 'ai' && isAdmin && <AiSettings />}
        </div>
      </div>

      {/* Mobile responsive: stack nav above content */}
      <style>{`
        @media (max-width: 768px) {
          .settings-layout {
            grid-template-columns: 1fr !important;
          }
          .settings-nav {
            flex-direction: row !important;
            overflow-x: auto;
            position: static !important;
          }
        }
      `}</style>
    </div>
  );
};

/* ── Telegram tab ─────────────────────────────────────── */
const TelegramTab = () => {
  const t = useTranslation();
  const addToast = useUIStore(s => s.addToast);
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [savingTg, setSavingTg] = useState(false);
  const [testingTg, setTestingTg] = useState(false);

  const { data: tgData, refetch: refetchTg } = useQuery({
    queryKey: ['telegram-settings'],
    queryFn: getTelegramSettings,
  });

  useEffect(() => { if (tgData?.telegramChatId) setChatId(tgData.telegramChatId); }, [tgData]);

  const handleSave = async () => {
    setSavingTg(true);
    try {
      const payload: { telegramBotToken?: string; telegramChatId?: string } = { telegramChatId: chatId || undefined };
      if (botToken && !botToken.startsWith('●')) payload.telegramBotToken = botToken;
      await saveTelegramSettings(payload);
      refetchTg(); setBotToken('');
      addToast({ type: 'success', title: t('settings.tg_saved') });
    } catch { addToast({ type: 'error', title: t('settings.tg_save_failed') }); }
    finally { setSavingTg(false); }
  };

  const handleTest = async () => {
    setTestingTg(true);
    try {
      const res = await testTelegramMessage();
      addToast({ type: 'success', title: res.message });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || t('settings.tg_test_failed');
      addToast({ type: 'error', title: msg });
    } finally { setTestingTg(false); }
  };

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <div style={cardTitle}>{t('settings.tg_title')}</div>
        {tgData?.configured && (
          <span style={{ fontFamily: 'var(--ff-label)', fontSize: 'var(--fs-label)', padding: '3px 8px', border: '1px solid rgba(52,211,153,.4)', color: 'var(--green)' }}>{t('settings.tg_active')}</span>
        )}
      </div>
      <p style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-dim)', marginBottom: '14px', lineHeight: 1.6 }}>
        {t('settings.tg_intro')}
      </p>
      <div style={{ marginBottom: '14px' }}>
        <label style={lbl}>{t('settings.tg_token')}</label>
        <input style={inp} type="password" value={botToken} onChange={e => setBotToken(e.target.value)} placeholder={tgData?.telegramBotToken ?? t('settings.tg_token_ph')} />
      </div>
      <div style={{ marginBottom: '14px' }}>
        <label style={lbl}>{t('settings.tg_chat')}</label>
        <input style={inp} value={chatId} onChange={e => setChatId(e.target.value)} placeholder="123456789" />
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button onClick={handleSave} disabled={savingTg} style={btnPrimary(savingTg)}>{savingTg ? t('common.saving') : t('common.save')}</button>
        <button onClick={handleTest} disabled={testingTg || !tgData?.configured} style={{ ...btnGhost, opacity: (testingTg || !tgData?.configured) ? .4 : 1 }}>
          {testingTg ? t('settings.tg_testing') : t('settings.tg_test')}
        </button>
      </div>
    </div>
  );
};

/* ── Phone notifications ──────────────────────────────────
   One card per device, because a subscription belongs to the browser it
   was granted in: switching it on here is about this phone, not about the
   account. Someone with a phone and a laptop turns it on twice. */
const PushCard = () => {
  const t = useTranslation();
  const addToast = useUIStore(s => s.addToast);
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<PushDevice[]>([]);
  // What the push service said about each device on the last test. Kept on
  // screen rather than only in a toast: a refusal that names its reason is
  // the one thing that turns "it does not work on my phone" into something
  // anyone can act on, and a toast is gone before it can be read out.
  const [failures, setFailures] = useState<{ label: string; status: number | null; detail: string }[]>([]);
  // What this browser said when it refused to subscribe. Shown rather than
  // only logged: the phone that fails is rarely the device with a console
  // attached, and "could not turn on notifications" tells nobody anything.
  const [enableError, setEnableError] = useState('');
  const [diag, setDiag] = useState('');

  const refreshDevices = () => listDevices().then(setDevices).catch(() => setDevices([]));
  // prepare() is also called on page load, but it does nothing before
  // there is a session. This is the call that actually lands, and it has to
  // finish before anybody can tap: Safari will not subscribe once the tap
  // has waited on the network.
  useEffect(() => { prepare(); getPushState().then(setState); refreshDevices(); }, []);
  // Re-read after anything that could change it, and once a second later
  // than the first paint so the key fetch has landed.
  useEffect(() => {
    diagnostics().then(setDiag);
    const t = setTimeout(() => diagnostics().then(setDiag), 1500);
    return () => clearTimeout(t);
  }, [state, enableError]);

  const toggle = async () => {
    setBusy(true);
    try {
      // Called with no await in front of it on purpose: Safari only allows
      // subscribing while the tap that asked for it is still current.
      const next = state === 'on' ? disablePush() : enablePush();
      setEnableError('');
      setState(await next);
      setFailures([]);
      await refreshDevices();
    } catch (err) {
      console.error('[push] toggle failed:', err);
      const e = err as { name?: string; message?: string };
      setEnableError([e?.name, e?.message].filter(Boolean).join(': ') || String(err));
      addToast({ type: 'error', title: t('settings.push_failed') });
      setState(await getPushState());
    } finally { setBusy(false); }
  };

  const test = async () => {
    setBusy(true);
    try {
      const res = await sendTestPush();
      setFailures(res.failures);
      addToast(res.sent > 0
        ? { type: 'success', title: t('settings.push_test_sent').replace('{n}', String(res.sent)) }
        : { type: 'error', title: t('settings.push_test_none') });
      await refreshDevices();
    } catch { addToast({ type: 'error', title: t('settings.push_failed') }); }
    finally { setBusy(false); }
  };

  // Nothing to offer until we know; the control would otherwise flip from
  // "turn on" to "turn off" a moment after the page draws.
  if (state === null) return null;

  // Both of these are the person's to fix in their own settings, not ours,
  // so the card explains instead of offering a button that cannot work.
  const blocked = state === 'needs-install' || state === 'denied' || state === 'unsupported';
  const blockedText = state === 'needs-install' ? t('settings.push_install')
    : state === 'denied' ? t('settings.push_denied')
    : t('settings.push_unsupported');

  return (
    <div style={{ ...card, marginBottom: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', gap: '8px' }}>
        <div style={cardTitle}>{t('settings.push_title')}</div>
        {state === 'on' && (
          <span style={{ fontFamily: 'var(--ff-label)', fontSize: 'var(--fs-label)', padding: '3px 8px', border: '1px solid rgba(52,211,153,.4)', color: 'var(--green)' }}>
            {t('settings.push_on')}
          </span>
        )}
      </div>
      <p style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-dim)', marginBottom: '12px', lineHeight: 1.6 }}>
        {blocked ? blockedText : t('settings.push_intro')}
      </p>

      {/* Shown in every state, including the blocked ones: a device that
          cannot turn this on is exactly the device whose situation needs
          reporting, and this line is meant to be photographed. */}
      {diag && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontFamily: 'var(--ff-label)', fontSize: 'var(--fs-label)', color: 'var(--text-dim)', letterSpacing: '.5px', marginBottom: '4px' }}>
            {t('settings.push_state')}
          </div>
          <div style={{
            fontFamily: 'var(--ff-micro, monospace)', fontSize: 'var(--fs-micro)', color: 'var(--text-dim)',
            background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
            padding: '7px 9px', lineHeight: 1.7, wordBreak: 'break-word',
          }}>
            {diag}
          </div>
        </div>
      )}
      {!blocked && (
        <>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button onClick={toggle} disabled={busy} style={state === 'on' ? { ...btnGhost, opacity: busy ? .4 : 1 } : btnPrimary(busy)}>
              {busy ? t('settings.push_working') : state === 'on' ? t('settings.push_disable') : t('settings.push_enable')}
            </button>
            {/* Offered whenever anything is registered, not only when this
                browser is. The test goes to every device and now reports
                each one, so pressing it on a laptop is how you find out
                what a phone that is not in front of you actually did. */}
            {devices.length > 0 && (
              <button onClick={test} disabled={busy} style={{ ...btnGhost, opacity: busy ? .4 : 1 }}>
                {t('settings.push_test')}
              </button>
            )}
          </div>
          {enableError && (
            <p style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-micro)', color: 'var(--danger)', marginTop: '10px', lineHeight: 1.6, wordBreak: 'break-word' }}>
              {enableError}
            </p>
          )}

          {state === 'on' && /Android/.test(navigator.userAgent) && (
            <p style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-micro)', color: 'var(--text-dim)', marginTop: '10px', lineHeight: 1.6 }}>
              {t('settings.push_android_note')}
            </p>
          )}

          {/* Every browser that agreed, not just this one. This is what
              answers "did my phone actually register?" — a device missing
              from here never subscribed, and one that is here but failed
              says why. */}
          {devices.length > 0 && (
            <div style={{ marginTop: '14px' }}>
              <div style={{ fontFamily: 'var(--ff-label)', fontSize: 'var(--fs-label)', color: 'var(--text-dim)', letterSpacing: '.5px', marginBottom: '6px' }}>
                {t('settings.push_devices')}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {devices.map(d => {
                  const failed = failures.find(f => f.label === (d.label || 'device'));
                  return (
                    <div key={d.id} style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '7px 10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <span style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text)' }}>
                          {d.label || 'device'}
                        </span>
                        <span style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-micro)', color: failed ? 'var(--danger)' : d.lastOkAt ? 'var(--success)' : 'var(--text-dim)' }}>
                          {failed ? `✕ ${failed.status ?? ''}` : d.lastOkAt ? `✓ ${new Date(d.lastOkAt).toLocaleString()}` : '—'}
                        </span>
                      </div>
                      {failed && (
                        <div style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-micro)', color: 'var(--danger)', marginTop: '3px', wordBreak: 'break-word', lineHeight: 1.5 }}>
                          {failed.detail}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

/* ── Notifications tab ────────────────────────────────── */
const TYPE_COLOR: Record<string, string> = {
  drawdown: 'var(--yellow)', equity: 'var(--cyan)', margin: 'var(--red)',
  offline: 'var(--text-dim)', close_all: 'var(--red)', test: 'var(--green)',
};

const NotificationsTab = () => {
  const t = useTranslation();
  const [logs, setLogs] = useState<NotificationLogEntry[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const limit = 25;

  useEffect(() => {
    setLoading(true);
    fetchNotifications(page, limit)
      .then(res => { setLogs(res.logs); setTotal(res.total); })
      .catch(() => { setLogs([]); setTotal(0); })
      .finally(() => setLoading(false));
  }, [page]);

  const totalPages = Math.ceil(total / limit) || 1;

  const handleExport = () => {
    if (!logs.length) return;
    exportToCSV(
      logs.map(l => ({ type: l.type, message: l.message.replace(/<[^>]+>/g, ''), success: l.success ? 'Yes' : 'No', sentAt: new Date(l.sentAt).toLocaleString() })),
      `notifications-${new Date().toISOString().slice(0, 10)}`,
      [{ key: 'type', label: 'Type' }, { key: 'message', label: 'Message' }, { key: 'success', label: 'Success' }, { key: 'sentAt', label: 'Sent At' }],
    );
  };

  return (
    <>
    <PushCard />
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={cardTitle as React.CSSProperties}>{t('settings.notif_title')}</span>
          <span style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-dim)', padding: '2px 8px', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)' }}>{total}</span>
        </div>
        <button
          onClick={handleExport}
          disabled={!logs.length}
          style={{ fontFamily: 'var(--ff-label)', fontSize: 'var(--fs-label)', color: 'var(--text-dim)', background: 'none', border: 'none', cursor: logs.length ? 'pointer' : 'not-allowed', opacity: logs.length ? 1 : .3, letterSpacing: '.5px' }}
        >
          {t('settings.notif_export')}
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-dim)', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)' }}>{t('common.loading')}</div>
      ) : logs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-dim)', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)' }}>{t('settings.notif_empty')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {logs.map(log => (
            <div key={log.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
              <span style={{ fontFamily: 'var(--ff-micro)', fontSize: 'var(--fs-micro)', letterSpacing: '.5px', color: TYPE_COLOR[log.type] || 'var(--text-dim)', flexShrink: 0, width: '52px', marginTop: '2px' }}>
                {log.type.toUpperCase()}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {log.message.replace(/<[^>]+>/g, '').replace(/\[OnlyFunds\]\n?|\[DOI DASH\]\n?|\[SENTINEL\]\n?/, '').slice(0, 120)}
                </div>
                <div style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-dim)', marginTop: '2px' }}>
                  {new Date(log.sentAt).toLocaleString()}
                </div>
              </div>
              <span style={{
                fontFamily: 'var(--ff-micro)', fontSize: 'var(--fs-micro)', letterSpacing: '.5px', flexShrink: 0,
                padding: '2px 6px',
                border: `1px solid ${log.success ? 'rgba(52,211,153,.3)' : 'rgba(248,113,113,.3)'}`,
                color: log.success ? 'var(--green)' : 'var(--red)',
              }}>
                {log.success ? 'OK' : 'ERR'}
              </span>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '12px' }}>
          <span style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-dim)' }}>{t('settings.page')} {page}/{totalPages}</span>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              style={{ background: 'none', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', color: 'var(--text-dim)', cursor: page > 1 ? 'pointer' : 'not-allowed', padding: '4px 8px', opacity: page > 1 ? 1 : .3 }}>
              ‹
            </button>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
              style={{ background: 'none', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', color: 'var(--text-dim)', cursor: page < totalPages ? 'pointer' : 'not-allowed', padding: '4px 8px', opacity: page < totalPages ? 1 : .3 }}>
              ›
            </button>
          </div>
        </div>
      )}
    </div>
    </>
  );
};
