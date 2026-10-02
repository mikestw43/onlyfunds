import 'dotenv/config';
import dns from 'node:dns';

import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRouter from './routes/auth';
import accountsRouter from './routes/accounts';
import dashboardRouter from './routes/dashboard';
import mt5Router from './routes/mt5';
import adminRouter from './routes/admin';
import analyticsRouter from './routes/analytics';
import notificationsRouter from './routes/notifications';
import groupsRouter from './routes/groups';
import settingsRouter from './routes/settings';
import auditRouter from './routes/audit';
import marketRouter from './routes/market';
import eaRouter from './routes/ea';
import aiRouter from './routes/ai';
import commandsRouter from './routes/commands';
import pushRouter from './routes/push';
import announcementsRouter from './routes/announcements';
import passkeysRouter from './routes/passkeys';
import { initWebSocket } from './websocket/broadcaster';
import { runtimeStore } from './services/runtimeStore';
import { cleanOldSnapshots } from './services/equityService';
import { cleanOldTrades } from './services/tradeHistoryService';
import { cleanOldAuditLogs, cleanOldNotificationLogs } from './services/retentionService';
import { cleanOldChats } from './services/aiChats';
import { reportScheduler } from './services/reportScheduler';
import { errorHandler } from './middleware/errorHandler';
import { warmFxCache } from './services/fxService';
import { backfillTradeOwners, repairGuessedOpenTimes } from './services/tradeHistoryService';
import { verifyEmailTransport } from './services/emailService';
import { applySqlitePragmas } from './lib/prisma';
import fs from 'fs';
import path from 'path';

/**
 * Resolve names to IPv4 first.
 *
 * Node 17 changed the default to whatever the resolver returns, which for a
 * host like smtp.gmail.com means the AAAA record. A droplet with no IPv6
 * route then fails the connection outright — ENETUNREACH against
 * 2404:6800:… — before anything it was trying to do can begin, and the error
 * names the wrong culprit: the mailer reported bad credentials when the
 * credentials were fine. Every outbound call this server makes goes to a
 * host with an A record, so preferring it costs nothing and removes a class
 * of failure that is very hard to read from the log.
 */
dns.setDefaultResultOrder('ipv4first');

const app = express();
const PORT = process.env.PORT || 4000;

// One nginx sits in front and sets X-Forwarded-For. Without this every
// request looks like it came from 127.0.0.1, which would make a per-address
// rate limit a limit on the whole world at once.
app.set('trust proxy', 1);

app.use(helmet());

// CORS: production reads from CORS_ORIGIN env, dev allows localhost
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
  : ['http://localhost:5173', 'http://127.0.0.1:5173'];
app.use(cors({ origin: corsOrigins, credentials: true }));

// Photos go to the assistant inline, base64, four at a time — which will
// not fit in the 2mb the rest of the API needs. The bigger limit is mounted
// on that path only, and before the global parser, because whichever runs
// first is the one that decides.
app.use('/api/ai', express.json({ limit: '14mb' }));

app.use(express.json({ limit: '2mb' })); // Increased for large closedDeals payloads (500+ trades)

app.use('/api/auth', authRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/mt5', mt5Router);
app.use('/api/admin', adminRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/admin/audit', auditRouter);
app.use('/api/market', marketRouter);
app.use('/api/ea', eaRouter);
app.use('/api/ai', aiRouter);
app.use('/api/commands', commandsRouter);
app.use('/api/push', pushRouter);
app.use('/api/announcements', announcementsRouter);
app.use('/api/passkeys', passkeysRouter);

// Build stamp helps verify a deploy actually picked up new code.
const BUILD_TAG = 'v1.4-vps-sqlite';

/**
 * The commit this process is running, read straight from .git at boot.
 *
 * "Is the fix live yet?" was costing a round-trip every time: the browser
 * caches, the deploy is on a five-minute cron, and nothing on screen says
 * which build you are looking at. Opening /api/health now answers it.
 */
const readDeployedCommit = (): string => {
  try {
    const gitDir = path.resolve(process.cwd(), '..', '.git');
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    // Detached HEAD holds the sha itself; otherwise it points at a ref file.
    const sha = head.startsWith('ref: ')
      ? fs.readFileSync(path.join(gitDir, head.slice(5)), 'utf8').trim()
      : head;
    return sha.slice(0, 7);
  } catch {
    return 'unknown';
  }
};
const DEPLOYED_COMMIT = readDeployedCommit();
const STARTED_AT = new Date().toISOString();

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    build: BUILD_TAG,
    commit: DEPLOYED_COMMIT,
    startedAt: STARTED_AT,
    timestamp: new Date().toISOString(),
  });
});

// Global error handler — must be AFTER all routes
app.use(errorHandler);

const server = http.createServer(app);

// Apply SQLite tuning, initialize runtime store from DB, then start
applySqlitePragmas().then(() => runtimeStore.initialize()).then(() => {
  initWebSocket(server);
  reportScheduler.start();
  // Warm the FX cache (used for KPI USD aggregation). Non-blocking — if the
  // refresh fails the cache is empty and rates fall back to 1.0.
  warmFxCache().catch(() => { /* logged inside fxService */ });
  backfillTradeOwners().catch(e => console.error('[TradeHistory] owner backfill failed:', e));
  repairGuessedOpenTimes().catch(e => console.error('[TradeHistory] open-time repair failed:', e));
  verifyEmailTransport().catch(() => { /* logged inside emailService */ });
  server.listen(PORT, () => {
    console.log(`[OnlyFunds] Backend running on http://localhost:${PORT}`);
  });

  // Daily cleanup of old data (run every 24h) — PDPA data retention
  setInterval(() => {
    cleanOldSnapshots().catch(err => console.error('[Cleanup] snapshots:', err.message));
    cleanOldTrades().catch(err => console.error('[Cleanup] trades:', err.message));
    cleanOldAuditLogs().catch(err => console.error('[Cleanup] audit:', err.message));
    cleanOldNotificationLogs().catch(err => console.error('[Cleanup] notifications:', err.message));
    cleanOldChats().catch(err => console.error('[Cleanup] ai chats:', err.message));
  }, 24 * 60 * 60 * 1000);
});
