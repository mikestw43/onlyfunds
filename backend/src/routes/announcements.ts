import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import prisma from '../lib/prisma';

/**
 * Notices from whoever runs the dashboard to everyone who uses it.
 *
 * Reading is for every signed-in person — a notice only an admin can see
 * is not a notice. Writing is for admins. The page these replace was in
 * the admin menu and kept nothing, so it managed to be both unreadable by
 * the people it was for and unable to remember what was written.
 */
const router = Router();

router.use(authMiddleware);

const TYPES = ['info', 'warning', 'update', 'maintenance'];

const adminOnly = (req: AuthRequest, res: Response): boolean => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Only an admin can post announcements' });
    return false;
  }
  return true;
};

/**
 * Everything, pinned first, newest first within each, plus what this
 * reader has already been shown and what they have tidied away.
 *
 * The two lists used to live in the browser's own storage, which made
 * "read" mean "read on this device": the same notice carried a mark on
 * the phone after being read on the desktop. They are per person now, and
 * come back with the notices so the panel can draw itself from one call.
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  const [announcements, reads] = await Promise.all([
    prisma.announcement.findMany({
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    }),
    prisma.announcementRead.findMany({
      where: { userId: req.user!.id },
      select: { announcementId: true, cleared: true },
    }),
  ]);
  res.json({
    announcements,
    seen: reads.map(r => r.announcementId),
    cleared: reads.filter(r => r.cleared).map(r => r.announcementId),
  });
});

/** The ids in a {ids: [...]} body, sane and deduplicated. */
const idsFrom = (body: unknown): string[] => {
  const raw = (body as { ids?: unknown })?.ids;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((x): x is string => typeof x === 'string' && x.length > 0))].slice(0, 500);
};

/**
 * Mark notices as shown to this reader.
 *
 * Idempotent, and quiet about ids it does not recognise — a browser that
 * has been open since before a notice was deleted should not get an error
 * for saying it read it.
 */
router.post('/seen', async (req: AuthRequest, res: Response) => {
  const ids = idsFrom(req.body);
  if (ids.length === 0) return res.json({ ok: true, marked: 0 });
  const [live, already] = await Promise.all([
    prisma.announcement.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    prisma.announcementRead.findMany({
      where: { userId: req.user!.id, announcementId: { in: ids } },
      select: { announcementId: true },
    }),
  ]);
  // SQLite has no "insert or ignore" through createMany, so the rows that
  // exist are found first rather than inserted and forgiven.
  const known = new Set(already.map(r => r.announcementId));
  const fresh = live.filter(a => !known.has(a.id));
  if (fresh.length > 0) {
    await prisma.announcementRead.createMany({
      data: fresh.map(a => ({ userId: req.user!.id, announcementId: a.id })),
    });
  }
  res.json({ ok: true, marked: fresh.length });
});

/**
 * Tidy notices out of this reader's own panel.
 *
 * Clearing is not deleting: the notice stays on the admin page and on
 * everyone else's panel. Clearing counts as having seen it, so a row that
 * already exists is updated rather than added.
 */
router.post('/clear', async (req: AuthRequest, res: Response) => {
  const ids = idsFrom(req.body);
  if (ids.length === 0) return res.json({ ok: true, cleared: 0 });
  const live = await prisma.announcement.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  await prisma.$transaction(live.map(a => prisma.announcementRead.upsert({
    where: { userId_announcementId: { userId: req.user!.id, announcementId: a.id } },
    update: { cleared: true },
    create: { userId: req.user!.id, announcementId: a.id, cleared: true },
  })));
  res.json({ ok: true, cleared: live.length });
});

router.post('/', async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  const { title, body, type, pinned } = req.body ?? {};
  if (typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'A title is required' });
  }
  if (typeof body !== 'string' || !body.trim()) {
    return res.status(400).json({ error: 'A body is required' });
  }
  const created = await prisma.announcement.create({
    data: {
      title: title.trim().slice(0, 200),
      body: body.trim().slice(0, 4000),
      type: TYPES.includes(type) ? type : 'info',
      pinned: pinned === true,
      authorId: req.user!.id,
      authorName: req.user!.email ?? null,
    },
  });
  res.status(201).json(created);
});

/** Express types a route param as possibly repeated; there is one here. */
const oneId = (raw: string | string[]): string => (Array.isArray(raw) ? raw[0] : raw);

/** Edit in place, or pin and unpin. Only the fields sent are touched. */
router.patch('/:id', async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  const { title, body, type, pinned } = req.body ?? {};
  const data: Record<string, unknown> = {};
  if (typeof title === 'string' && title.trim()) data.title = title.trim().slice(0, 200);
  if (typeof body === 'string' && body.trim()) data.body = body.trim().slice(0, 4000);
  if (TYPES.includes(type)) data.type = type;
  if (typeof pinned === 'boolean') data.pinned = pinned;
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'Nothing to change' });
  }
  try {
    res.json(await prisma.announcement.update({ where: { id: oneId(req.params.id) }, data }));
  } catch {
    res.status(404).json({ error: 'Announcement not found' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  const removed = await prisma.announcement.deleteMany({ where: { id: oneId(req.params.id) } });
  if (removed.count === 0) return res.status(404).json({ error: 'Announcement not found' });
  res.json({ ok: true });
});

export default router;
