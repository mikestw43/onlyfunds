import { useState, useEffect } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { updateProfile, savePreferences, getProfile, linkGoogle, unlinkGoogle } from '../../services/api';
import { useTranslation } from '../../i18n/useTranslation';
import { ChangePasswordModal } from './ChangePasswordModal';
import {
  supported as passkeysSupported, listPasskeys, addPasskey, claimExistingPasskey,
  removePasskey, readPasskeyError, localKeyId, type Passkey,
} from '../../services/passkeys';
import { GoogleAuth, googleEnabled } from '../auth/googleAuth';
import { formatDate, formatDateTime } from '../../utils/formatters';

const PHONE_COUNTRIES = [
  { code: 'TH', dial: '+66', label: 'TH +66' },
  { code: 'US', dial: '+1',  label: 'US +1' },
  { code: 'SG', dial: '+65', label: 'SG +65' },
  { code: 'GB', dial: '+44', label: 'GB +44' },
  { code: 'JP', dial: '+81', label: 'JP +81' },
  { code: 'AU', dial: '+61', label: 'AU +61' },
];

const TIMEZONES = [
  { value: 'Asia/Bangkok',     label: 'Asia/Bangkok (UTC+7)' },
  { value: 'Asia/Singapore',   label: 'Asia/Singapore (UTC+8)' },
  { value: 'Asia/Tokyo',       label: 'Asia/Tokyo (UTC+9)' },
  { value: 'Europe/London',    label: 'Europe/London (UTC+0)' },
  { value: 'America/New_York', label: 'America/New_York (UTC-5)' },
];

/* ── shared styles ────────────────────────────────────── */
const card: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)',
  padding: '18px 20px', marginBottom: '10px',
};
const cardTitle: React.CSSProperties = {
  fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)',
  color: 'var(--text-primary)', fontWeight: 600, letterSpacing: '1px',
  marginBottom: '14px',
};
const rowStyle: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: '140px minmax(0, 1fr)',
  gap: '12px', alignItems: 'center',
  padding: '10px 0',
  borderBottom: '1px dashed var(--border)',
  wordBreak: 'break-word',
};
const lblStyle: React.CSSProperties = {
  fontFamily: 'var(--ff-micro)', fontSize: 'var(--fs-micro)',
  color: 'var(--text-dim)', letterSpacing: '.5px',
};
const valStyle: React.CSSProperties = {
  fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)',
  color: 'var(--text)',
};
const readOnlyStyle: React.CSSProperties = {
  ...valStyle, color: 'var(--text-dim)',
};
const inp: React.CSSProperties = {
  background: 'var(--bg-input)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)',
  color: 'var(--text)', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-input)',
  padding: '7px 9px', outline: 'none', boxSizing: 'border-box',
  width: '100%',
};
const sel: React.CSSProperties = { ...inp, cursor: 'pointer' };
const btnPrimary: React.CSSProperties = {
  fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', letterSpacing: '.5px',
  padding: '9px 16px', background: 'var(--cyan)', color: '#25272c',
  border: '1px solid var(--cyan)', cursor: 'pointer',
};
const btnGhost: React.CSSProperties = {
  fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', letterSpacing: '.5px',
  padding: '9px 16px', background: 'none', color: 'var(--text)',
  border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
};
const btnDanger: React.CSSProperties = {
  ...btnGhost, color: 'var(--red)', borderColor: 'rgba(248,113,113,.4)',
};

const fmtDate = formatDate;
const fmtDateTime = formatDateTime;

/**
 * Signing in with Face ID, a fingerprint, or whatever unlocks the device.
 *
 * A switch, because that is all there is to decide: this device either
 * signs you in or it does not. The key is made by this phone and stays in
 * it, so the switch is about the phone in your hand, like the one for
 * notifications — somebody with a phone and a laptop turns it on twice.
 *
 * The server keeps only the public half, which checks a signature and
 * cannot make one. There is nothing here to steal and nothing a person
 * can be talked into typing somewhere else: the browser only ever offers
 * the key back to this exact domain.
 *
 * Other devices are listed only when there are any, and then only as a
 * name and a cross. It is the one thing this screen must still be able to
 * do that the switch cannot: a phone that has been lost is a key that has
 * to come off the account from somewhere else.
 */
const PasskeyRow = () => {
  const t = useTranslation();
  const addToast = useUIStore(s => s.addToast);
  const [keys, setKeys] = useState<Passkey[] | null>(null);
  const [busy, setBusy] = useState(false);
  // On screen rather than only in the console: the phone that fails is
  // rarely the device with a console attached.
  const [error, setError] = useState('');
  /**
   * The device says it already has a key this browser does not know
   * about — registered before the mark existed, or site data cleared
   * since. The next press uses that key instead of making another, which
   * is the only way to find out which one it is.
   */
  const [claim, setClaim] = useState(false);

  const refresh = () => listPasskeys().then(setKeys).catch(() => setKeys([]));
  useEffect(() => {
    if (!passkeysSupported()) { setKeys([]); return; }
    refresh();
  }, []);

  if (keys === null) return null;
  const usable = passkeysSupported();
  const mine = keys.find(k => k.id === localKeyId()) ?? null;
  const others = keys.filter(k => k.id !== mine?.id);

  const toggle = async () => {
    setBusy(true);
    setError('');
    try {
      if (mine) {
        await removePasskey(mine.id);
      } else if (claim) {
        await claimExistingPasskey();
        setClaim(false);
        addToast({ type: 'success', title: t('settings.passkey_added') });
      } else {
        await addPasskey();
        addToast({ type: 'success', title: t('settings.passkey_added') });
      }
      await refresh();
    } catch (err) {
      // Cancelling the Face ID sheet is not a failure and says nothing.
      const message = readPasskeyError(err);
      if (message === 'ALREADY_REGISTERED') {
        // Not an error so much as a thing to do: ask the device to prove
        // which key it is holding, and the switch can be told the truth.
        setClaim(true);
        setError(t('settings.passkey_claim'));
      } else if (message) {
        setError(message);
        addToast({ type: 'error', title: t('settings.passkey_failed') });
      }
    } finally { setBusy(false); }
  };

  const drop = async (id: string) => {
    setBusy(true);
    try {
      await removePasskey(id);
      await refresh();
    } catch { addToast({ type: 'error', title: t('settings.passkey_failed') }); }
    finally { setBusy(false); }
  };

  const on = Boolean(mine);

  return (
    <div style={{ ...rowStyle, borderBottom: '1px dashed var(--border)' }}>
      <span style={lblStyle}>{t('settings.passkey_title')}</span>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
          <span style={on ? { ...valStyle, color: 'var(--green)' } : readOnlyStyle}>
            {!usable ? t('settings.passkey_unsupported')
              : on ? t('settings.passkey_this_on')
              : t('settings.passkey_this_off')}
          </span>
          {usable && (
            // A switch rather than a checkbox: it is the shape everything
            // else on a phone uses for "this is on".
            <button
              role="switch"
              aria-checked={on}
              aria-label={t('settings.passkey_title')}
              disabled={busy}
              onClick={toggle}
              style={{
                flexShrink: 0, width: '46px', height: '26px', borderRadius: '13px',
                border: `1px solid ${on ? 'var(--green)' : 'var(--border2)'}`,
                background: on ? 'rgba(52,211,153,.18)' : 'var(--bg-input)',
                position: 'relative', cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? .5 : 1, transition: 'background .15s, border-color .15s',
                padding: 0,
              }}
            >
              <span style={{
                position: 'absolute', top: '2px', left: on ? '22px' : '2px',
                width: '20px', height: '20px', borderRadius: '50%',
                background: on ? 'var(--green)' : 'var(--text-dim)',
                transition: 'left .15s',
              }} />
            </button>
          )}
        </div>

        {error && (
          <p style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-micro)', color: claim ? 'var(--text-dim)' : 'var(--danger)', marginTop: '8px', lineHeight: 1.6, wordBreak: 'break-word' }}>
            {error}
          </p>
        )}

        {others.length > 0 && (
          <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {others.map(k => (
              <div key={k.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-micro)', color: 'var(--text-dim)' }}>
                  {k.label || 'Device'}
                </span>
                <button
                  onClick={() => drop(k.id)}
                  disabled={busy}
                  title={t('settings.passkey_remove')}
                  style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: busy ? 'not-allowed' : 'pointer', fontSize: '13px', lineHeight: 1, padding: '2px 4px' }}
                >✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export const ProfilePage = () => {
  const user = useAuthStore(s => s.user);
  const token = useAuthStore(s => s.token);
  const setAuth = useAuthStore(s => s.setAuth);
  const setCurrentPage = useUIStore(s => s.setCurrentPage);
  const addToast = useUIStore(s => s.addToast);
  const language = useUIStore(s => s.language);
  const setLanguage = useUIStore(s => s.setLanguage);
  const t = useTranslation();

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPwModal, setShowPwModal] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  const finishGoogleLink = async (accessToken: string) => {
    setGoogleBusy(true);
    try {
      const updated = await linkGoogle(accessToken);
      if (token) setAuth(token, updated);
      addToast({ type: 'success', title: 'Google linked' });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to link Google';
      addToast({ type: 'error', title: msg });
    } finally {
      setGoogleBusy(false);
    }
  };

  const handleUnlinkGoogle = async () => {
    setGoogleBusy(true);
    try {
      const updated = await unlinkGoogle();
      if (token) setAuth(token, updated);
      addToast({ type: 'success', title: 'Google unlinked' });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to unlink Google';
      addToast({ type: 'error', title: msg });
    } finally {
      setGoogleBusy(false);
    }
  };

  // Edit form state
  const [fullName, setFullName] = useState(user?.name || '');
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [email, setEmail] = useState(user?.email || '');
  const [phoneCountry, setPhoneCountry] = useState(user?.phoneCountry || 'TH');
  const [mobile, setMobile] = useState(user?.mobile || '');
  const [timezone, setTimezone] = useState(user?.timezone || 'Asia/Bangkok');
  const [lang, setLang] = useState(language);

  // Fetch fresh profile on mount (in case user object is stale from older login)
  useEffect(() => {
    getProfile().then(fresh => {
      if (token && fresh) setAuth(token, fresh);
    }).catch(() => { /* silent */ });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync edit form when user object updates
  useEffect(() => {
    setFullName(user?.name || '');
    setDisplayName(user?.displayName || '');
    setEmail(user?.email || '');
    setPhoneCountry(user?.phoneCountry || 'TH');
    setMobile(user?.mobile || '');
    setTimezone(user?.timezone || 'Asia/Bangkok');
  }, [user]);

  useEffect(() => { setLang(language); }, [language]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const trimmedEmail = email.trim().toLowerCase();
      const emailChanged = trimmedEmail && trimmedEmail !== (user?.email || '').toLowerCase();
      const updated = await updateProfile({
        name: fullName,
        displayName,
        mobile,
        phoneCountry,
        timezone,
        ...(emailChanged && { email: trimmedEmail }),
      });
      if (token) setAuth(token, updated);
      if (lang !== language) {
        await savePreferences({ language: lang });
        setLanguage(lang);
      } else {
        await savePreferences({ timezone });
      }
      addToast({ type: 'success', title: t('profile.saved') || 'Profile updated' });
      setEditing(false);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to update';
      addToast({ type: 'error', title: msg });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setFullName(user?.name || '');
    setDisplayName(user?.displayName || '');
    setPhoneCountry(user?.phoneCountry || 'TH');
    setMobile(user?.mobile || '');
    setTimezone(user?.timezone || 'Asia/Bangkok');
    setLang(language);
    setEditing(false);
  };

  const initials = (user?.displayName || user?.name || user?.email || 'U')
    .split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const headerName = user?.displayName || user?.name || user?.email?.split('@')[0] || 'User';
  const isAdmin = user?.role === 'admin';
  const tzLabel = TIMEZONES.find(z => z.value === timezone)?.label || timezone;
  const phoneLabel = (() => {
    if (!user?.mobile) return '—';
    const dial = PHONE_COUNTRIES.find(c => c.code === user.phoneCountry)?.dial || '';
    return `${dial} ${user.mobile}`.trim();
  })();

  return (
    <div style={{ maxWidth: '760px', margin: '0 auto' }}>
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
          ‹ BACK
        </button>
        <span style={{ width: '6px', height: '6px', background: 'var(--cyan)',}} />
        <span style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-title)', color: 'var(--text-primary)', fontWeight: 600, letterSpacing: '2px',}}>
          PROFILE
        </span>
        <div style={{ flex: 1, height: '1px', background: 'var(--border2)' }} />
      </div>

      {/* Header card */}
      {/* The button used to sit in a row that could not wrap, so on a phone the
          email ran underneath it. It keeps its size and drops to its own line
          instead, and a long address breaks rather than reaching across. */}
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{
          width: '60px', height: '60px',
          background: 'var(--accent-bg)',
          border: '1px solid var(--border2)',
          borderRadius: 'var(--radius-card)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--ff-section)', fontSize: '16px', fontWeight: 600,
          color: 'var(--text-primary)', flexShrink: 0,
        }}>
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: '160px', overflowWrap: 'anywhere' }}>
          <div style={{
            fontFamily: 'var(--ff-body)', fontSize: '16px',
            color: 'var(--text)', marginBottom: '6px', fontWeight: 600,
          }}>
            {headerName}
          </div>
          <div style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-dim)', lineHeight: 1.6 }}>
            <span style={{
              fontFamily: 'var(--ff-micro)', fontSize: 'var(--fs-micro)', letterSpacing: '.5px',
              padding: '2px 6px', marginRight: '8px',
              border: `1px solid ${isAdmin ? 'rgba(96,165,250,.4)' : 'var(--border2)'}`,
              color: isAdmin ? 'var(--cyan)' : 'var(--text-dim)',
              background: isAdmin ? 'rgba(96,165,250,.08)' : 'none',
              verticalAlign: 'middle',
            }}>
              {(user?.role || 'user').toUpperCase()}
            </span>
            {user?.email}
            {/* "Member since" is a row of its own in PERSONAL INFO just below,
                so the header keeps only what is not repeated there. */}
            {user?.lastLoginAt && (
              <>
                <br />
                Last login {fmtDateTime(user?.lastLoginAt)}
              </>
            )}
          </div>
        </div>
        {!editing && (
          <button style={{ ...btnGhost, flexShrink: 0 }} onClick={() => setEditing(true)}>EDIT PROFILE</button>
        )}
      </div>

      {/* Personal Info */}
      <div style={card}>
        <div style={cardTitle}>PERSONAL INFO</div>

        <div style={rowStyle}>
          <span style={lblStyle}>FULL NAME</span>
          {editing ? (
            <input style={inp} value={fullName} onChange={e => setFullName(e.target.value)} />
          ) : (
            <span style={valStyle}>{user?.name || '—'}</span>
          )}
        </div>

        <div style={rowStyle}>
          <span style={lblStyle}>DISPLAY NAME</span>
          {editing ? (
            <div>
              <input style={inp} value={displayName} onChange={e => setDisplayName(e.target.value)} />
              <div style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-dim)', marginTop: '4px' }}>
                Shown in top menu · short name or nickname
              </div>
            </div>
          ) : (
            <span style={valStyle}>{user?.displayName || '—'}</span>
          )}
        </div>

        <div style={rowStyle}>
          <span style={lblStyle}>EMAIL</span>
          {editing ? (
            <input
              type="email"
              style={inp}
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          ) : (
            <span style={valStyle}>{user?.email}</span>
          )}
        </div>

        <div style={rowStyle}>
          <span style={lblStyle}>MOBILE</span>
          {editing ? (
            <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '6px' }}>
              <select style={sel} value={phoneCountry} onChange={e => setPhoneCountry(e.target.value)}>
                {PHONE_COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
              <input style={inp} value={mobile} onChange={e => setMobile(e.target.value)} placeholder="812345678" />
            </div>
          ) : (
            <span style={valStyle}>{phoneLabel}</span>
          )}
        </div>

        <div style={rowStyle}>
          <span style={lblStyle}>ROLE</span>
          <span style={{
            fontFamily: 'var(--ff-label)', fontSize: 'var(--fs-label)', letterSpacing: '.5px',
            padding: '3px 8px', display: 'inline-block',
            border: `1px solid ${isAdmin ? 'rgba(96,165,250,.4)' : 'var(--border2)'}`,
            color: isAdmin ? 'var(--cyan)' : 'var(--text-dim)',
            background: isAdmin ? 'rgba(96,165,250,.08)' : 'none',
            width: 'fit-content',
          }}>
            {(user?.role || 'user').toUpperCase()}
          </span>
        </div>

        <div style={{ ...rowStyle, borderBottom: 'none' }}>
          <span style={lblStyle}>MEMBER SINCE</span>
          <span style={readOnlyStyle}>{fmtDate(user?.createdAt)}</span>
        </div>
      </div>

      {/* Preferences */}
      <div style={card}>
        <div style={cardTitle}>PREFERENCES</div>

        <div style={rowStyle}>
          <span style={lblStyle}>LANGUAGE</span>
          {editing ? (
            <select style={sel} value={lang} onChange={e => setLang(e.target.value as 'en' | 'th')}>
              <option value="en">English (EN)</option>
              <option value="th">ภาษาไทย (TH)</option>
            </select>
          ) : (
            <span style={valStyle}>{language === 'th' ? 'ภาษาไทย (TH)' : 'English (EN)'}</span>
          )}
        </div>

        <div style={{ ...rowStyle, borderBottom: 'none' }}>
          <span style={lblStyle}>TIMEZONE</span>
          {editing ? (
            <select style={sel} value={timezone} onChange={e => setTimezone(e.target.value)}>
              {TIMEZONES.map(z => <option key={z.value} value={z.value}>{z.label}</option>)}
            </select>
          ) : (
            <span style={valStyle}>{tzLabel}</span>
          )}
        </div>
      </div>

      {/* Security */}
      <div style={card}>
        <div style={cardTitle}>SECURITY</div>
        <PasskeyRow />
        <div style={{ ...rowStyle, borderBottom: googleEnabled ? '1px dashed var(--border)' : 'none' }}>
          <span style={lblStyle}>PASSWORD</span>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
            <span style={readOnlyStyle}>{user?.hasPassword === false ? '— (Google-only account)' : '••••••••••••'}</span>
            <button style={btnGhost} onClick={() => setShowPwModal(true)}>
              {user?.hasPassword === false ? 'SET PASSWORD' : 'CHANGE PASSWORD'}
            </button>
          </div>
        </div>

        {googleEnabled && (
          <div style={{ ...rowStyle, borderBottom: 'none' }}>
            <span style={lblStyle}>GOOGLE</span>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
              {user?.hasGoogleLinked ? (
                <>
                  <span style={{ ...valStyle, color: 'var(--green)' }}>✓ LINKED</span>
                  <button
                    style={{ ...btnDanger, opacity: googleBusy || !user?.hasPassword ? 0.5 : 1, cursor: googleBusy || !user?.hasPassword ? 'not-allowed' : 'pointer' }}
                    disabled={googleBusy || !user?.hasPassword}
                    onClick={handleUnlinkGoogle}
                    title={!user?.hasPassword ? 'Set a password before unlinking — otherwise you will be locked out' : ''}
                  >
                    {googleBusy ? 'WORKING...' : 'UNLINK'}
                  </button>
                </>
              ) : (
                <>
                  <span style={readOnlyStyle}>Not linked</span>
                  <GoogleAuth
                    onToken={finishGoogleLink}
                    onError={() => addToast({ type: 'error', title: 'Google sign-in failed' })}
                  >
                    {signIn => (
                      <button
                        style={{ ...btnGhost, opacity: googleBusy ? 0.5 : 1, cursor: googleBusy ? 'not-allowed' : 'pointer' }}
                        disabled={googleBusy}
                        onClick={() => signIn()}
                      >
                        {googleBusy ? 'LINKING...' : 'LINK GOOGLE'}
                      </button>
                    )}
                  </GoogleAuth>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Edit action bar */}
      {editing && (
        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: '8px',
          padding: '4px 0 16px',
        }}>
          <button style={btnDanger} onClick={handleCancel}>CANCEL</button>
          <button style={btnPrimary} onClick={handleSave} disabled={saving}>
            {saving ? 'SAVING...' : 'SAVE CHANGES'}
          </button>
        </div>
      )}

      {showPwModal && <ChangePasswordModal onClose={() => setShowPwModal(false)} />}
    </div>
  );
};
