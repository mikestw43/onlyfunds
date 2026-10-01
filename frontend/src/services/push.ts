import api from './api';

/**
 * Turning phone notifications on, and the number on the app icon with them.
 *
 * Three things have to line up before a push can arrive, and each fails in
 * its own way, so this reports which one is missing rather than a single
 * "not supported": the browser has to speak Push at all, the page has to be
 * running as an installed app (on iOS only — Safari refuses to subscribe a
 * site opened in a tab), and the person has to say yes.
 */

export type PushState =
  | 'unsupported'      // this browser has no Push API
  | 'needs-install'    // iOS, and not added to the Home Screen yet
  | 'denied'           // asked before and refused; only settings can undo it
  | 'off'              // available, not switched on
  | 'on';              // subscribed on this device

/** Standalone = launched from the Home Screen rather than inside Safari. */
export const isInstalled = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches ||
  // iOS predates display-mode and uses its own flag.
  (navigator as unknown as { standalone?: boolean }).standalone === true;

export const isIOS = (): boolean =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  // iPadOS reports itself as a Mac; a touch screen is what gives it away.
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const supported = (): boolean =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** Register the worker. Safe to call repeatedly — the browser dedupes it. */
export const registerWorker = async (): Promise<ServiceWorkerRegistration | null> => {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch (err) {
    console.error('[push] service worker registration failed:', err);
    return null;
  }
};

export const getState = async (): Promise<PushState> => {
  if (!supported()) return isIOS() && !isInstalled() ? 'needs-install' : 'unsupported';
  // Safari exposes PushManager inside a tab but refuses to subscribe there,
  // so the install step has to be checked before the permission.
  if (isIOS() && !isInstalled()) return 'needs-install';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (sub) return 'on';
  return 'off';
};

/** The server's public key arrives base64url; PushManager wants bytes. */
const toBytes = (base64url: string): ArrayBuffer => {
  const padded = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const buf = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return buf;
};

/** Something recognisable in the settings list — "iPhone", not a URL. */
const deviceLabel = (): string => {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Browser';
};

/**
 * Ask for permission and register this device.
 *
 * The permission prompt only appears in response to a tap — called on page
 * load the browser refuses it outright and, on some, counts it as a refusal
 * that cannot be asked again. So this is only ever wired to a button.
 */
export const enablePush = async (): Promise<PushState> => {
  const state = await getState();
  if (state === 'needs-install' || state === 'unsupported' || state === 'denied') return state;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';

  const reg = (await navigator.serviceWorker.getRegistration('/')) || (await registerWorker());
  if (!reg) return 'off';
  await navigator.serviceWorker.ready;

  const { data } = await api.get<{ key: string }>('/push/key');
  const sub = await reg.pushManager.subscribe({
    // Required by every current browser: a push this server cannot be
    // identified as the sender of is not accepted.
    userVisibleOnly: true,
    applicationServerKey: toBytes(data.key),
  });

  const json = sub.toJSON();
  await api.post('/push/subscribe', {
    endpoint: sub.endpoint,
    keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
    label: deviceLabel(),
  });
  return 'on';
};

/** Stop this device receiving. Permission stays granted, so it can come back. */
export const disablePush = async (): Promise<PushState> => {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return 'off';
};

export const sendTestPush = async (): Promise<number> => {
  const { data } = await api.post<{ sent: number }>('/push/test', {});
  return data.sent;
};

/**
 * Clear the icon badge whenever the app is actually being looked at.
 *
 * Both halves are needed: the page can clear its own badge, but only the
 * worker holds the count, so it has to be told as well or the next push
 * would carry on from where it left off.
 */
export const watchForeground = (): (() => void) => {
  const clear = () => {
    if (document.visibilityState !== 'visible') return;
    navigator.clearAppBadge?.().catch(() => {});
    navigator.serviceWorker?.controller?.postMessage({ type: 'clear-badge' });
  };
  clear();
  document.addEventListener('visibilitychange', clear);
  return () => document.removeEventListener('visibilitychange', clear);
};
