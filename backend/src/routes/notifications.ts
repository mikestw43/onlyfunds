import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import prisma from '../lib/prisma';

const router = Router();

router.use(authMiddleware);

/**
 * GET /api/notifications?page=&limit=
 *
 * Carries how many are unread and how far this person has read, both
 * worked out here. The browser used to do it, comparing the server's
 * sentAt against its own Date.now(): two clocks, so a server a few
 * seconds ahead stamped alerts into the future and the number would not
 * go down. One clock now, and the mark follows the person between
 * devices instead of sitting in each browser's storage.
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  const page = parseInt((req.query.page as string) || '1');
  const limit = parseInt((req.query.limit as string) || '25');

  const userId = req.user!.id;
  const where = { userId };

  const [logs, total, user] = await Promise.all([
    prisma.notificationLog.findMany({
      where,
      orderBy: { sentAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.notificationLog.count({ where }),
    prisma.user.findUnique({ where: { id: userId }, select: { notificationsSeenAt: true } }),
  ]);

  const seenAt = user?.notificationsSeenAt ?? null;
  const unread = seenAt
    ? await prisma.notificationLog.count({ where: { userId, sentAt: { gt: seenAt } } })
    : total;

  res.json({ logs, total, page, limit, unread, seenAt });
});

/**
 * POST /api/notifications/seen — everything up to now has been read.
 *
 * `at` is only for the one-time hand-over from the mark each browser used
 * to keep for itself; it can only move the mark forward, and never past
 * now, so a device with a fast clock cannot hide an alert that has not
 * arrived yet.
 */
router.post('/seen', async (req: AuthRequest, res: Response) => {
  const now = new Date();
  const asked = new Date((req.body as { at?: string })?.at ?? '');
  const wanted = !isNaN(asked.getTime()) && asked < now ? asked : now;

  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { notificationsSeenAt: true },
  });
  const current = user?.notificationsSeenAt;
  const seenAt = current && current > wanted ? current : wanted;

  await prisma.user.update({
    where: { id: req.user!.id },
    data: { notificationsSeenAt: seenAt },
  });
  res.json({ seenAt });
});

export default router;
