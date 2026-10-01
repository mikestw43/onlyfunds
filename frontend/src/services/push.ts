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

/**
 * Has the server been told about the subscription this browser holds?
 *
 * null until it has been checked this session.
 */
let synced: boolean | null = null;

/** Hand a subscription to the server. Keyed on the endpoint, so repeating
 *  it is an update, never a second device. */
const register = async (sub: PushSubscription): Promise<void> => {
  const json = sub.toJSON();
  await api.post('/push/subscribe', {
    endpoint: sub.endpoint,
    keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
    label: deviceLabel(),
  });
  synced = true;
};

/**
 * Make sure the server knows about whatever this browser is holding.
 *
 * These two can come apart, and when they do nothing notices. The browser
 * keeps a push subscription until something explicitly unsubscribes it,
 * while the server row can be missing for any number of reasons — the
 * registering request failed after subscribe() succeeded, a half-finished
 * "turn off" deleted the row but left the browser's subscription, a push
 * service once answered 410 and the row was pruned. In every case
 * getSubscription() still returns a subscription, so the card says ON FOR
 * THIS DEVICE and the button offers to turn it off, while the server has
 * no address to send to. It is a device that reports itself working and
 * can never receive anything, and there is no sequence of taps that fixes
 * it.
 *
 * So the browser's subscription is re-registered on every visit to the
 * settings card. The endpoint is the key, so this is an update for a
 * device the server already knew and a repair for one it did not.
 */
export const syncSubscription = async (): Promise<void> => {
  if (!supported() || !localStorage.getItem('onlyfunds_token')) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) { synced = false; return; }
    await register(sub);
  } catch (err) {
    synced = false;
    console.error('[push] could not sync the subscription:', err);
  }
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

  await register(sub);
  return 'on';
};

/** Stop this device receiving. Permission stays granted, so it can come back. */
export const disablePush = async (): Promise<PushState> => {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    // The browser's copy goes first. If the order were the other way and
    // this failed, the row would be gone while the subscription stayed —
    // which is the exact split that left a phone reporting itself on and
    // receiving nothing.
    await sub.unsubscribe().catch(() => {});
    await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  }
  synced = false;
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
  bits.push(`server-knows:${synced === null ? '?' : synced ? 'yes' : 'NO'}`);
  bits.push(`badge-api:${'setAppBadge' in navigator ? 'yes' : 'no'}`);
  bits.push(`key-ready:${ready ? 'yes' : 'NO'}`);
  return bits.join(' · ');
};

/**
 * Raise a notification on this device without any push at all.
 *
 * This splits the chain in half, which nothing else here can do. A push
 * that APNs accepts and the phone never shows could be failing at
 * delivery, at decryption, in the worker, or at iOS deciding not to
 * display it — and from the home screen those are one symptom. This
 * exercises only the last part. If this appears and a pushed one does
 * not, the fault is in getting it to the phone; if neither appears, the
 * phone is choosing not to show them and no amount of work on the server
 * will change that.
 */
export const showLocalNotification = async (): Promise<void> => {
  const reg = await navigator.serviceWorker.getRegistration('/');
  if (!reg) throw new Error('No service worker is registered on this device.');
  // Not "OnlyFunds": iOS prints the app's own name above the title.
  await reg.showNotification('Local test', {
    body: 'This one never left the phone.',
    icon: '/apple-touch-icon.png',
    badge: '/apple-touch-icon.png',
    tag: 'local-test',
  });
  // And the icon, by the same split: set from the page rather than from a
  // push, so a badge that never moves can be told from a push that never
  // arrives.
  try {
    await navigator.setAppBadge?.(1);
  } catch {
    throw new Error('The notification was shown, but this device refused to set a badge.');
  }
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
