import { startRegistration, startAuthentication, browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable } from '@simplewebauthn/browser';
import api from './api';
import type { AuthUser } from '../types';

/**
 * Signing in with Face ID, a fingerprint, or whatever unlocks this device.
 *
 * The browser does the hard part. We ask the server for a challenge, hand
 * it to the browser, and the browser deals with the operating system: an
 * iPhone shows Face ID, an iPhone without it shows Touch ID, an Android
 * shows its fingerprint reader, a laptop shows Windows Hello — and a face
 * that will not scan falls back to the device's own passcode. None of
 * that is decided here, which is why there is no branch for any of it.
 *
 * Nothing about the face or the fingerprint reaches this code, let alone
 * the server. What comes back is a signature.
 */

export interface Passkey {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

/** Can this browser do it at all? */
export const supported = (): boolean => browserSupportsWebAuthn();

/**
 * Is there a biometric or screen lock built into this device?
 *
 * Separate from `supported`, because a desktop browser with no Windows
 * Hello can still use a phone or a USB key — worth offering, but not worth
 * leading with "Face ID".
 */
export const hasDeviceUnlock = async (): Promise<boolean> => {
  try {
    return await platformAuthenticatorIsAvailable();
  } catch {
    return false;
  }
};

/**
 * Which key, if any, belongs to THIS browser.
 *
 * The server knows every key on the account; it cannot know which of them
 * the device in front of you is holding — WebAuthn gives a page no way to
 * ask "do I have one of these?" without putting a prompt on the screen.
 * So the row id is noted down here when the key is made, and again
 * whenever one is used to sign in, which also repairs it on a browser
 * whose storage was cleared.
 *
 * Two things read it: the toggle in settings, which is about this device,
 * and the sign-in button, which should not be offered to somebody who has
 * never registered anything.
 */
const MARK = 'onlyfunds_passkey_id';

export const localKeyId = (): string | null => {
  try { return localStorage.getItem(MARK); } catch { return null; }
};
const mark = (id: string): void => {
  try { localStorage.setItem(MARK, id); } catch { /* private window */ }
};
const unmark = (): void => {
  try { localStorage.removeItem(MARK); } catch { /* nothing to forget */ }
};

export const listPasskeys = async (): Promise<Passkey[]> =>
  (await api.get<{ passkeys: Passkey[] }>('/passkeys')).data.passkeys;

export const removePasskey = async (id: string): Promise<void> => {
  await api.delete(`/passkeys/${id}`);
  if (localKeyId() === id) unmark();
};

/**
 * Register this device, for someone already signed in.
 *
 * Unlike the push subscription, this does NOT have to be the first thing
 * after the tap: the browser prompt is raised by startRegistration itself
 * and the fetch before it is part of the same gesture as far as Safari is
 * concerned, because no permission is being granted — the device is being
 * asked to make a key.
 */
export const addPasskey = async (): Promise<Passkey> => {
  const { data } = await api.post('/passkeys/register/options', {});
  const response = await startRegistration({ optionsJSON: data.options });
  const verified = await api.post('/passkeys/register/verify', {
    response, challengeId: data.challengeId,
  });
  const passkey = verified.data.passkey as Passkey;
  mark(passkey.id);
  return passkey;
};

/**
 * Find out which key this device already holds, and note it down.
 *
 * Needed because the device can hold a key this browser has forgotten:
 * registered before the mark existed, or site data cleared since. The
 * browser then refuses to register a second one ("already registered")
 * while the sign-in button stays hidden, and no amount of tapping fixes
 * it.
 *
 * The way out is to use the key rather than make one. It is the ordinary
 * sign-in ceremony, run while already signed in — the device offers the
 * key it has, the server says which row that is, and the mark is written
 * back. The token that comes with it is for the same person, so it is
 * simply ignored.
 */
export const claimExistingPasskey = async (): Promise<void> => {
  const { data } = await api.post('/passkeys/login/options', {});
  const response = await startAuthentication({ optionsJSON: data.options });
  const verified = await api.post('/passkeys/login/verify', {
    response, challengeId: data.challengeId,
  });
  const id = (verified.data as { passkeyId?: string }).passkeyId;
  if (id) mark(id);
};

/**
 * Sign in. Nothing typed first — the device offers whatever accounts it
 * holds for this site and the person picks one.
 */
export const signInWithPasskey = async (): Promise<{ token: string; user: AuthUser }> => {
  const { data } = await api.post('/passkeys/login/options', {});
  const response = await startAuthentication({ optionsJSON: data.options });
  const verified = await api.post('/passkeys/login/verify', {
    response, challengeId: data.challengeId,
  });
  const out = verified.data as { token: string; user: AuthUser; passkeyId?: string };
  if (out.passkeyId) mark(out.passkeyId);
  return out;
};

/**
 * What a failed attempt should say.
 *
 * The browser's own errors are not for reading: cancelling the Face ID
 * sheet throws "NotAllowedError: The operation either timed out or was
 * not allowed", which is neither true nor useful. Cancelling is the
 * common case and deserves silence.
 */
export const readPasskeyError = (err: unknown): string | null => {
  const e = err as { name?: string; message?: string; response?: { data?: { error?: string } } };
  const fromServer = e?.response?.data?.error;
  if (fromServer) return fromServer;
  if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') return null;
  // Handled where it happens — the row offers to adopt the key instead.
  if (e?.name === 'InvalidStateError') return 'ALREADY_REGISTERED';
  return e?.message || 'That did not work.';
};
