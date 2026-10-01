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
 * Everything subscribing needs, fetched before anybody taps anything.
 *
 * Apple's requirement, in their own words: "When the user completes the
 * gesture, call the push subscription method immediately from the
 * gesture's event handler code." Safari means it. The permission a tap
 * grants is spent by the first await that yields to the network, and
 * subscribe() called after that is refused — on iOS only. Chrome does not
 * enforce it, which is why this passed every test on a laptop and left the
 * phone unregistered with nothing on screen to say so.
 *
 * So the server key and the worker are collected on page load, and the
 * handler does nothing before subscribe() but read this variable.
 */
let ready: { reg: ServiceWorkerRegistration; key: ArrayBuffer } | null = null;

export const prepare = async (): Promise<void> => {
  if (ready || !supported()) return;
  // Nobody is logged in yet. This matters more than it looks: a 401 makes
  // the api client clear the session and reload the page, so asking for the
  // key from the login screen reloads it, which asks again — the login page
  // reloading forever. Called again from the settings card once there is a
  // session.
  if (!localStorage.getItem('onlyfunds_token')) return;
  try {
    const reg = (await navigator.serviceWorker.getRegistration('/')) || (await registerWorker());
    if (!reg) return;
    await navigator.serviceWorker.ready;
    const { data } = await api.get<{ key: string }>('/push/key');
    ready = { reg, key: toBytes(data.key) };
  } catch (err) {
    console.error('[push] could not prepare:', err);
  }
};

/**
 * Register this device. Must be called straight from a tap handler.
 *
 * subscribe() raises the permission prompt itself, so there is no separate
 * requestPermission() call to spend the gesture on. Every check before it
 * is synchronous for the same reason.
 */
export const enablePush = async (): Promise<PushState> => {
  if (!supported()) return isIOS() && !isInstalled() ? 'needs-install' : 'unsupported';
  if (isIOS() && !isInstalled()) return 'needs-install';
  if (Notification.permission === 'denied') return 'denied';

  const opts: PushSubscriptionOptionsInit = {
    // Required by every current browser: a push this server cannot be
    // identified as the sender of is not accepted.
    userVisibleOnly: true,
    applicationServerKey: ready?.key,
  };

  let sub: PushSubscription;
  try {
    if (ready) {
      // The gesture is still good here — nothing has awaited yet.
      sub = await ready.reg.pushManager.subscribe(opts);
    } else {
      // Page only just opened and the key has not arrived. Slower, and on
      // iOS it may be refused for the reason above — but refusing to try
      // is certainly worse, and the second tap will have it ready.
      await prepare();
      const late = ready as { reg: ServiceWorkerRegistration; key: ArrayBuffer } | null;
      if (!late) return 'off';
      sub = await late.reg.pushManager.subscribe({ ...opts, applicationServerKey: late.key });
    }
  } catch (err) {
    // NotAllowedError is the refusal above, and is also what a declined
    // prompt throws. Distinguishable only by the permission left behind,
    // which the prompt may have changed since the check at the top.
    console.error('[push] subscribe failed:', err);
    if ((Notification.permission as string) === 'denied') return 'denied';
    throw err;
  }

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

export interface PushDevice {
  id: string;
  label: string | null;
  createdAt: string;
  lastOkAt: string | null;
}

export const listDevices = async (): Promise<PushDevice[]> => {
  const { data } = await api.get<{ devices: PushDevice[] }>('/push/devices');
  return data.devices;
};

export interface TestResult {
  sent: number;
  failures: { label: string; status: number | null; detail: string }[];
}

/**
 * Everything about this device that decides whether a push can arrive, on
 * one line.
 *
 * Three rounds of this were spent guessing at a phone nobody debugging it
 * could see, with each of "never installed", "never subscribed" and
 * "subscribed but refused" looking identical from the outside. This is
 * meant to be photographed and read.
 */
export const diagnostics = async (): Promise<string> => {
  const bits: string[] = [];
  bits.push(isIOS() ? 'iOS' : /Android/.test(navigator.userAgent) ? 'Android' : 'desktop');
  bits.push(`installed:${isInstalled() ? 'yes' : 'NO'}`);
  bits.push(`push-api:${'PushManager' in window ? 'yes' : 'NO'}`);
  bits.push(`permission:${'Notification' in window ? Notification.permission : 'n/a'}`);
  try {
    const reg = await navigator.serviceWorker?.getRegistration('/');
    bits.push(`worker:${reg?.active ? 'active' : reg ? 'registered' : 'NONE'}`);
    bits.push(`subscribed:${(await reg?.pushManager.getSubscription()) ? 'yes' : 'NO'}`);
  } catch {
    bits.push('worker:ERROR');
  }
  bits.push(`badge-api:${'setAppBadge' in navigator ? 'yes' : 'no'}`);
  bits.push(`key-ready:${ready ? 'yes' : 'NO'}`);
  return bits.join(' · ');
};

export const sendTestPush = async (): Promise<TestResult> => {
  const { data } = await api.post<TestResult>('/push/test', {});
  return data;
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
