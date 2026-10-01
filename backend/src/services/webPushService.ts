import webpush from 'web-push';
import prisma from '../lib/prisma';

/**
 * Push notifications to a phone's own notification tray, and the number on
 * the app icon that comes with them.
 *
 * Telegram was the only way an alert ever left the server, and it only
 * worked for someone who had set up a bot and pasted two secrets into the
 * settings page. This needs none of that: the browser agrees to receive
 * alerts, hands us an address, and we post to it.
 *
 * The address belongs to Apple or Google's push service, not to us, and the
 * message is encrypted to keys the browser generated — the relay carries it
 * without being able to read it. That is what the VAPID pair below is for:
 * it identifies this server to the push service as the sender the browser
 * agreed to hear from.
 */

/** Where the keypair lives. Generated once, then never again. */
const PUB = 'push_vapid_public';
const PRIV = 'push_vapid_private';
/** Mailto the push service can complain to, per the VAPID spec. */
const SUBJECT = process.env.PUSH_CONTACT || 'mailto:admin@onlyfunds.local';

let keys: { publicKey: string; privateKey: string } | null = null;
let loading: Promise<{ publicKey: string; privateKey: string }> | null = null;

/**
 * The server's own identity to the push services.
 *
 * Deliberately not an environment variable: the pair only has to be stable
 * and secret, never typed by a person, and asking the owner of this
 * dashboard to SSH in and paste two base64 strings into a file is how a
 * feature ends up switched off forever. It is generated on first use and
 * read from the database after that.
 *
 * Changing it invalidates every subscription in the table, so it is written
 * once and never rotated here.
 */
const loadKeys = async (): Promise<{ publicKey: string; privateKey: string }> => {
  if (keys) return keys;
  if (loading) return loading;
  loading = (async () => {
    const [pub, priv] = await Promise.all([
      prisma.appSetting.findUnique({ where: { key: PUB } }),
      prisma.appSetting.findUnique({ where: { key: PRIV } }),
    ]);
    if (pub?.value && priv?.value) {
      keys = { publicKey: pub.value, privateKey: priv.value };
    } else {
      const fresh = webpush.generateVAPIDKeys();
      await prisma.appSetting.upsert({
        where: { key: PUB },
        update: { value: fresh.publicKey, updatedBy: 'system' },
        create: { key: PUB, value: fresh.publicKey, updatedBy: 'system' },
      });
      await prisma.appSetting.upsert({
        where: { key: PRIV },
        update: { value: fresh.privateKey, updatedBy: 'system' },
        create: { key: PRIV, value: fresh.privateKey, updatedBy: 'system' },
      });
      keys = fresh;
    }
    webpush.setVapidDetails(SUBJECT, keys.publicKey, keys.privateKey);
    return keys;
  })();
  try {
    return await loading;
  } finally {
    loading = null;
  }
};

/** The half of the pair a browser needs to subscribe. Safe to hand out. */
export const publicKey = async (): Promise<string> => (await loadKeys()).publicKey;

export interface PushPayload {
  title: string;
  body: string;
  /** Where tapping it should land. Defaults to the dashboard. */
  url?: string;
  /** Alerts sharing a tag replace each other rather than stacking up. */
  tag?: string;
}

/**
 * Send to every device a person has registered.
 *
 * Never throws and never blocks the caller's own work: an alert that could
 * not be delivered to a phone must not stop the same alert reaching
 * Telegram, or stop the trade loop that raised it.
 *
 * A push service answering 404 or 410 is telling us that subscription is
 * dead — the browser was uninstalled, or cleared its site data. That row is
 * removed, because otherwise it is retried for every alert forever.
 */
export const sendPushToUser = async (userId: string, payload: PushPayload): Promise<number> => {
  let devices;
  try {
    await loadKeys();
    devices = await prisma.pushDevice.findMany({ where: { userId } });
  } catch (err) {
    console.error('[push] could not load devices:', err);
    return 0;
  }
  if (devices.length === 0) return 0;

  const body = JSON.stringify(payload);
  let sent = 0;

  await Promise.all(devices.map(async d => {
    try {
      await webpush.sendNotification(
        { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
        body,
        // Apple drops a push with no urgency hint on some builds, and a
        // trading alert is worth waking the screen for.
        { TTL: 3600, urgency: 'high' },
      );
      sent++;
      await prisma.pushDevice.update({ where: { id: d.id }, data: { lastOkAt: new Date() } })
        .catch(() => { /* the count is not worth failing a delivery over */ });
    } catch (err: unknown) {
      const code = (err as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) {
        await prisma.pushDevice.delete({ where: { id: d.id } }).catch(() => {});
        console.log(`[push] dropped a dead subscription for user ${userId}`);
      } else {
        console.error(`[push] send failed (${code ?? 'no status'}):`, (err as Error)?.message);
      }
    }
  }));

  return sent;
};

/** True when this person has at least one device listening. */
export const hasDevices = async (userId: string): Promise<boolean> =>
  (await prisma.pushDevice.count({ where: { userId } })) > 0;
