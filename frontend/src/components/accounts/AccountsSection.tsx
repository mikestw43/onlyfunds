import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from '../../i18n/useTranslation';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { fetchAccounts, deleteAccount, createAccount, getAccountAlerts, saveAccountAlerts, revealApiKey } from '../../services/api';
import type { Account, AccountAlerts } from '../../types';
import { useUIStore } from '../../stores/uiStore';
import { Dialog } from '../ui/Dialog';
import { formatBrokerShort } from '../../utils/formatters';

// EA ServerURL shown to the user: whichever host serves this dashboard
// (VPS domain today, Railway before). VITE_SERVER_URL overrides it.
const SERVER_URL = import.meta.env.VITE_SERVER_URL || window.location.origin;

/** Pixel-art bell glyph — matches retro/pixel theme (replaces the emoji 🔔). */
const PixelBellIcon = ({ pixelSize = 2 }: { pixelSize?: number }) => {
  const px = pixelSize;
  // 6-wide × 7-tall grid
  const pixels: [number, number][] = [
    // top dot (handle)
    [2, 0], [3, 0],
    // shoulder
    [1, 1], [2, 1], [3, 1], [4, 1],
    // body row 2-3
    [1, 2], [2, 2], [3, 2], [4, 2],
    [1, 3], [2, 3], [3, 3], [4, 3],
    // wider base row 4
    [0, 4], [1, 4], [2, 4], [3, 4], [4, 4], [5, 4],
    // base row 5
    [0, 5], [1, 5], [2, 5], [3, 5], [4, 5], [5, 5],
    // clapper
    [2, 6], [3, 6],
  ];
  return (
    <div style={{ position: 'relative', width: `${6 * px}px`, height: `${7 * px}px`, color: 'currentColor' }}>
      {pixels.map(([x, y]) => (
        <div key={`${x}-${y}`} style={{
          position: 'absolute',
          left: `${x * px}px`, top: `${y * px}px`,
          width: `${px}px`, height: `${px}px`,
          background: 'currentColor',
        }} />
      ))}
    </div>
  );
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const generateApiKey = () => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const segments = [8, 4, 4, 12];
  return 'snl_' + segments.map(len =>
    Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  ).join('_');
};

// ─── Shared styles ────────────────────────────────────────────────────────────

const inp: React.CSSProperties = {
  width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)',
  color: 'var(--text)', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)',
  padding: '7px 10px', outline: 'none', boxSizing: 'border-box',
};
const lbl: React.CSSProperties = {
  display: 'block', fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)',
  color: 'var(--text-dim)', letterSpacing: '.5px', marginBottom: '6px',
};
// ─── MaskedKey ────────────────────────────────────────────────────────────────

/** Masked key + COPY button. The full key is never rendered — Copy fetches
 *  it from the API and writes straight to the clipboard so it stays hidden. */
const MaskedKey = ({ accountId, maskedKey }: { accountId: string; maskedKey: string }) => {
  const t = useTranslation();
  const addToast = useUIStore(s => s.addToast);
  const [busy, setBusy] = useState(false);
  const [justCopied, setJustCopied] = useState(false);

  const handleCopy = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // iOS Safari is strict: navigator.clipboard.writeText() must run in the
      // same tick as the user-gesture. Our API call breaks that. The fix is
      // navigator.clipboard.write([ClipboardItem]) with a Promise<Blob> — the
      // write call is synchronous in the gesture, content resolves later.
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        const blobPromise = revealApiKey(accountId)
          .then(k => new Blob([k], { type: 'text/plain' }));
        // @ts-ignore — TS lib types haven't caught up with Promise-valued items
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blobPromise })]);
      } else {
        const key = await revealApiKey(accountId);
        await navigator.clipboard.writeText(key);
      }
      setJustCopied(true);
      setTimeout(() => setJustCopied(false), 1800);
      addToast({ type: 'success', title: t('acc.copied'), message: 'API key copied to clipboard' });
    } catch {
      addToast({ type: 'error', title: t('acc.copy_failed') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
      <span style={{
        fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-dim)',
        flex: 1, minWidth: 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {maskedKey}
      </span>
      <button
        onClick={handleCopy}
        disabled={busy}
        title={t('acc.copy_key')}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: '40px', height: '32px',
          padding: 0,
          background: justCopied ? 'rgba(52,211,153,.15)' : 'rgba(96,165,250,.08)',
          border: `1px solid ${justCopied ? 'var(--green)' : 'var(--cyan)'}`,
          color: justCopied ? 'var(--green)' : 'var(--cyan)',
          fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)',
          cursor: busy ? 'wait' : 'pointer',
          flexShrink: 0,
          transition: 'all .15s',
        }}
      >
        {busy ? '…' : justCopied ? '✓' : '⧉'}
      </button>
    </div>
  );
};

// ─── DeleteDialog ─────────────────────────────────────────────────────────────

const DeleteDialog = ({ account, onClose }: { account: Account; onClose: () => void }) => {
  const t = useTranslation();
  const queryClient = useQueryClient();
  const addToast = useUIStore(s => s.addToast);
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    setLoading(true);
    try {
      await deleteAccount(account.id);
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      addToast({ type: 'success', title: t('acc.deleted'), message: account.name });
      onClose();
    } catch {
      addToast({ type: 'error', title: t('acc.delete_failed') });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={t('acc.delete_dialog')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <p style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)', color: 'var(--text-dim)', lineHeight: 1.6 }}>
          Are you sure you want to delete{' '}
          <strong style={{ color: 'var(--text)' }}>{account.name}</strong>?
          This action cannot be undone.
        </p>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', padding: '8px 14px', background: 'none', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', color: 'var(--text-dim)', cursor: 'pointer', letterSpacing: '.5px' }}
          >{t('common.cancel')}</button>
          <button
            onClick={handleDelete}
            disabled={loading}
            style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', padding: '8px 14px', background: 'var(--red)', color: '#fff', border: '1px solid var(--red)', cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: '.5px', opacity: loading ? .6 : 1 }}
          >{loading ? t('acc.deleting') : t('common.delete')}</button>
        </div>
      </div>
    </Dialog>
  );
};

// ─── NumField (module-level to avoid focus loss on re-render) ─────────────────

const NumField = ({
  label, value, onChange, onClear, placeholder, unit, min = '0', step = '0.1', status,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  onClear: () => void;
  placeholder: string;
  unit: string;
  min?: string;
  step?: string;
  /** Replaces the Disabled/Enabled line for a field where blank is not off. */
  status?: string;
}) => (
  <div>
    <label style={lbl}>{label}</label>
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <input
        type="number" min={min} step={step}
        value={value ?? ''}
        onChange={e => onChange(e.target.value === '' ? null : parseFloat(e.target.value))}
        placeholder={placeholder}
        style={{ ...inp, width: 'auto', flex: 1 }}
      />
      <span style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', color: 'var(--text-dim)', width: '20px', letterSpacing: '.5px' }}>{unit}</span>
      {value !== null && (
        <button type="button" onClick={onClear}
          style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '14px', lineHeight: 1 }}>✕</button>
      )}
    </div>
    <div style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-dim)', marginTop: '3px' }}>
      {status ?? (value === null ? 'Disabled' : 'Enabled')}
    </div>
  </div>
);

// ─── AlertThresholdsDialog ────────────────────────────────────────────────────

/** What a blank repeat interval means, here and on the server. */
const DEFAULT_REPEAT_MINS = 30;

type AlertForm = Omit<AccountAlerts, 'id' | 'alertRepeatMins'> & { alertRepeatMins: number | null };

const AlertThresholdsDialog = ({ account, onClose }: { account: Account; onClose: () => void }) => {
  const t = useTranslation();
  const addToast = useUIStore(s => s.addToast);
  const queryClient = useQueryClient();

  const { data: alerts, isLoading } = useQuery({
    queryKey: ['account-alerts', account.id],
    queryFn: () => getAccountAlerts(account.id),
  });

  // The repeat interval is the one field where blank is a real state to be
  // in: emptying the box to type a new number must leave it empty, not
  // snap back to the default under the typing finger. It is resolved to
  // the default on the way out instead.
  const [form, setForm] = useState<AlertForm>({
    alertDrawdown: null, alertEquityBelow: null, alertMarginLevel: null, alertOffline: false,
    alertRepeatMins: DEFAULT_REPEAT_MINS,
  });

  useEffect(() => {
    if (alerts) setForm({ alertDrawdown: alerts.alertDrawdown, alertEquityBelow: alerts.alertEquityBelow, alertMarginLevel: alerts.alertMarginLevel, alertOffline: alerts.alertOffline, alertRepeatMins: alerts.alertRepeatMins ?? DEFAULT_REPEAT_MINS });
  }, [alerts]);

  const mutation = useMutation({
    mutationFn: () => saveAccountAlerts(account.id, {
      ...form,
      alertRepeatMins: form.alertRepeatMins ?? DEFAULT_REPEAT_MINS,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account-alerts', account.id] });
      // The button's colour is read off the accounts list, not off this
      // dialog, so that has to be refetched too or it stays grey until
      // something else happens to reload it.
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      addToast({ type: 'success', title: t('acc.alerts_saved') });
      onClose();
    },
    onError: () => { addToast({ type: 'error', title: t('acc.alerts_failed') }); },
  });

  return (
    <Dialog open onClose={onClose} title={`${t('acc.alerts_dialog')} — ${account.name}`}>
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '16px', color: 'var(--text-dim)', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)' }}>{t('common.loading')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <p style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-dim)', lineHeight: 1.6 }}>
            {/* It no longer requires Telegram, and saying so was keeping
                people from setting any threshold at all: alerts now reach
                a phone over push and are written to the log the bell
                reads, whether or not a bot was ever configured. */}
            {t('acc.alerts_hint')}
          </p>

          <NumField label={t('acc.alert_dd')} value={form.alertDrawdown} onChange={v => setForm(p => ({ ...p, alertDrawdown: v }))} onClear={() => setForm(p => ({ ...p, alertDrawdown: null }))} placeholder="e.g. 10" unit="%" />
          <NumField label={t('acc.alert_eq')} value={form.alertEquityBelow} onChange={v => setForm(p => ({ ...p, alertEquityBelow: v }))} onClear={() => setForm(p => ({ ...p, alertEquityBelow: null }))} placeholder="e.g. 4500" unit="$" />
          <NumField label={t('acc.alert_ml')} value={form.alertMarginLevel} onChange={v => setForm(p => ({ ...p, alertMarginLevel: v }))} onClear={() => setForm(p => ({ ...p, alertMarginLevel: null }))} placeholder="e.g. 200" unit="%" />

          {/* Not a threshold — how often any of the three above repeats
              while it stays over its line. Blank is not "off" here, so it
              falls back to the default rather than to nothing. */}
          <div>
            <NumField
              label={t('acc.alert_repeat')}
              value={form.alertRepeatMins}
              onChange={v => setForm(p => ({ ...p, alertRepeatMins: v }))}
              onClear={() => setForm(p => ({ ...p, alertRepeatMins: null }))}
              placeholder={String(DEFAULT_REPEAT_MINS)}
              unit={t('acc.alert_mins')}
              min="1"
              step="1"
              status={form.alertRepeatMins === null ? t('acc.alert_repeat_blank') : ''}
            />
            <div style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-micro)', color: 'var(--text-muted)', lineHeight: 1.6, marginTop: '4px' }}>
              {t('acc.alert_repeat_hint')}
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
            <input
              type="checkbox" id="alertOffline"
              checked={form.alertOffline}
              onChange={e => setForm(p => ({ ...p, alertOffline: e.target.checked }))}
              style={{ width: '14px', height: '14px', accentColor: 'var(--cyan)', cursor: 'pointer' }}
            />
            <span style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)', color: 'var(--text-dim)' }}>{t('acc.offline_alert')}</span>
          </label>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', paddingTop: '4px' }}>
            <button onClick={onClose}
              style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', padding: '8px 14px', background: 'none', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', color: 'var(--text-dim)', cursor: 'pointer', letterSpacing: '.5px' }}>
              CANCEL
            </button>
            <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
              style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', padding: '8px 14px', background: 'var(--cyan)', color: '#25272c', border: '1px solid var(--cyan)', cursor: mutation.isPending ? 'not-allowed' : 'pointer', letterSpacing: '.5px', opacity: mutation.isPending ? .6 : 1 }}>
              {mutation.isPending ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
};

// ─── ApiKeyRevealDialog ───────────────────────────────────────────────────────

const ApiKeyRevealDialog = ({ apiKey, accountName, onClose }: { apiKey: string; accountName: string; onClose: () => void }) => {
  const t = useTranslation();
  const [copied, setCopied] = useState(false);

  const copyKey = () => {
    navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <Dialog open onClose={() => {}} title={t('acc.created_dialog')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

        {/* Warning banner */}
        <div style={{
          padding: '12px 14px',
          background: 'rgba(251,191,36,.08)', border: '2px solid rgba(251,191,36,.5)',
          fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', color: 'var(--warning)', lineHeight: 1.8, letterSpacing: '.5px',
          textAlign: 'center',
        }}>
          {t('acc.key_once')}<br />
          <span style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)', letterSpacing: 0 }}>
            {t('acc.key_copy_now')}
          </span>
        </div>

        {/* Account name */}
        <div>
          <label style={lbl}>{t('acc.title')}</label>
          <div style={{ fontFamily: 'var(--ff-input)', fontSize: 'var(--fs-input)', color: 'var(--text)' }}>{accountName}</div>
        </div>

        {/* API Key with large copy button */}
        <div>
          <label style={lbl}>{t('acc.apikey_label')}</label>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            background: 'var(--bg-input)', border: '2px solid var(--accent-blue)', padding: '10px 12px',
          }}>
            <code style={{
              fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)',
              color: 'var(--accent-blue)', flex: 1,
              wordBreak: 'break-all', userSelect: 'all', letterSpacing: '.5px',
            }}>
              {apiKey}
            </code>
            <button
              onClick={copyKey}
              style={{
                flexShrink: 0,
                fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', padding: '8px 12px',
                background: copied ? 'rgba(52,211,153,.15)' : 'rgba(96,165,250,.12)',
                border: `1px solid ${copied ? 'var(--success)' : 'var(--accent-blue)'}`,
                color: copied ? 'var(--success)' : 'var(--accent-blue)',
                cursor: 'pointer', letterSpacing: '.5px',
                transition: 'all .2s',
              }}
            >
              {copied ? '✓ COPIED' : '⎘ COPY'}
            </button>
          </div>
        </div>

        {/* EA Setup instructions */}
        <div>
          <label style={lbl}>{t('acc.ea_setup')}</label>
          <div style={{
            background: 'var(--bg-input)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)',
            padding: '10px 12px', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)',
            color: 'var(--text-dim)', lineHeight: 2,
          }}>
            <div>① Attach EA to any chart in MT5</div>
            <div>② Set <span style={{ color: 'var(--accent-blue)' }}>ApiKey</span> = <span style={{ color: 'var(--warning)' }}>{apiKey}</span></div>
            <div>③ Set <span style={{ color: 'var(--accent-blue)' }}>ServerURL</span> = <span style={{ color: 'var(--text-dim)' }}>{SERVER_URL}</span></div>
            <div>④ Broker, account number &amp; currency will fill in automatically on first push</div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', padding: '10px 18px',
              background: copied ? 'var(--success)' : 'var(--accent-blue)',
              color: '#25272c',
              border: `1px solid ${copied ? 'var(--success)' : 'var(--accent-blue)'}`,
              cursor: 'pointer', letterSpacing: '.5px',
            }}
          >
            {copied ? 'DONE ✓' : t('acc.copied_key')}
          </button>
        </div>
      </div>
    </Dialog>
  );
};

// ─── AddAccountDialog ─────────────────────────────────────────────────────────
// Simplified: user only enters account name + demo toggle.
// API key is auto-generated. MT5 EA fills in broker/accountNumber/server/currency/leverage on first connect.

const AddAccountDialog = ({ onClose, onCreated }: { onClose: () => void; onCreated: (apiKey: string, name: string) => void }) => {
  const t = useTranslation();
  const queryClient = useQueryClient();
  const addToast = useUIStore(s => s.addToast);
  const [name, setName] = useState('');
  const [isDemo, setIsDemo] = useState(false);
  const [apiKey] = useState(generateApiKey);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { addToast({ type: 'warning', title: t('acc.name_required') }); return; }
    setLoading(true);
    try {
      await createAccount({ name: name.trim(), apiKey, isDemo });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      onCreated(apiKey, name.trim());
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || t('acc.add_failed');
      addToast({ type: 'error', title: msg });
      setLoading(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={t('acc.add_dialog')}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

        {/* Info banner */}
        <div style={{ padding: '8px 10px', background: 'rgba(96,165,250,.06)', border: '1px solid rgba(96,165,250,.2)', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-dim)', lineHeight: 1.6 }}>
          ℹ Broker, account number, server &amp; currency will be filled automatically when your MT5 EA connects.
        </div>

        {/* Account Name */}
        <div>
          <label style={lbl}>ACCOUNT NAME *</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={t('acc.name_ph')}
            style={inp}
            autoFocus
          />
        </div>

        {/* Demo / Live toggle */}
        <label style={{
          display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer',
          padding: '10px 12px',
          border: isDemo ? '1px solid rgba(251,191,36,.4)' : '1px solid var(--border2)',
          background: isDemo ? 'rgba(251,191,36,.06)' : 'rgba(52,211,153,.04)',
          transition: 'all .15s',
        }}>
          <input
            type="checkbox"
            checked={isDemo}
            onChange={e => setIsDemo(e.target.checked)}
            style={{ width: '14px', height: '14px', accentColor: 'var(--warning)', cursor: 'pointer', flexShrink: 0 }}
          />
          <div>
            <div style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', color: isDemo ? 'var(--warning)' : 'var(--success)', letterSpacing: '.5px' }}>
              {isDemo ? '⬛ DEMO / SANDBOX' : '▶ LIVE ACCOUNT'}
            </div>
            <div style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-muted)', marginTop: '4px' }}>
              {isDemo
                ? t('acc.demo_on')
                : t('acc.demo_off')}
            </div>
          </div>
        </label>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', paddingTop: '4px' }}>
          <button type="button" onClick={onClose}
            style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', padding: '8px 14px', background: 'none', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', color: 'var(--text-dim)', cursor: 'pointer', letterSpacing: '.5px' }}>
            CANCEL
          </button>
          <button type="submit" disabled={loading || !name.trim()}
            style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', padding: '8px 14px', background: 'var(--accent-blue)', color: '#25272c', border: '1px solid var(--accent-blue)', cursor: (loading || !name.trim()) ? 'not-allowed' : 'pointer', letterSpacing: '.5px', opacity: (loading || !name.trim()) ? .5 : 1 }}>
            {loading ? t('acc.adding') : t('acc.add')}
          </button>
        </div>
      </form>
    </Dialog>
  );
};

// ─── AccountsSection (main export) ───────────────────────────────────────────

export const AccountsSection = () => {
  const t = useTranslation();
  const [showAdd, setShowAdd] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null);
  const [revealKey, setRevealKey] = useState<{ apiKey: string; name: string } | null>(null);
  const [alertTarget, setAlertTarget] = useState<Account | null>(null);

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: fetchAccounts,
    staleTime: 30000,
  });

  // Demo accounts always sink to the bottom of the list so live accounts
  // (the ones that actually count) stay at the top.
  const sortedAccounts = useMemo(
    () => [...accounts].sort((a, b) => Number(!!a.isDemo) - Number(!!b.isDemo)),
    [accounts]
  );

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '16px 18px' }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', color: 'var(--text-primary)', fontWeight: 600, letterSpacing: '.5px' }}>
            {t('acc.key_mgmt')}
          </span>
          <span style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-dim)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '2px 7px' }}>
            {accounts.length}
          </span>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', letterSpacing: '.5px', padding: '7px 12px', background: 'var(--cyan)', color: '#25272c', border: '1px solid var(--cyan)', cursor: 'pointer' }}
        >
          {t('acc.add_btn')}
        </button>
      </div>

      <div style={{ marginTop: '14px' }}>
        {isLoading ? (
          <div style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)', color: 'var(--text-dim)', textAlign: 'center', padding: '16px' }}>{t('common.loading')}</div>
        ) : accounts.length === 0 ? (
          <div style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)', color: 'var(--text-dim)', textAlign: 'center', padding: '16px' }}>
            No accounts yet. Add your first MT5/MT4 account.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {sortedAccounts.map((acc: Account) => {
              const isDemo = !!acc.isDemo;
              const online = acc.status === 'online';
              return (
                <div
                  key={acc.id}
                  style={{
                    background: isDemo ? 'rgba(251,191,36,.04)' : 'var(--bg-card2)',
                    border: `1px solid ${isDemo ? 'rgba(251,191,36,.3)' : 'var(--border2)'}`,
                    padding: '12px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  {/* Row 1: name + DEMO chip + status */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', color: 'var(--text)', letterSpacing: '.5px' }}>
                      {acc.name}
                    </span>
                    {isDemo && (
                      <span style={{
                        fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-micro)',
                        padding: '2px 6px', letterSpacing: '.5px',
                        border: '1px solid var(--warning)',
                        background: 'rgba(251,191,36,.1)',
                        color: 'var(--warning)',
                      }}>DEMO</span>
                    )}
                    <span style={{
                      marginLeft: 'auto',
                      display: 'inline-flex', alignItems: 'center', gap: '5px',
                      fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', letterSpacing: '.5px',
                      color: online ? 'var(--green)' : 'var(--text-dim)',
                    }}>
                      <span style={{ width: '6px', height: '6px', background: online ? 'var(--green)' : '#4a4e57',display: 'inline-block' }} />
                      {t(`status.${acc.status}`)}
                    </span>
                  </div>

                  {/* Row 2: account # · broker (first word) */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-dim)' }}>
                    <span>#{acc.accountNumber}</span>
                    <span style={{ opacity: .5 }}>·</span>
                    <span>{formatBrokerShort(acc.broker)}</span>
                  </div>

                  {/* Row 3: API key */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <MaskedKey accountId={acc.id} maskedKey={acc.apiKey} />
                  </div>

                  {/* Row 4: actions — right-aligned */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', marginTop: '2px' }}>
                    {/* Green once anything is set on this account, so a
                        row of these says which are being watched without
                        opening each one. */}
                    <button
                      onClick={() => setAlertTarget(acc)}
                      title={t('acc.alerts_title')}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '6px',
                        background: acc.alertsArmed ? 'rgba(52,211,153,.08)' : 'none',
                        border: `1px solid ${acc.alertsArmed ? 'rgba(52,211,153,.45)' : 'var(--border2)'}`,
                        borderRadius: 'var(--radius-sm)',
                        color: acc.alertsArmed ? 'var(--green)' : 'var(--text-dim)',
                        cursor: 'pointer',
                        padding: '5px 10px',
                        fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', letterSpacing: '.5px',
                      }}
                    >
                      <PixelBellIcon />
                      {t('acc.btn_alert')}
                    </button>
                    <button
                      onClick={() => setDeleteTarget(acc)}
                      title={t('acc.delete_title')}
                      style={{
                        background: 'none', border: '1px solid rgba(248,113,113,.3)',
                        color: 'var(--red)', cursor: 'pointer',
                        padding: '5px 10px',
                        fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', letterSpacing: '.5px',
                      }}
                    >
                      ✕ {t('acc.btn_delete')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showAdd && <AddAccountDialog onClose={() => setShowAdd(false)} onCreated={(apiKey, name) => { setShowAdd(false); setRevealKey({ apiKey, name }); }} />}
      {revealKey && <ApiKeyRevealDialog apiKey={revealKey.apiKey} accountName={revealKey.name} onClose={() => setRevealKey(null)} />}
      {deleteTarget && <DeleteDialog account={deleteTarget} onClose={() => setDeleteTarget(null)} />}
      {alertTarget && <AlertThresholdsDialog account={alertTarget} onClose={() => setAlertTarget(null)} />}
    </div>
  );
};
