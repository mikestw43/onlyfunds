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

/* ── The badge ───────────────────────────────────────────────────────────
   The count is simply how many of our notifications are still sitting in
   the tray unread. Nothing is stored and nothing can drift: dismiss two
   alerts by hand and the next push sets the badge to what is actually
   left.

   It used to be a counter in IndexedDB, incremented before the
   notification was shown. That was wrong twice over. A database open that
   is blocked never settles — not a rejection a catch can take, a promise
   that never ends — and it sat in front of showNotification, so on a
   platform where it stalled, the push produced no notification at all and
   Safari revokes the subscription of a worker that does that. The counter
   also had no way to learn that notifications had been swiped away.

   setAppBadge is not everywhere: iOS has it for a web app on the Home
   Screen from 16.4, desktop Chrome and Edge for an installed app. Chrome
   on Android does not — there Android puts its own dot on the icon
   because a notification is unread, the same signal without the number.
   Always attempted, never depended on. */
const applyBadge = async (count) => {
  try {
    if (count > 0 && self.navigator.setAppBadge) await self.navigator.setAppBadge(count);
    else if (self.navigator.clearAppBadge) await self.navigator.clearAppBadge();
  } catch (err) {
    // A platform that does not support it is the normal case, not a fault.
  }
};

/** Set the icon to however many of our notifications are still unread. */
const badgeFromTray = async () => {
  try {
    const open = await self.registration.getNotifications();
    await applyBadge(open.length);
  } catch (err) {
    // Never allowed to matter: the notification itself is already shown.
  }
};

/**
 * The app was opened, so everything waiting has been seen.
 *
 * The tray is cleared along with the number, because the number is read
 * back from the tray — leaving them would mean the next single alert
 * arrived showing yesterday's total.
 */
const resetBadge = async () => {
  await applyBadge(0);
  try {
    const open = await self.registration.getNotifications();
    for (const n of open) n.close();
  } catch (err) {
    // Nothing to clean up, or not allowed to. Either is fine.
  }
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
    // Shown first, before anything that could stall or throw. A worker
    // that accepts a push and shows nothing has its subscription revoked,
    // and the badge is never worth risking that.
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
    await badgeFromTray();
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
