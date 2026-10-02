# Web Push + app-icon badge that actually works on iPhone

A complete, working recipe for a PWA that shows a notification on a locked
iPhone **and** puts a number on the Home Screen icon — plus Android and
desktop. Written after getting it wrong seven times in production; every
section marked **TRAP** is a real bug that shipped and looked like "push
just doesn't work on iOS".

Stack this was built on: Node + Express + Prisma + the `web-push` package
on the server, React + Vite on the client, served over HTTPS behind nginx.
Nothing here depends on those choices except the `web-push` call itself —
any language with a Web Push library works the same way.

---

## 1. What is actually possible, per platform

| Platform | Notification | Number on the icon (Badging API) |
|---|---|---|
| iOS/iPadOS 16.4+ **installed to the Home Screen** | yes | **yes** |
| iOS in a Safari tab | **no** — `subscribe()` is refused | no |
| Android Chrome | yes | **no API** — Android draws its own dot because a notification is unread |
| Desktop Chrome/Edge, **installed** app | yes | yes |
| Desktop Chrome/Edge in a tab | yes | usually no |
| Desktop Safari (macOS 13+) | yes | no |

Consequences for the UI:

- On iOS you must detect "not installed yet" and show *Add to Home Screen*
  instructions instead of a dead toggle.
- Never advertise the badge number as a feature on Android — the dot is the
  equivalent and you do not control it.
- `navigator.setAppBadge` must always be wrapped in try/catch. A platform
  without it is the normal case, not an error.

---

## 2. The three pieces

```
  server  ──(1) VAPID public key ─────────────▶  page
  page    ──(2) subscribe() ──▶ Apple/Google push service ──▶ {endpoint, keys}
  page    ──(3) POST that subscription ───────▶  server (stores a row)

  later:
  server  ──(4) encrypted payload to endpoint ─▶ push service ─▶ device
                                                   ▼
                                           service worker 'push' event
                                           showNotification()  + setAppBadge()
```

The endpoint belongs to Apple or Google. The payload is encrypted to keys
the browser generated, so the relay cannot read it. VAPID is how your
server proves it is the sender the browser agreed to hear from.

---

## 3. Prerequisites that are not optional

1. **HTTPS with a real certificate.** `localhost` is exempt for testing,
   nothing else is.
2. **A web app manifest** with `"display": "standalone"`, a `start_url`, a
   `scope`, and at least one 180×180 PNG icon. iOS will not treat the page
   as an installable app without it.
3. **A service worker at the scope root** (`/sw.js` with `scope: '/'`).
4. **iOS: the user must Add to Home Screen and open it from there.** Safari
   exposes `window.PushManager` inside a tab and then refuses to subscribe.

Manifest that works (iOS is fussy about the maskable entry):

```json
{
  "name": "My App",
  "short_name": "MyApp",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#212327",
  "theme_color": "#212327",
  "icons": [
    { "src": "/icon.svg",            "sizes": "any",     "type": "image/svg+xml", "purpose": "any" },
    { "src": "/apple-touch-icon.png","sizes": "180x180", "type": "image/png",     "purpose": "any" },
    { "src": "/apple-touch-icon.png","sizes": "180x180", "type": "image/png",     "purpose": "maskable" }
  ]
}
```

In `index.html`:

```html
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="theme-color" content="#212327" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-title" content="MyApp" />
<meta name="mobile-web-app-capable" content="yes" />
```

---

## 4. Server

### 4.1 VAPID keys — generate once, store in the database

```ts
import webpush from 'web-push';

// Generated on first use and kept in a settings table, NOT in an env var.
// Rationale: the pair only has to be stable and secret, never typed by a
// human. Asking the operator to SSH in and paste two base64 strings is how
// a feature ends up permanently switched off. Changing the pair
// invalidates every stored subscription, so it is written once and never
// rotated.
const loadKeys = async () => {
  const [pub, priv] = await Promise.all([
    db.setting.get('push_vapid_public'),
    db.setting.get('push_vapid_private'),
  ]);
  if (pub && priv) return { publicKey: pub, privateKey: priv };
  const fresh = webpush.generateVAPIDKeys();
  await db.setting.set('push_vapid_public', fresh.publicKey);
  await db.setting.set('push_vapid_private', fresh.privateKey);
  return fresh;
};
```

### 4.2 The VAPID subject — **TRAP #1, the iOS killer**

```ts
// RFC 8292 requires the "sub" claim to be a mailto: or https: URI, and
// Apple ENFORCES it: anything pointing at a place that cannot exist is
// refused with 403 BadJwtToken and the notification never reaches the
// iPhone. Google does not check — which is the worst possible
// combination, because it works on every desktop and Android device you
// test with and silently fails on exactly one platform.
//
// The first version of this used mailto:admin@myapp.local — and .local is
// reserved (RFC 6762), exactly like localhost and .invalid. Use the site's
// own https URL, which is always real.
const SUBJECT = process.env.PUSH_CONTACT?.match(/^(mailto:|https:\/\/)/)
  ? process.env.PUSH_CONTACT
  : 'https://your-real-domain.example';

webpush.setVapidDetails(SUBJECT, keys.publicKey, keys.privateKey);
```

If iPhone pushes fail, **log the push service's response body**. Apple puts
the reason in it (`BadJwtToken`, `TooManyRequests`, …); the status code
alone tells you nothing.

### 4.3 The subscription table

```prisma
model PushDevice {
  id        String    @id @default(uuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  /// The push service's URL for this browser. UNIQUE: a browser that
  /// re-subscribes gets the same endpoint back and must not pile up rows
  /// that would each deliver the same alert again.
  endpoint  String    @unique
  p256dh    String
  auth      String
  /// What the browser called itself, so settings can say "iPhone" rather
  /// than a 300-character URL.
  label     String?
  createdAt DateTime  @default(now())
  /// Last time the push service accepted a message for this device.
  lastOkAt  DateTime?
  @@index([userId])
}
```

`endpoint` unique + upsert on subscribe is what keeps one device from
becoming five rows and five identical buzzes.

### 4.4 Endpoints

```
GET  /api/push/key          -> { key: <VAPID public key, base64url> }
GET  /api/push/devices      -> the caller's registered devices (for a settings list)
POST /api/push/subscribe    { endpoint, keys: { p256dh, auth }, label }  (upsert on endpoint)
POST /api/push/unsubscribe  { endpoint }
POST /api/push/test         -> sends one push to the caller and REPORTS PER-DEVICE RESULTS
```

The test endpoint must return what happened per device, not `{ ok: true }`.
"It worked on my laptop" is the single most misleading signal in this
whole feature.

### 4.5 Sending

```ts
export const sendPushToUser = async (userId, payload) => {
  const devices = await db.pushDevice.findMany({ where: { userId } });
  const body = JSON.stringify(payload);   // { title, body, url, tag }
  let sent = 0;
  const failures = [];

  await Promise.all(devices.map(async d => {
    try {
      await webpush.sendNotification(
        { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
        body,
        // Apple drops a push with no urgency hint on some builds.
        { TTL: 3600, urgency: 'high' },
      );
      sent++;
      await db.pushDevice.update({ where: { id: d.id }, data: { lastOkAt: new Date() } });
    } catch (err) {
      const code = err?.statusCode ?? null;
      if (code === 404 || code === 410) {
        // The subscription is dead — uninstalled, or site data cleared.
        // Delete the row or it is retried for every alert forever.
        await db.pushDevice.delete({ where: { id: d.id } });
        failures.push({ label: d.label, status: code, detail: 'subscription expired' });
      } else {
        // The service's own body says far more than the status.
        failures.push({ label: d.label, status: code, detail: (err?.body || err?.message || '').slice(0, 200) });
      }
    }
  }));

  return { sent, failures };
};
```

Rules this encodes:

- **Never throw.** A push that cannot be delivered must not stop the
  business logic that raised it.
- **404/410 → delete the row.** Everything else → report it.
- **Report per device.** One device failing while another succeeds is the
  failure mode that hides for weeks.

Payload kept small (< 3 KB after encryption) and flat:

```json
{ "title": "DRAWDOWN ALERT · Gold Scalper", "body": "drawdown 80.3% · equity $1,071,839", "url": "/", "tag": "drawdown:acct-123" }
```

---

## 5. The service worker

Complete, working file. Read the comments — each one is a bug that got
fixed.

```js
/* No caching, no fetch handler. A worker that serves assets from a cache
   will hand people yesterday's build until they clear their browser. Its
   only job is to be awake when the phone is not. */

const applyBadge = async (count) => {
  try {
    if (count > 0 && self.navigator.setAppBadge) await self.navigator.setAppBadge(count);
    else if (self.navigator.clearAppBadge) await self.navigator.clearAppBadge();
  } catch (err) { /* unsupported is the normal case, not a fault */ }
};

/* Where the count lives between pushes. The browser kills the worker
   whenever it likes and starts a fresh one for the next push, so a plain
   variable will not survive. The Cache API is the simplest persistent
   store a worker can reach: one get, one put, no transactions, and
   nothing another tab can block — which is what made the first attempt
   (IndexedDB) able to hang forever. */
const STORE = 'app-badge';
const COUNT_URL = '/__badge-count';

/* NOTHING may hang the push handler. Worst case must be a wrong number,
   never a push that does not finish. */
const guard = (promise, fallback) => Promise.race([
  promise.catch(() => fallback),
  new Promise(resolve => setTimeout(() => resolve(fallback), 2000)),
]);

const readCount = () => guard((async () => {
  const cache = await caches.open(STORE);
  const hit = await cache.match(COUNT_URL);
  return hit ? Number(await hit.text()) || 0 : 0;
})(), 0);

const writeCount = (n) => guard((async () => {
  const cache = await caches.open(STORE);
  await cache.put(COUNT_URL, new Response(String(n)));
})(), undefined);

/* Two sources, because neither can be trusted alone. The tray is the
   better answer when it gives one — it drops on its own when the user
   swipes alerts away, and alerts sharing a tag replace rather than stack.
   But getNotifications() is not guaranteed to have caught up with the
   notification just shown, and a worker that believes an empty list will
   clear the badge in the same breath as setting it, which looks exactly
   like a badge that never worked. So the stored counter always advances
   and the tray only overrides it when it reports something. */
const bumpBadge = async () => {
  const next = (await readCount()) + 1;
  await writeCount(next);
  const tray = await guard(self.registration.getNotifications(), []);
  await applyBadge(tray.length > 0 ? tray.length : next);
};

const resetBadge = async () => {
  await writeCount(0);
  await applyBadge(0);
  // Empty the tray too: the count prefers the tray, so leaving yesterday's
  // notifications there makes the next single alert show the old total.
  const tray = await guard(self.registration.getNotifications(), []);
  for (const n of tray) { try { n.close(); } catch (e) {} }
};

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (err) { data = { body: event.data ? event.data.text() : '' }; }

  // iOS prints the web app's own name above the title, so a title of
  // "MyApp" renders as "MyApp from MyApp".
  const title = data.title || 'Alert';
  const body  = data.body  || 'New activity.';

  event.waitUntil((async () => {
    // SHOWN FIRST, before anything that could stall or throw.
    await self.registration.showNotification(title, {
      body,
      icon: '/apple-touch-icon.png',
      badge: '/apple-touch-icon.png',   // Android's monochrome status-bar mark
      tag: data.tag || 'app',           // same tag replaces instead of stacking
      renotify: Boolean(data.tag),
      data: { url: data.url || '/' },
      timestamp: Date.now(),
    });
    await bumpBadge();
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    await resetBadge();
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if ('focus' in client) {
        if ('navigate' in client && target !== '/') await client.navigate(target).catch(() => {});
        return client.focus();   // bring the existing window, don't open a second copy
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});

// Sent by the page when it becomes visible.
self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'clear-badge') return;
  event.waitUntil(resetBadge());
});
```

---

## 6. The client

### 6.1 State, so the UI can say which thing is missing

```ts
export type PushState =
  | 'unsupported'    // no Push API in this browser
  | 'needs-install'  // iOS, not added to the Home Screen yet
  | 'denied'         // refused before; only OS settings can undo it
  | 'off'            // available, not switched on
  | 'on';

export const isInstalled = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  navigator.standalone === true;          // iOS predates display-mode

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);  // iPadOS lies

const supported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export const getState = async (): Promise<PushState> => {
  if (!supported()) return isIOS() && !isInstalled() ? 'needs-install' : 'unsupported';
  // Safari exposes PushManager in a tab and then refuses to subscribe, so
  // the install check must come BEFORE the permission check.
  if (isIOS() && !isInstalled()) return 'needs-install';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/');
  return (await reg?.pushManager.getSubscription()) ? 'on' : 'off';
};
```

### 6.2 **TRAP #2: the gesture is spent by the first await**

Apple's words: *"When the user completes the gesture, call the push
subscription method immediately from the gesture's event handler code."*
Safari means it. Any `await` that yields to the network before
`subscribe()` invalidates the user gesture and the call is refused — **on
iOS only**. Chrome does not enforce it, which is why it passes every
laptop test and leaves the phone unregistered with nothing on screen.

So collect everything in advance, at page load:

```ts
let ready: { reg: ServiceWorkerRegistration; key: ArrayBuffer } | null = null;

export const prepare = async () => {
  if (ready || !supported()) return;
  // TRAP #3: do not call this before login. A 401 that makes your API
  // client clear the session and reload the page turns "fetch the key on
  // mount" into an infinite login-page reload loop.
  if (!localStorage.getItem('auth_token')) return;
  const reg = (await navigator.serviceWorker.getRegistration('/')) || (await registerWorker());
  if (!reg) return;
  await navigator.serviceWorker.ready;
  const { data } = await api.get('/push/key');
  ready = { reg, key: toBytes(data.key) };   // base64url -> ArrayBuffer
};

// Called straight from onClick. NOTHING awaits before subscribe().
export const enablePush = async (): Promise<PushState> => {
  if (!supported()) return isIOS() && !isInstalled() ? 'needs-install' : 'unsupported';
  if (isIOS() && !isInstalled()) return 'needs-install';
  if (Notification.permission === 'denied') return 'denied';

  // subscribe() raises the permission prompt itself — there is no separate
  // requestPermission() to spend the gesture on.
  const sub = await ready.reg.pushManager.subscribe({
    userVisibleOnly: true,               // required everywhere
    applicationServerKey: ready.key,
  });
  await register(sub);                   // POST to /push/subscribe
  return 'on';
};
```

`toBytes` (the server sends base64url, `PushManager` wants bytes):

```ts
const toBytes = (b64url: string): ArrayBuffer => {
  const padded = (b64url + '='.repeat((4 - (b64url.length % 4)) % 4))
    .replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
};
```

### 6.3 **TRAP #4: browser and server drift apart**

The browser keeps a subscription until something explicitly unsubscribes
it. The server row can vanish independently: the registering POST failed
after `subscribe()` succeeded, a half-finished "turn off" deleted the row,
a 410 pruned it. In all of those `getSubscription()` still returns a
subscription, so the UI says **ON** and offers to turn it **off**, while
the server has no address to send to. **There is no sequence of taps the
user can perform that fixes this.**

Fix: re-register whatever the browser holds every time the settings screen
opens. The endpoint is the key, so it is an update for a known device and a
repair for an unknown one.

```ts
export const syncSubscription = async () => {
  if (!supported() || !localStorage.getItem('auth_token')) return;
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (sub) await register(sub);
};
```

Turning off: **unsubscribe in the browser first, then delete the row.** The
other order leaves exactly the split above if the second call fails.

### 6.4 Clearing the badge when the app is looked at

```ts
export const watchForeground = () => {
  const clear = () => {
    if (document.visibilityState !== 'visible') return;
    navigator.clearAppBadge?.().catch(() => {});
    // Both halves are needed: the page can clear its own badge, but only
    // the worker holds the count, so it must be told or the next push
    // carries on from the old total.
    navigator.serviceWorker?.controller?.postMessage({ type: 'clear-badge' });
  };
  clear();
  document.addEventListener('visibilitychange', clear);
  return () => document.removeEventListener('visibilitychange', clear);
};
```

### 6.5 A diagnostics line is worth a day of guessing

Put this in the settings card, selectable text:

```
iOS · installed:yes · push-api:yes · permission:granted · worker:active ·
subscribed:yes · server-knows:yes · badge-api:yes · key-ready:yes
```

Built from: `isIOS()`, `isInstalled()`, `'PushManager' in window`,
`Notification.permission`, `reg.active`, `getSubscription()`, whether the
last `/push/subscribe` succeeded, `'setAppBadge' in navigator`, whether the
key was pre-fetched. When a user says "it doesn't work", one screenshot of
that line names the broken piece.

---

## 7. Every trap, in one list

1. **VAPID `sub` must be a reachable `mailto:` or `https:` URI.** Apple
   rejects anything else with 403; Google ignores it. `.local`, `.invalid`,
   `localhost` are reserved and will fail.
2. **Call `subscribe()` with nothing awaited before it** inside the tap
   handler. Pre-fetch the key and the registration at page load. iOS only.
3. **Do not fetch the VAPID key before login** if a 401 triggers a session
   reset + reload → infinite reload loop on the login page.
4. **Browser subscription and server row drift.** Re-register on every
   settings-screen open; unsubscribe locally *before* deleting the row.
5. **A worker that takes a push and shows no notification gets the
   subscription revoked** by Apple and Chrome. Always `showNotification()`,
   even for an unreadable payload, and show it *before* any badge work.
6. **Never count the badge in anything that can hang.** IndexedDB can block
   forever if another tab holds it; a blocked open means no notification,
   which means revocation (see 5). Use the Cache API and a 2-second
   `Promise.race` guard.
7. **`getNotifications()` can return an empty list for a notification you
   just showed**, so a tray-only badge clears itself in the same breath as
   setting it. Keep your own counter and let the tray override it only when
   it reports something.
8. **iOS prints the app name above the title**, so a title of "MyApp"
   reads "MyApp from MyApp". Put the real headline in the title.
9. **iOS Focus modes (Sleep especially) silence notifications and hide
   badges.** Before debugging for a day, check the status bar for the
   crescent/bed icon. This cost us the longest single stretch of the whole
   feature, and it was visible in the user's very first screenshot.
10. **Do not compare a server timestamp against the browser's
    `Date.now()`** to decide what is unread — different clocks. Track ids,
    or compute the unread count server-side.
11. **A headless browser has no notification permission**, so automated
    tests cannot cover the real path. Test on a real device, and make the
    test endpoint report per-device results so the device can report for
    itself.

---

## 8. Acceptance checklist

On a real iPhone, installed to the Home Screen:

- [ ] Turn notifications on → iOS prompt appears → allow.
- [ ] Server has a row for the device (settings list shows "iPhone").
- [ ] Send a test push with the app **closed** → banner appears on the lock
      screen → **a number appears on the Home Screen icon**.
- [ ] Second push → the number becomes 2 (or the tray count).
- [ ] Open the app → the number disappears, the tray clears.
- [ ] Tap a notification → the existing window is focused, not a second copy.
- [ ] Turn off → the row is gone and no further push arrives.
- [ ] Reinstall the app (removes the subscription) → the server gets 410 on
      the next send and drops the row by itself.
- [ ] Check Focus mode is OFF before declaring any of the above broken.

On Android Chrome: notification yes, no number — the system dot is correct
behaviour, not a bug.

---

## 9. Payload and tag conventions that paid off

- `tag: "<kind>:<subject-id>"` — e.g. `drawdown:acct-123`. Repeats of the
  same alert replace each other instead of burying the tray.
- `renotify: true` whenever a tag is set, so a replacement still buzzes.
- Title = headline + subject (`"DRAWDOWN ALERT · Gold Scalper"`), body =
  the figures. Two lines is all a phone shows.
- Strip any HTML before it reaches the payload: a notification tray renders
  `<b>` literally.
