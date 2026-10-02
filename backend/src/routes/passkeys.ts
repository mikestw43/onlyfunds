import { Router, Request, Response } from 'express';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server';
import prisma from '../lib/prisma';
import { generateToken, authMiddleware, AuthRequest } from '../middleware/auth';
import { logAudit } from '../services/auditLogger';
import { rateLimit } from '../middleware/rateLimit';
import crypto from 'node:crypto';

/**
 * Signing in with Face ID, a fingerprint, or whatever else unlocks the
 * device in front of you.
 *
 * The standard is WebAuthn and the thing it creates is a passkey. The
 * device makes a pair of keys, keeps the private half in its secure
 * hardware, and hands us the public half. To sign in, the server sends a
 * random challenge and the device signs it — after the person has proved
 * to the DEVICE that they are there, which is what Face ID is doing. The
 * face never leaves the phone, and no part of it ever reaches this server.
 *
 * Why this beats a password for an app like this one:
 *
 *   - There is no secret here to steal. This table is public keys; they
 *     verify a signature and cannot make one.
 *   - It cannot be phished. The key is bound to the domain by the browser,
 *     so a convincing copy of the login page at another address simply has
 *     no key to ask for.
 *   - Nothing to type on a phone, which is where this gets used.
 *
 * Which biometric appears is the operating system's business, not ours: an
 * iPhone with Face ID shows Face ID, one without shows Touch ID, an Android
 * shows its fingerprint reader, and a failed scan falls back to the
 * device's own passcode. There is no branch here for any of that.
 */
const router = Router();

/**
 * Where the browser must be for a key to be valid.
 *
 * A passkey is bound to a domain — that is the whole of its phishing
 * resistance — so the relying party id is this site's hostname and nothing
 * else. Changing the domain invalidates every key ever registered, which is
 * a thing to know before changing the domain.
 *
 * In development the dev server is on another port, and ports do not matter
 * to the RP id but do to the origin, so both local origins are accepted
 * there and only there.
 */
const prod = process.env.NODE_ENV === 'production';
// SITE_URL always wins. Without it, production is the dashboard and
// anything else is a developer on their own machine — where the hostname
// has to be localhost or the browser refuses every key.
const site = (process.env.SITE_URL?.trim()
  || (prod ? 'https://onlyfunds.duckdns.org' : 'http://localhost:5173')).replace(/\/+$/, '');
const RP_ID = new URL(site).hostname;
const RP_NAME = 'OnlyFunds';
const ORIGINS = prod
  ? [site]
  : [site, 'http://localhost:5173', 'http://localhost:5199', 'http://localhost:4000'];

/**
 * Challenges in flight.
 *
 * A challenge is single-use, lives for a minute or two, and is worthless
 * afterwards, so it sits in memory rather than in the database. This
 * process restarts on every deploy and the worst that does is make someone
 * press the button again.
 */
interface Pending { challenge: string; userId?: string; at: number }
const pending = new Map<string, Pending>();
const CHALLENGE_TTL = 3 * 60_000;

const sweep = (): void => {
  const cutoff = Date.now() - CHALLENGE_TTL;
  for (const [id, p] of pending) if (p.at < cutoff) pending.delete(id);
};

const remember = (challenge: string, userId?: string): string => {
  sweep();
  const id = crypto.randomBytes(16).toString('hex');
  pending.set(id, { challenge, userId, at: Date.now() });
  return id;
};

const take = (id: unknown): Pending | null => {
  if (typeof id !== 'string') return null;
  const found = pending.get(id);
  // Single use, whether it verifies or not: a challenge that can be
  // replayed is not a challenge.
  if (found) pending.delete(id);
  if (!found || Date.now() - found.at > CHALLENGE_TTL) return null;
  return found;
};

/** Something recognisable in the list — "iPhone", not a user agent string. */
const deviceLabel = (ua: string | undefined): string => {
  const s = ua || '';
  if (/iPhone/.test(s)) return 'iPhone';
  if (/iPad/.test(s)) return 'iPad';
  if (/Android/.test(s)) return 'Android';
  if (/Macintosh/.test(s)) return 'Mac';
  if (/Windows/.test(s)) return 'Windows';
  return 'Device';
};

const publicPasskey = (p: {
  id: string; label: string | null; createdAt: Date; lastUsedAt: Date | null;
}) => ({ id: p.id, label: p.label, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt });

// ── Registering a new key, for someone already signed in ─────────────────

/** GET /api/passkeys — what this person has registered. */
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  const rows = await prisma.passkey.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, label: true, createdAt: true, lastUsedAt: true },
  });
  res.json({ passkeys: rows.map(publicPasskey) });
});

/** POST /api/passkeys/register/options — what the browser needs to make one. */
router.post('/register/options', authMiddleware, async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, email: true, displayName: true, name: true, passkeys: { select: { credentialId: true, transports: true } } },
  });
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: user.email,
    userDisplayName: user.displayName || user.name || user.email,
    // The user handle comes back at sign-in and is how a key with no email
    // typed finds its person. It is this row's id, which is not a secret
    // and does not change.
    userID: new TextEncoder().encode(user.id),
    // Nothing is stored about the device itself: attestation is for
    // enterprises that must know which model of key was used, and asking
    // for it only adds a scary prompt.
    attestationType: 'none',
    // A device that already has a key for this account should say so
    // rather than quietly making a second one.
    excludeCredentials: user.passkeys.map(k => ({
      id: k.credentialId,
      transports: k.transports ? (JSON.parse(k.transports) as string[]) : undefined,
    })),
    authenticatorSelection: {
      // Discoverable, so signing in needs no email typed first — the
      // device offers the account itself.
      residentKey: 'preferred',
      // "Preferred" rather than "required": it asks for Face ID and still
      // works on a laptop that has no biometric at all.
      userVerification: 'preferred',
    },
  });

  res.json({ options, challengeId: remember(options.challenge, user.id) });
});

/** POST /api/passkeys/register/verify — check it and keep the public half. */
router.post('/register/verify', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { response, challengeId } = req.body as { response?: RegistrationResponseJSON; challengeId?: string };
  const expected = take(challengeId);
  if (!response || !expected || expected.userId !== req.user!.id) {
    res.status(400).json({ error: 'That took too long — please try again.' });
    return;
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: expected.challenge,
      expectedOrigin: ORIGINS,
      expectedRPID: RP_ID,
      requireUserVerification: false,
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error)?.message || 'That key could not be verified.' });
    return;
  }

  if (!verification.verified) {
    res.status(400).json({ error: 'That key could not be verified.' });
    return;
  }

  const { credential } = verification.registrationInfo;
  const created = await prisma.passkey.create({
    data: {
      userId: req.user!.id,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      label: deviceLabel(req.headers['user-agent']),
      transports: credential.transports ? JSON.stringify(credential.transports) : null,
    },
    select: { id: true, label: true, createdAt: true, lastUsedAt: true },
  });

  logAudit(req.user!.id, 'passkey_add', 'user', req.user!.id, created.label ?? '');
  res.status(201).json({ passkey: publicPasskey(created) });
});

/** DELETE /api/passkeys/:id — this device can no longer sign in. */
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  // Scoped to the caller: an id from someone else's account must not be
  // deletable by guessing it.
  const removed = await prisma.passkey.deleteMany({ where: { id, userId: req.user!.id } });
  if (removed.count === 0) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  logAudit(req.user!.id, 'passkey_remove', 'user', req.user!.id, id);
  res.json({ ok: true });
});

// ── Signing in ───────────────────────────────────────────────────────────

/**
 * Guessing at this is pointless — a signature cannot be brute-forced — but
 * the endpoint is open to the internet and should not be free to hammer.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 30,
  message: 'Too many sign-in attempts. Please wait a few minutes and try again.',
});

/** POST /api/passkeys/login/options — a challenge for whoever is at the door. */
router.post('/login/options', loginLimiter, async (_req: Request, res: Response) => {
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    // Empty on purpose: the device shows the accounts it holds for this
    // site and the person picks one, so nothing has to be typed and the
    // server learns nothing about who is trying until they succeed.
    allowCredentials: [],
    userVerification: 'preferred',
  });
  res.json({ options, challengeId: remember(options.challenge) });
});

/** POST /api/passkeys/login/verify — a good signature is a sign-in. */
router.post('/login/verify', loginLimiter, async (req: Request, res: Response) => {
  const { response, challengeId } = req.body as { response?: AuthenticationResponseJSON; challengeId?: string };
  const expected = take(challengeId);
  if (!response || !expected) {
    res.status(400).json({ error: 'That took too long — please try again.' });
    return;
  }

  const stored = await prisma.passkey.findUnique({
    where: { credentialId: response.id },
    include: { user: true },
  });
  // Deliberately the same answer as a bad signature: whether a given key is
  // registered here is not something a stranger needs to learn.
  if (!stored) {
    res.status(401).json({ error: 'This device is not registered for any account here.' });
    return;
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: expected.challenge,
      expectedOrigin: ORIGINS,
      expectedRPID: RP_ID,
      credential: {
        id: stored.credentialId,
        publicKey: new Uint8Array(Buffer.from(stored.publicKey, 'base64url')),
        counter: stored.counter,
        transports: stored.transports ? (JSON.parse(stored.transports) as never) : undefined,
      },
      requireUserVerification: false,
    });
  } catch (err) {
    res.status(401).json({ error: (err as Error)?.message || 'That did not verify.' });
    return;
  }

  if (!verification.verified) {
    res.status(401).json({ error: 'That did not verify.' });
    return;
  }

  const user = stored.user;
  // The same gates the password login has. A suspended account must not
  // have a second door standing open behind the first.
  if (user.status === 'pending') {
    res.status(403).json({ error: 'Your account is pending admin approval.' });
    return;
  }
  if (user.status === 'rejected') {
    res.status(403).json({ error: 'Your account registration was rejected.' });
    return;
  }
  if (user.status === 'suspended') {
    res.status(403).json({ error: 'Your account has been suspended. Please contact an administrator.' });
    return;
  }

  await prisma.passkey.update({
    where: { id: stored.id },
    data: { counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() },
  });
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const token = generateToken({ id: user.id, email: user.email, role: user.role });
  logAudit(user.id, 'login_passkey', 'user', user.id);
  res.json({
    token,
    user: {
      id: updated.id, email: updated.email, role: updated.role,
      name: updated.name, displayName: updated.displayName,
      mobile: updated.mobile, phoneCountry: updated.phoneCountry,
      timezone: updated.timezone, avatarUrl: updated.avatarUrl ?? null,
      hasPassword: !!updated.password,
      hasGoogleLinked: !!updated.googleId,
      createdAt: updated.createdAt, lastLoginAt: updated.lastLoginAt,
    },
  });
});

export default router;
