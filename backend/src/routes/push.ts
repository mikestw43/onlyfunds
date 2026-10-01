import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import prisma from '../lib/prisma';
import { publicKey, sendPushToUser } from '../services/webPushService';

const router = Router();

router.use(authMiddleware);

/**
 * The key a browser needs before it can subscribe.
 *
 * Public by design — it is how the browser checks that a push claiming to
 * be from this dashboard really is. The private half never leaves the
 * server.
 */
router.get('/key', async (_req: AuthRequest, res: Response) => {
  try {
    res.json({ key: await publicKey() });
  } catch (err) {
    console.error('[push] key unavailable:', err);
    res.status(500).json({ error: 'Push is not available on this server' });
  }
});

/** What this person currently has listening, for the settings page. */
router.get('/devices', async (req: AuthRequest, res: Response) => {
  const devices = await prisma.pushDevice.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, label: true, createdAt: true, lastOkAt: true },
  });
  res.json({ devices });
});

/**
 * Register this browser.
 *
 * Keyed on the endpoint, which the push service reissues unchanged to a
 * browser that subscribes again — so re-granting permission updates the row
 * rather than adding a second one that would deliver every alert twice.
 */
router.post('/subscribe', async (req: AuthRequest, res: Response) => {
  const { endpoint, keys, label } = req.body ?? {};
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://')) {
    return res.status(400).json({ error: 'A push endpoint is required' });
  }
  if (typeof keys?.p256dh !== 'string' || typeof keys?.auth !== 'string') {
    return res.status(400).json({ error: 'The subscription is missing its keys' });
  }

  const data = {
    userId: req.user!.id,
    p256dh: keys.p256dh,
    auth: keys.auth,
    label: typeof label === 'string' ? label.slice(0, 60) : null,
  };

  await prisma.pushDevice.upsert({
    where: { endpoint },
    // An endpoint moving to a different person happens on a shared phone,
    // and the new owner is the one who just granted permission.
    update: data,
    create: { endpoint, ...data },
  });

  res.json({ ok: true });
});

/** Stop sending to this browser. Unknown endpoints are not an error. */
router.post('/unsubscribe', async (req: AuthRequest, res: Response) => {
  const { endpoint } = req.body ?? {};
  if (typeof endpoint !== 'string') {
    return res.status(400).json({ error: 'A push endpoint is required' });
  }
  await prisma.pushDevice.deleteMany({ where: { endpoint, userId: req.user!.id } });
  res.json({ ok: true });
});

/**
 * Prove it works, from the settings page, without waiting for a real alert.
 *
 * Reports per device rather than a single count. A test that says "sent to
 * 1 device" while the phone it was meant for was refused is worse than no
 * test at all — it is the laptop answering for the phone.
 */
router.post('/test', async (req: AuthRequest, res: Response) => {
  const result = await sendPushToUser(req.user!.id, {
    title: 'OnlyFunds',
    body: 'Push notifications are working on this device.',
    tag: 'push-test',
  });
  res.json(result);
});

export default router;
