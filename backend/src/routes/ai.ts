import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { runtimeStore } from '../services/runtimeStore';
import prisma from '../lib/prisma';
import { rateLimit } from '../middleware/rateLimit';
import { buildPortfolioContext } from '../services/aiContext';
import { askModel, resolveAi, aiDefaultModel, aiBaseFor, listModels, AI_PROVIDERS, type AiTurn, type ResolvedAi } from '../services/aiProvider';
import { loadAiConfig, saveAiConfig, redacted, configForProvider, savedKeyHints, aiPrices, saveAiPrices } from '../services/aiSettings';
import { listChats, getChat, saveTurn, deleteChat, truncateFrom, markOrdersSent } from '../services/aiChats';
import { mayAsk, recordAsk } from '../services/aiUsage';
import { listMemories, addMemory, forgetMemory, memoryText } from '../services/aiMemory';
import { adminMiddleware } from '../middleware/auth';
import { logAudit } from '../services/auditLogger';

/**
 * The AI assistant's own routes.
 *
 * No model is wired up yet, on purpose: the screens go in first, and the
 * provider is a later change to one file. What exists here is everything
 * that does not depend on which model answers —
 *
 *   GET  /api/ai/status   whether a provider is configured, so the page can
 *                         say so plainly instead of failing at the first
 *                         question
 *   GET  /api/ai/context  the figures an answer would be built from, which
 *                         is also what the page shows in its header
 *   POST /api/ai/chat     answers 503 with a clear reason until a key exists
 *
 * Nothing here sends anything anywhere. When a provider is added it goes
 * behind one adapter, and swapping it is a change of environment variables:
 *
 *   AI_PROVIDER   anthropic | openai | google | openrouter
 *   AI_MODEL      the model id
 *   AI_API_KEY    the key, which lives on the server and nowhere else
 */

const router = Router();
router.use(authMiddleware);



/**
 * What the assistant is and is not.
 *
 * Most of this is about the second part. It can read this portfolio and it
 * can do arithmetic on it; it cannot see a chart it has not been given, it
 * does not know what the market will do next, and it must not sound as if
 * it does. The person on the other end has real money in these positions.
 */
const systemPrompt = (contextText: string, language: string, memories: string): string => `
You are the assistant inside OnlyFunds, a dashboard that watches this
person's live MT5 trading accounts. You are talking to the account owner.

WHAT YOU CAN SEE
Everything below is this person's own live data, refreshed seconds ago.
It is the only account data you have; you cannot look anything else up.

${contextText}

${memories}HOW TO ANSWER
- Answer plainly. This person is a trader, not a programmer.
- Start in ${language === 'th' ? 'Thai' : 'English'} — that is the language
  the dashboard is set to. It is a default, not a rule: answer in whatever
  language the question is asked in, and if this person asks you to switch,
  switch and stay switched. You are able to write both. Never tell them you
  cannot answer in a language.
- Be specific and use their real figures. Name the position, the symbol,
  the amount. Vague advice is worse than none.
- Lead with the answer, then the reasoning. Keep it short unless asked.
- Money: state the account's own currency. A USC account is in cents —
  100 units there is 1 US dollar. Never mix the two up.

WHAT YOU MUST NOT DO
- Do not predict where any price will go. You cannot see the chart, the
  news or the order book. If asked, say so plainly and talk about risk,
  exposure and this person's own history instead.
- Do not invent numbers. If something is not in the data above, say it is
  not available rather than estimating it.
- Do not claim to have placed, closed or changed any order. You cannot.
  What you can do is write one out for them to confirm — see below.
- Do not lecture. One short caution where it matters, not a disclaimer on
  every paragraph.

WRITING OUT ORDERS
When they ask you to open, close or change something, do not say you
cannot. Write it out and let them press the button.

Answer in one or two short lines — what you are handing them and the one
thing worth knowing — then a block on its own:

\`\`\`order
{"account":"#900777","orders":[
{"action":"open","symbol":"XAUUSD.v","side":"buy","lots":0.01,"orderType":"limit","price":4251,"sl":4195,"tp":4330}
]}
\`\`\`

One block per answer, at the end, up to 20 rows in it. Row shapes:
  open     {"action":"open","symbol":"…","side":"buy"|"sell","lots":0.01,"orderType":"market"|"limit"|"stop","price":0,"sl":0,"tp":0}
           a stop given as a distance instead of a price: "slPoints":20, "tpPoints":60
  close    {"action":"close","ticket":40551234,"lots":0}        lots > 0 closes that much of it
  sltp     {"action":"sltp","ticket":40551234,"sl":0,"tp":0}
  closeAll {"action":"closeAll"}

Rules that matter more than being helpful:
- account is the number from the ACCOUNTS list, with its #. If they did
  not say which account and there is more than one, ask. Never choose.
- They will often name an account rather than number it — the picker in
  the app writes the name, because eleven digits in the middle of a
  sentence is unreadable. A name is not a missing account: find it in the
  ACCOUNTS list and use its number. Match it as they wrote it, ignoring
  case. Only if the name fits two accounts, or none, is there anything to
  ask about — and then say which names you found, rather than asking the
  question again.
- symbol is spelled as it appears in the facts above — brokers add
  suffixes, and the wrong spelling is a refused order.
- ticket comes from the OPEN POSITIONS list. Never invent one. If more
  than one position fits what they said, ask which.
- A ticket names one position and no other, and the OPEN POSITIONS line
  for it says which account it is on. So a row that carries a ticket
  needs no one to name the account: read it off that line. Asking which
  account a ticket is on is asking for something already written down,
  and the rule above is about not guessing, not about refusing to look.
- Use the size they asked for. If they did not say and you can work one
  out from a risk they gave you, do — and say what you worked out. If
  neither, ask.
- limit and stop need a price; market does not. Which one it is depends
  on where the price is now: buying below the current price is a limit,
  buying above it is a stop, and the other way round for selling. The
  current bid and ask are in the facts above. If they are not, ask
  rather than guess.
- 0 means "leave it" for sl and tp.
- A distance — "SL 20 points away" — goes as "slPoints":20, not as a
  price you worked out. On a market order the distance travels all the
  way to the terminal, which measures it from the price the order
  actually filled at: 20 points means 20 points from the fill, exactly,
  however far the market moved while the question was being answered.
  Turn it into a price yourself and you have picked an entry instead —
  and if the market is no longer there, the stop lands on the wrong side
  of it and the order is refused. The card shows what the distance comes
  to against the last quote, as something to check; that preview is not
  what gets sent.
- A market order has no price. Never put one on it. Never invent one —
  not as an example, not to show your working, not to have something to
  subtract a stop from. If you do not have the current price and you
  need one, the facts either have a bid and ask for that symbol or they
  do not: say which, and ask, rather than supplying a number that looks
  like a price and is not.
- Two feeds in the facts carry a price, up to a minute apart. Where a
  symbol's line carries "PRICE NOW", that is the current price of it:
  quote that one and work the distances from it. The bid and ask in front
  of it are up to a minute old and are there for the spread, the point
  size and the money per lot. Never hand them two different prices for
  one symbol without saying which is the newer.
- Only attach a block when they asked for the trade. Never on an answer
  about how things are going.

NUMBERS THAT CAME OUT OF A PHOTO
A screenshot of somebody's terminal is a picture, and you are reading
digits off it. A 4 read as a 9 is a real order at a real price, so
before the block, list back what you took from it — symbol, side, every
price, every lot — on one line each, so it can be checked against the
picture rather than trusted.

- Never guess a digit. If one is cut off, blurred or ambiguous, say
  which and ask. An order short one leg is fixable; an order at the
  wrong price is a loss.
- It is their broker, not this one. Use the symbol as this broker
  spells it, from the facts above, and say you have done so. Their
  prices may not be reachable here at all — if the level is on the
  wrong side of this broker's price, say so rather than flipping limit
  to stop to make it fit.
- Their lots are sized for their account. Say what the same lots come
  to on this one before copying them, and if it is a different size of
  account, offer the scaled figure instead.
- What the picture does not show, it does not show. No stop in the
  screenshot means no stop, not one you invented.

ASKING TO REMEMBER SOMETHING
You do not learn from this conversation: tomorrow you will be the same
model, with none of it. What you can do is ask for something to be kept
on the list above, which is read to you at the start of every question.

When they say something that will still be true next week — how they
count, what they trade, a size they always use, how they want answers
written — offer to keep it, at the end of the answer:

\`\`\`remember
{"text":"Counts in MT5 points, so 20 points on gold is 0.20"}
\`\`\`

One line, in their own terms, written so it makes sense on its own.
At most one per answer, and only when it is worth carrying for months:
not what they asked today, not a position that will be closed by
Friday, and never something already on the list. If in doubt, leave it
— an unasked question costs nothing and a cluttered list costs every
question after it.

ADDING NUMBERS UP
You are bad at arithmetic over a long column and you do not feel bad at
it, which is the dangerous part. So do not do it. The facts carry a LOT
TOTALS block, added up in code, per account and per symbol: buy, sell,
how many positions each side, and the net. Read the answer off that
block. Never total the lot sizes in the positions list yourself, not
even to check, and never to "show your working" — the working is what
goes wrong. If the figure they want is not in the block, say it is not
there and offer what is.

The same goes for being corrected. If they say a total of yours is
wrong, do not adopt their number and present it as a recalculation —
adding is not what produced it and agreeing is not checking. Go back to
the LOT TOTALS block, say what it says and which line you read, and
say plainly whether that agrees with them. Where it does not, the
difference is usually which positions each of you counted: ask.

WHAT A POINT MEANS HERE
This person counts in MT5 points: one point is the "1 point = …" figure
in the facts above — 0.01 on a two-decimal gold, so "SL 20 points" is
0.20 away from the entry, not 20 dollars. Say the conversion in words
every time you use it, in this shape:

  SL 20 points = 0.20 → 4250.80, about 6 USD on 0.10 lots

They can see at a glance whether you understood them, which matters:
the three readings of "20 points" on gold are a hundred times apart.
If they say dollars, baht or a price, take them at their word instead.

WORKING OUT SIZE AND RISK
The facts above carry, per symbol, what a 1.0 move in price is worth per
lot, the volume steps, the broker's minimum stop and a 14-day ATR. With
those:
- risk on a row = (entry − stop, as a distance) × (money per lot) × lots
- to hit a budget: lots = budget ÷ (distance × money per lot), rounded
  down to the volume step
- to compare two instruments — "how much silver is like 0.10 gold" —
  compare ATR × money per lot for each
Say the arithmetic in one line so they can see it. The dashboard checks
every figure against the terminal before anything is sent, and will
show them what it makes of it, so do not round anything in your favour.
Never use a contract size you remember; this broker's may differ.

If the facts for a symbol are missing, say so and ask them to wait a
few minutes for the EA rather than estimating.
`.trim();

/** The provider's own words, turned into the thing to do about them. A
 *  refused key, an unpaid bill and a misspelt model all look the same
 *  otherwise, and each needs something different. */
const explainProviderError = (detail: string, model: string): string =>
  /^401|invalid[_ ]api[_ ]key|authentication|incorrect api key/i.test(detail)
    ? 'The key was refused. Check it, or paste a new one.'
  : /^402|credit|quota|billing|insufficient/i.test(detail)
    ? 'That account is out of credit. Top it up with the provider.'
  : /^404|model/i.test(detail)
    ? `The model "${model}" does not exist for this provider. Leave the model empty to use the default.`
  : /^429/.test(detail)
    ? 'The provider is rate-limiting us. Try again in a moment.'
  : /timeout|aborted/i.test(detail)
    ? 'The model took too long to answer. Try again.'
  : 'Could not reach the provider.';

/**
 * Not the policy — the policy is a switch and a daily number per person,
 * kept in aiUsage. This is the backstop against a loop in a browser tab
 * spending the account's credit while nobody is watching. No person asks
 * two questions a minute for an hour.
 */
const chatLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 120,
  message: 'That is a great many questions in one hour. Give it a few minutes.',
});

/** How much of the conversation goes back with each question. Enough to
 *  follow a thread, capped because every turn is paid for again. */
const MAX_HISTORY_TURNS = 10;

/**
 * Whether a question would get an answer.
 *
 * A key is what the four named providers need. A server of one's own
 * needs an address and a model name instead, and often no key at all —
 * Ollama on a machine at home asks for nothing.
 */
const isReady = (ai: { provider: string; apiKey: string; base: string; model: string }): boolean =>
  ai.provider === 'custom' ? !!ai.base && !!ai.model : !!ai.apiKey;

// GET /api/ai/status
router.get('/status', async (_req: AuthRequest, res: Response) => {
  const ai = await resolveAi();
  const ready = isReady(ai);
  res.json({
    configured: ready,
    provider: ai.provider,
    model: ready ? ai.model : null,
  });
});

/**
 * The settings page for the assistant — admin only.
 *
 * It exists so that connecting a model, swapping a provider or replacing a
 * key that has been refused does not mean SSH, nano and a restart. The key
 * goes in encrypted and never comes back out: the page is told only that
 * there is one, and its last four characters.
 */
const PROVIDERS = AI_PROVIDERS;

/**
 * An address an admin typed, checked before anything is sent to it.
 *
 * http and https only: the point of the field is another company's API or
 * a machine on the home network, and anything else is a mistake or worse.
 */
const badAddress = (raw: string): string | null => {
  let url: URL;
  try { url = new URL(raw); } catch { return 'That is not a web address. It should look like https://api.example.com/v1'; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'The address must start with http:// or https://';
  if (!url.hostname) return 'That address has no server name in it.';
  return null;
};



router.get('/settings', adminMiddleware, async (_req: AuthRequest, res: Response) => {
  const cfg = await loadAiConfig();
  const ai = await resolveAi();
  res.json({
    provider: ai.provider,
    model: ai.model,
    defaultModel: aiDefaultModel(ai.provider),
    hasKey: !!ai.apiKey,
    keyHint: redacted(ai.apiKey),
    source: cfg.source,               // dashboard | environment | none
    providers: PROVIDERS,
    defaults: Object.fromEntries(PROVIDERS.map(p => [p, aiDefaultModel(p)])),
    // Which providers already have a key, so switching between them shows
    // what is set up without having to select each one and find out.
    keys: await savedKeyHints(PROVIDERS),
    models: Object.fromEntries(await Promise.all(
      PROVIDERS.map(async p => [p, (await configForProvider(p)).model] as const),
    )),
    bases: Object.fromEntries(await Promise.all(
      PROVIDERS.map(async p => [p, (await configForProvider(p)).baseUrl] as const),
    )),
    // For turning tokens into an estimate of money on the usage screen.
    prices: await aiPrices(),
  });
});

/**
 * The models this key is allowed to use, asked of the provider itself.
 *
 * The alternative is a list written here by hand, which is wrong the week
 * a new model ships and gives no hint that a key has been refused. This
 * asks the provider, and when it cannot (no key yet, no network) it says
 * so and hands back a short starter list — the field stays typeable, so an
 * id this does not know about is still allowed.
 *
 * A key may be passed in before it is saved, so the list can be seen while
 * deciding.
 */
router.post('/settings/models', adminMiddleware, async (req: AuthRequest, res: Response) => {
  const body = req.body as { provider?: string; apiKey?: string; baseUrl?: string };
  const provider = (body.provider || (await resolveAi()).provider).trim().toLowerCase();

  if (!PROVIDERS.includes(provider as typeof PROVIDERS[number])) {
    res.status(400).json({ error: 'bad_provider', message: `Provider must be one of: ${PROVIDERS.join(', ')}` });
    return;
  }

  const saved = await configForProvider(provider);
  const list = await listModels({
    provider: provider as ResolvedAi['provider'],
    model: '',
    apiKey: (body.apiKey || '').trim() || saved.apiKey,
    base: aiBaseFor(provider, (body.baseUrl || '').trim() || saved.baseUrl),
  });

  res.json({ provider, defaultModel: aiDefaultModel(provider), ...list });
});

router.put('/settings', adminMiddleware, async (req: AuthRequest, res: Response) => {
  const body = req.body as {
    provider?: unknown; model?: unknown; apiKey?: unknown;
    baseUrl?: unknown; activate?: unknown; prices?: unknown;
  };

  if (body.provider != null && !PROVIDERS.includes(String(body.provider).toLowerCase() as typeof PROVIDERS[number])) {
    res.status(400).json({ error: 'bad_provider', message: `Provider must be one of: ${PROVIDERS.join(', ')}` });
    return;
  }
  if (body.apiKey != null && typeof body.apiKey === 'string' && body.apiKey.trim() !== '' && body.apiKey.trim().length < 20) {
    res.status(400).json({ error: 'bad_key', message: 'That does not look like an API key.' });
    return;
  }
  const prices = body.prices as { inPerM?: unknown; outPerM?: unknown } | undefined;
  if (prices) {
    const nums = [prices.inPerM, prices.outPerM].filter(v => v !== undefined).map(Number);
    if (nums.some(n => !Number.isFinite(n) || n < 0 || n > 100000)) {
      res.status(400).json({ error: 'bad_price', message: 'A price must be a number, in baht per million tokens.' });
      return;
    }
    await saveAiPrices({
      ...(prices.inPerM !== undefined && { inPerM: Number(prices.inPerM) }),
      ...(prices.outPerM !== undefined && { outPerM: Number(prices.outPerM) }),
    }, req.user!.email);
  }

  if (body.baseUrl != null && String(body.baseUrl).trim() !== '') {
    const wrong = badAddress(String(body.baseUrl).trim());
    if (wrong) {
      res.status(400).json({ error: 'bad_base', message: wrong });
      return;
    }
  }
  // A server of one's own is only reachable if it has been named.
  const targetProvider = String(body.provider ?? (await resolveAi()).provider).toLowerCase();
  if (targetProvider === 'custom' && body.activate !== false) {
    const address = body.baseUrl != null
      ? String(body.baseUrl).trim()
      : (await configForProvider('custom')).baseUrl;
    if (!address) {
      res.status(400).json({ error: 'no_base', message: 'This one needs the address of the server that answers.' });
      return;
    }
  }

  await saveAiConfig({
    provider: body.provider != null ? String(body.provider) : undefined,
    model: body.model != null ? String(body.model) : undefined,
    apiKey: body.apiKey != null ? String(body.apiKey) : undefined,
    baseUrl: body.baseUrl != null ? String(body.baseUrl) : undefined,
    activate: body.activate !== false,
  }, req.user!.email);

  const ai = await resolveAi();
  const cfg = await loadAiConfig();
  logAudit(req.user!.id, 'ai_settings', 'ai', undefined,
    JSON.stringify({ provider: ai.provider, model: ai.model, keyChanged: body.apiKey != null }));

  res.json({
    provider: ai.provider, model: ai.model, hasKey: !!ai.apiKey,
    keyHint: redacted(ai.apiKey), source: cfg.source,
  });
});

/**
 * Try it, now, and say what happened.
 *
 * A saved key that is wrong looks exactly like a saved key that is right
 * until somebody asks a question. This asks the cheapest possible one —
 * and can test a key that has been typed but not yet saved, so a mistake
 * is caught before it is stored.
 */
router.post('/settings/test', adminMiddleware, async (req: AuthRequest, res: Response) => {
  const body = req.body as { provider?: string; model?: string; apiKey?: string; baseUrl?: string };
  const current = await resolveAi();

  const provider = (body.provider || current.provider) as ResolvedAi['provider'];
  // Not current.apiKey: the provider being tested may not be the selected
  // one, and testing Google with the OpenAI key would fail for the wrong
  // reason.
  const saved = await configForProvider(provider);
  const trial: ResolvedAi = {
    provider,
    model: (body.model || '').trim() || saved.model || aiDefaultModel(provider),
    apiKey: (body.apiKey || '').trim() || saved.apiKey,
    base: aiBaseFor(provider, (body.baseUrl || '').trim() || saved.baseUrl),
  };

  if (!trial.base) {
    res.status(400).json({ ok: false, message: 'There is no server address to test yet.' });
    return;
  }
  if (!trial.model) {
    res.status(400).json({ ok: false, message: 'Name the model this server should answer with.' });
    return;
  }
  // A server at home usually has no key, and that is not a mistake.
  if (!trial.apiKey && provider !== 'custom') {
    res.status(400).json({ ok: false, message: 'There is no key to test yet.' });
    return;
  }

  try {
    const started = Date.now();
    const answer = await askModel(
      'Reply with exactly: OK',
      [{ role: 'user', text: 'Say OK.' }],
      trial,
    );
    res.json({
      ok: true,
      ms: Date.now() - started,
      model: trial.model,
      said: answer.text.slice(0, 80),
      tokens: { in: answer.inputTokens, out: answer.outputTokens },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    res.json({ ok: false, message: explainProviderError(detail, trial.model), detail: detail.slice(0, 200) });
  }
});

/* ------------------------------------------------------------------ *
 * What the assistant is told about this person every time
 * ------------------------------------------------------------------ */

router.get('/memories', async (req: AuthRequest, res: Response) => {
  res.json({ memories: await listMemories(req.user!.id) });
});

router.post('/memories', async (req: AuthRequest, res: Response) => {
  const body = req.body as { text?: unknown; source?: unknown };
  const text = typeof body.text === 'string' ? body.text : '';
  const source = body.source === 'ai' ? 'ai' as const : 'you' as const;

  const saved = await addMemory(req.user!.id, text, source);
  if ('error' in saved) {
    res.status(400).json({ error: 'bad_memory', message: saved.error });
    return;
  }
  res.json(saved);
});

router.delete('/memories/:id', async (req: AuthRequest, res: Response) => {
  const gone = await forgetMemory(req.user!.id, String(req.params.id));
  if (!gone) {
    res.status(404).json({ error: 'not_found', message: 'That one is not there.' });
    return;
  }
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ *
 * Conversations
 *
 * Everything here is scoped to the person asking. The service takes the
 * user id on every call rather than trusting an id from the browser.
 * ------------------------------------------------------------------ */

// GET /api/ai/chats — the list, newest first
router.get('/chats', async (req: AuthRequest, res: Response) => {
  res.json({ chats: await listChats(req.user!.id) });
});

// GET /api/ai/chats/:id — one conversation, in full
router.get('/chats/:id', async (req: AuthRequest, res: Response) => {
  const chat = await getChat(req.user!.id, String(req.params.id));
  if (!chat) {
    res.status(404).json({ error: 'not_found', message: 'That conversation is not there.' });
    return;
  }
  res.json(chat);
});

// DELETE /api/ai/chats/:id
// POST /api/ai/messages/:id/orders-sent — the order in this answer has gone
router.post('/messages/:id/orders-sent', async (req: AuthRequest, res: Response) => {
  const ok = await markOrdersSent(req.user!.id, String(req.params.id));
  if (!ok) {
    res.status(404).json({ error: 'not_found', message: 'That message is not there.' });
    return;
  }
  res.json({ ok: true });
});

router.delete('/chats/:id', async (req: AuthRequest, res: Response) => {
  const gone = await deleteChat(req.user!.id, String(req.params.id));
  if (!gone) {
    res.status(404).json({ error: 'not_found', message: 'That conversation is not there.' });
    return;
  }
  res.json({ ok: true });
});

// DELETE /api/ai/chats/:id/from/:messageId
//
// Editing a question, or asking again: the old question, the answer it
// got and anything after it go, and what comes next takes their place.
router.delete('/chats/:id/from/:messageId', async (req: AuthRequest, res: Response) => {
  const removed = await truncateFrom(req.user!.id, String(req.params.id), String(req.params.messageId));
  res.json({ removed });
});

// GET /api/ai/context
//
// What the assistant would be told about the portfolio. It is shown in the
// page header so the person can see the assistant is looking at their real
// figures — and, once a model is answering, so a wrong answer can be traced
// to what it was given.
router.get('/context', async (req: AuthRequest, res: Response) => {
  // Every account, demo included. This endpoint exists to show what the
  // assistant is looking at, and the assistant is given the demo ones too —
  // marked as practice money, because demo is where orders get tried out.
  // Hiding them here made it a picture of something nobody is looking at.
  const accounts = runtimeStore.getAccountsByUser(req.user!.id);

  const openOrders = accounts.flatMap(a =>
    (a.orders ?? []).map(o => ({ ...o, account: a.name, currency: a.currency })));

  const losing = openOrders.filter(o => (o.profit ?? 0) < 0);
  const noStop = openOrders.filter(o => !o.sl);

  const since = new Date(Date.now() - 30 * 864e5);
  const closed = await prisma.closedTrade.count({
    where: { userId: req.user!.id, closeTime: { gte: since } },
  });

  res.json({
    accounts: accounts.length,
    online: accounts.filter(a => a.status === 'online').length,
    openOrders: openOrders.length,
    losingOrders: losing.length,
    ordersWithoutStop: noStop.length,
    floating: Number(accounts.reduce((sum, a) => sum + (a.profit ?? 0), 0).toFixed(2)),
    todayPnl: Number(accounts.reduce((sum, a) => sum + (a.todayPnl ?? 0), 0).toFixed(2)),
    closedTrades30d: closed,
  });
});

/**
 * What a question may carry with it.
 *
 * Photos arrive as data URLs, which is the shape every vision API takes, and
 * are never written to disk: a picture of somebody's account goes with the
 * question and lives only in that conversation. The limits are here rather
 * than at the model because an oversized request should be refused by us,
 * cheaply, and because a browser is not a thing to be trusted about size.
 */
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;   // after the browser has shrunk it

const checkImages = (raw: unknown): { images: string[] } | { error: string } => {
  if (raw == null) return { images: [] };
  if (!Array.isArray(raw)) return { error: 'images must be a list' };
  if (raw.length > MAX_IMAGES) return { error: `At most ${MAX_IMAGES} photos per question` };

  const images: string[] = [];
  for (const one of raw) {
    if (typeof one !== 'string') return { error: 'each photo must be a data URL' };
    if (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(one)) {
      return { error: 'photos must be PNG, JPEG, WebP or GIF data URLs' };
    }
    const bytes = Math.round((one.length - one.indexOf(',') - 1) * 0.75);
    if (bytes > MAX_IMAGE_BYTES) return { error: 'that photo is too large — 3MB each is the limit' };
    images.push(one);
  }
  return { images };
};

// POST /api/ai/chat
router.post('/chat', chatLimiter, async (req: AuthRequest, res: Response) => {
  const body = req.body as {
    message?: unknown; images?: unknown; history?: unknown; language?: unknown; chatId?: unknown;
  };

  const checked = checkImages(body.images);
  if ('error' in checked) {
    res.status(400).json({ error: 'bad_images', message: checked.error });
    return;
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message && checked.images.length === 0) {
    res.status(400).json({ error: 'empty', message: 'Ask something, or attach a photo.' });
    return;
  }
  if (message.length > 4000) {
    res.status(400).json({ error: 'too_long', message: 'That question is too long — 4000 characters is the limit.' });
    return;
  }

  // Who may ask, and how often. Checked before the portfolio is built and
  // long before the provider is called: a refusal should cost nothing.
  const allowed = await mayAsk(req.user!.id);
  if (!allowed.ok) {
    res.status(allowed.code === 'ai_off' ? 403 : 429).json({
      error: allowed.code,
      message: allowed.message,
      ...(allowed.limit !== undefined && { used: allowed.used, limit: allowed.limit }),
    });
    return;
  }

  const ai = await resolveAi();
  if (!isReady(ai)) {
    res.status(503).json({
      error: 'not_configured',
      message: 'No AI provider is connected yet. An admin can add one in Settings → AI.',
    });
    return;
  }

  // The conversation so far comes from the browser, which holds it. Only
  // the text: old photos are not sent again, since paying to re-read them
  // on every turn is how a chat gets expensive.
  const history: AiTurn[] = Array.isArray(body.history)
    ? (body.history as unknown[])
        .filter((h): h is { role: string; text: string } =>
          !!h && typeof h === 'object' && typeof (h as { text?: unknown }).text === 'string')
        .slice(-MAX_HISTORY_TURNS)
        .map(h => ({
          role: h.role === 'assistant' ? 'assistant' : 'user',
          text: String(h.text).slice(0, 4000),
        }))
    : [];

  const language = body.language === 'th' ? 'th' : 'en';

  try {
    const context = await buildPortfolioContext(req.user!.id);
    const turns: AiTurn[] = [
      ...history,
      { role: 'user', text: message || '(the photo is the question)', images: checked.images },
    ];

    const started = Date.now();
    const answer = await askModel(systemPrompt(context.text, language, await memoryText(req.user!.id)), turns, ai);
    const ms = Date.now() - started;

    console.log(
      `[AI] ${ai.provider}/${ai.model} answered ${req.user!.email} in ${ms}ms ` +
      `(${answer.inputTokens ?? '?'} in, ${answer.outputTokens ?? '?'} out, ` +
      `${context.accounts} accounts, ${context.openOrders} open, ${checked.images.length} photo(s))`,
    );
    await recordAsk(req.user!.id, answer.inputTokens ?? 0, answer.outputTokens ?? 0);
    logAudit(req.user!.id, 'ai_chat', 'ai', undefined,
      JSON.stringify({ chars: message.length, images: checked.images.length, inputTokens: answer.inputTokens, outputTokens: answer.outputTokens }));

    if (!answer.text) {
      res.status(502).json({ error: 'empty_answer', message: 'The model answered with nothing. Try asking again.' });
      return;
    }

    // Written once the answer exists: a question stored on its own would
    // come back tomorrow as a conversation that stops mid-sentence.
    let saved: { chatId: string; questionId: string; answerId: string; at: Date } | null = null;
    try {
      saved = await saveTurn(req.user!.id, typeof body.chatId === 'string' ? body.chatId : null, {
        question: message,
        photos: checked.images.length,
        answer: answer.text,
        model: ai.model,
      });
    } catch (err) {
      // The answer is worth more than the record of it.
      console.error('[AI] could not save the conversation:', err instanceof Error ? err.message : err);
    }

    res.json({
      reply: answer.text,
      model: ai.model,
      tokens: { in: answer.inputTokens, out: answer.outputTokens },
      ...(saved && {
        chatId: saved.chatId,
        questionId: saved.questionId,
        answerId: saved.answerId,
        at: saved.at,
      }),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[AI] failed for ${req.user!.email}: ${detail}`);

    // The provider's status code is the useful part: a key that is wrong,
    // a bill unpaid and a model that does not exist all look the same
    // otherwise, and each needs a different thing done about it.
    res.status(502).json({
      error: 'provider_failed',
      message: explainProviderError(detail, (await resolveAi()).model),
      detail: detail.slice(0, 200),
    });
  }
});

export default router;
