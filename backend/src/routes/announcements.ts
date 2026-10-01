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

/** Everything, pinned first, newest first within each. */
router.get('/', async (_req: AuthRequest, res: Response) => {
  const announcements = await prisma.announcement.findMany({
    orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
    take: 100,
  });
  res.json({ announcements });
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
