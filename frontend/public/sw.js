/*
 * OnlyFunds service worker — notifications only.
 *
 * This deliberately does NOT cache anything and has no fetch handler. The
 * dashboard deploys itself every five minutes from main, and a worker that
 * served assets from a cache would hand people yesterday's build until they
 * cleared their browser. Its whole job is to be awake when the phone is
 * not, so a push can arrive.
 *
 * The number on the app icon is counted here rather than by the server,
 * because "how many alerts since I last looked" is a question about this
 * one device, and the server does not know when someone glanced at their
 * phone. The page clears it when it comes to the front.
 */

/* ── Where the count lives ───────────────────────────────────────────────
   A plain variable would not do: the browser stops this worker whenever it
   feels like it, and starts a fresh one for the next push. IndexedDB is the
   only store a worker can reach that survives that. */
const DB_NAME = 'onlyfunds-push';
const STORE = 'state';
const BADGE_KEY = 'badge';

const openDb = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE);
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const readState = async (key) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};

const writeState = async (key, value) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

/* ── The badge ───────────────────────────────────────────────────────────
   setAppBadge is the only way to put a number on the icon, and it is not
   everywhere: iOS has it for a web app on the Home Screen from 16.4, and
   desktop Chrome and Edge have it for an installed app. Chrome on Android
   does not — there, Android puts its own dot on the icon because a
   notification is unread, which is the same signal without the number. So
   this is always attempted and never depended on. */
const applyBadge = async (count) => {
  try {
    if (count > 0 && self.navigator.setAppBadge) await self.navigator.setAppBadge(count);
    else if (self.navigator.clearAppBadge) await self.navigator.clearAppBadge();
  } catch (err) {
    // A platform that does not support it is the normal case, not a fault.
  }
};

const bumpBadge = async () => {
  const next = (Number(await readState(BADGE_KEY).catch(() => 0)) || 0) + 1;
  await writeState(BADGE_KEY, next).catch(() => {});
  await applyBadge(next);
  return next;
};

const resetBadge = async () => {
  await writeState(BADGE_KEY, 0).catch(() => {});
  await applyBadge(0);
};

/* ── Lifecycle ───────────────────────────────────────────────────────────
   Take over straight away. Waiting for every tab to close before a new
   worker starts would mean a fix to this file reaching a phone that is
   never fully closed roughly never. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

/* ── A push arrived ──────────────────────────────────────────────────────
   A notification MUST be shown for every push. A worker that takes a push
   and shows nothing is treated as abusing the channel, and both Apple and
   Chrome will eventually revoke the subscription for it — so even an
   unreadable payload gets a generic notification rather than silence. */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'OnlyFunds';
  const body = data.body || 'New activity on your accounts.';

  event.waitUntil((async () => {
    await bumpBadge().catch(() => {});
    await self.registration.showNotification(title, {
      body,
      icon: '/apple-touch-icon.png',
      // The small monochrome mark Android puts in the status bar.
      badge: '/apple-touch-icon.png',
      // Alerts of the same kind on the same account replace each other
      // rather than stacking into an unreadable pile.
      tag: data.tag || 'onlyfunds',
      renotify: Boolean(data.tag),
      data: { url: data.url || '/' },
      timestamp: Date.now(),
    });
  })());
});

/* ── Tapped ──────────────────────────────────────────────────────────────
   Bring the app the person already has rather than opening a second copy
   of it, which on a phone looks like the app forgetting where they were. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil((async () => {
    await resetBadge();
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if ('focus' in client) {
        if ('navigate' in client && target !== '/') await client.navigate(target).catch(() => {});
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});

/* ── The app came to the front ───────────────────────────────────────────
   Sent by the page whenever it becomes visible. Looking at the dashboard is
   what "read" means here, so the icon goes back to clean. */
self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'clear-badge') return;
  event.waitUntil(resetBadge());
});
