import prisma from '../lib/prisma';
import { runtimeStore } from './runtimeStore';
import { toUsd } from './fxService';

/**
 * What the assistant is told about the portfolio before it answers.
 *
 * Written as text rather than JSON because that is what a model reads best,
 * and because the same text is what the person sees if they ask what it can
 * see. Two rules shape it:
 *
 *   Everything here is this user's own. Every query filters on their id —
 *   the assistant cannot be talked into looking at another account.
 *
 *   It is a summary, not a dump. This portfolio closes about 6,750 trades a
 *   month; sending them all would cost a fortune per question and bury the
 *   answer. Open positions go in one by one, because those are what get
 *   asked about; history goes in as figures per symbol.
 *
 * Money is stated in the account's own currency, and a cent account (USC)
 * is marked as such, because 1,410,798 on one of those is $14,107 and an
 * assistant that misses the difference gives frightening advice.
 */

const money = (n: number, currency: string): string =>
  `${n < 0 ? '-' : ''}${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${currency}`;

const hoursSince = (t: string | Date): number =>
  Math.max(0, Math.round((Date.now() - new Date(t).getTime()) / 36e5));

/** The shape EA v1.4 sends, as stored on the account. */
interface SpecRow {
  symbol: string; bid: number; ask: number; digits: number; point: number;
  contractSize: number; tickValue: number; tickSize: number;
  volMin: number; volMax: number; volStep: number; stopsLevel: number; atr14: number;
}

export interface PortfolioContext {
  text: string;
  /** For the page: what it was built from, in numbers. */
  accounts: number;
  openOrders: number;
}

export const buildPortfolioContext = async (userId: string): Promise<PortfolioContext> => {
  // Demo accounts are in, marked as such. They were left out when the
  // assistant could only talk: now that it can draft an order for the
  // person to confirm, the practice account is exactly where that should
  // be tried first.
  const accounts = runtimeStore.getAccountsByUser(userId);
  const lines: string[] = [];

  lines.push(`Now: ${new Date().toISOString()} (UTC).`);
  lines.push('');

  // ── The accounts themselves ────────────────────────────────────────────
  let totalUsd = 0;
  lines.push('ACCOUNTS');
  for (const a of accounts) {
    const cur = a.currency || 'USD';
    const cents = cur.toUpperCase() === 'USC';
    totalUsd += toUsd(a.equity ?? 0, cur);
    lines.push(
      `- ${a.name} (#${a.accountNumber}, ${a.broker}, ${cur}${cents ? ' — cent account, 100 units = 1 USD' : ''}` +
      `${a.isDemo ? ', DEMO — practice money' : ''}, ${a.status}): ` +
      `balance ${money(a.balance ?? 0, cur)}, equity ${money(a.equity ?? 0, cur)}, ` +
      `floating ${money(a.profit ?? 0, cur)}, today ${a.todayPnl != null ? money(a.todayPnl, cur) : 'unknown'}, ` +
      `drawdown ${(a.drawdown ?? 0).toFixed(1)}%, free margin ${money(a.freeMargin ?? 0, cur)}, ` +
      `margin level ${(a.marginLevel ?? 0).toFixed(0)}%, open lots ${(a.openLots ?? 0).toFixed(2)}`,
    );
  }
  lines.push(`Total equity across accounts, converted: ${totalUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })} USD`);
  lines.push('');

  // ── Open positions, one by one ─────────────────────────────────────────
  const open = accounts.flatMap(a => (a.orders ?? []).map(o => ({ ...o, account: a.name, currency: a.currency || 'USD' })));

  /**
   * Lots added up here, in code, before the positions are listed.
   *
   * A language model does arithmetic by pattern, not by adding, and a
   * column of eighteen lot sizes with decimals in it is exactly where that
   * breaks: asked for the sell side of one symbol it answered sixty lots
   * high, and when told the number was wrong it "recalculated" to the
   * figure it had just been given — same list, same order, no working, a
   * different total. That is worse than the first error, because it means
   * being corrected cannot be trusted to fix it either.
   *
   * None of it was necessary. The server already adds these up for the
   * dashboard; it simply never told the assistant, so the assistant was
   * left to do by hand the one job it is worst at while the exact answer
   * sat one line away. Now it is handed the total and told not to add.
   *
   * Counted over every position, including any the list below truncates.
   */
  interface Tally { buy: number; sell: number; nBuy: number; nSell: number }
  const blank = (): Tally => ({ buy: 0, sell: 0, nBuy: 0, nSell: 0 });
  const add = (t: Tally, type: string, lots: number): void => {
    if (type === 'SELL') { t.sell += lots; t.nSell += 1; } else { t.buy += lots; t.nBuy += 1; }
  };
  /** buy 365.27 (16) · sell 355.27 (18) · net long 10.00 */
  const say = (t: Tally): string => {
    const net = t.buy - t.sell;
    const side = Math.abs(net) < 0.005 ? 'flat' : net > 0 ? `net long ${net.toFixed(2)}` : `net short ${(-net).toFixed(2)}`;
    return `buy ${t.buy.toFixed(2)} (${t.nBuy} ${t.nBuy === 1 ? 'position' : 'positions'}) · ` +
           `sell ${t.sell.toFixed(2)} (${t.nSell} ${t.nSell === 1 ? 'position' : 'positions'}) · ${side}`;
  };

  const tallied = accounts
    .map(a => {
      const orders = a.orders ?? [];
      const whole = blank();
      const bySymbol = new Map<string, Tally>();
      for (const o of orders) {
        const lots = typeof o.lots === 'number' && Number.isFinite(o.lots) ? o.lots : 0;
        add(whole, o.type, lots);
        if (!bySymbol.has(o.symbol)) bySymbol.set(o.symbol, blank());
        add(bySymbol.get(o.symbol)!, o.type, lots);
      }
      return { a, orders, whole, bySymbol };
    })
    .filter(x => x.orders.length > 0);

  if (tallied.length > 0) {
    lines.push('LOT TOTALS, ADDED UP BY THE SERVER');
    for (const { a, orders, whole, bySymbol } of tallied) {
      lines.push(`- ${a.name} (#${a.accountNumber}): ${orders.length} open, ${say(whole)}`);
      // One symbol means the account line already said it.
      if (bySymbol.size > 1) {
        const rows = [...bySymbol.entries()].sort((x, y) => (y[1].buy + y[1].sell) - (x[1].buy + x[1].sell));
        for (const [symbol, t] of rows.slice(0, 12)) {
          lines.push(`    ${symbol}: ${t.nBuy + t.nSell} open, ${say(t)}`);
        }
        if (rows.length > 12) lines.push(`    (${rows.length - 12} smaller symbols not broken out)`);
      }
    }
    lines.push(
      'These were added up in code over every position, including any the list below leaves out. ' +
      'Use them. Never add lot sizes up yourself — that is the one thing you reliably get wrong, ' +
      'and a wrong exposure figure here is money. If a total someone asks for is not in this block, ' +
      'say it is not there rather than working it out from the positions.');
    lines.push(
      'If they tell you a total of yours is wrong, do not simply adopt their number and call it a ' +
      'correction. Read this block again and say what it actually says — name the account and ' +
      'symbol you read it from. If it agrees with them, say so. If it does not, say that instead, ' +
      'and let them tell you which positions they were counting.');
    lines.push('');
  }

  lines.push(`OPEN POSITIONS (${open.length})`);
  if (open.length === 0) lines.push('- none');
  for (const o of open.slice(0, 60)) {
    lines.push(
      `- #${o.ticket} ${o.symbol} ${o.type} ${o.lots} lots on ${o.account}: ` +
      `open ${o.openPrice}, now ${o.currentPrice}, P/L ${money(o.profit ?? 0, o.currency)}` +
      `${o.swap ? `, swap ${money(o.swap, o.currency)}` : ''}, ` +
      `SL ${o.sl || 'none'}, TP ${o.tp || 'none'}, open for ${hoursSince(o.openTime)}h`,
    );
  }
  if (open.length > 60) lines.push(`- (${open.length - 60} more not listed)`);
  if (open.length > 0) {
    lines.push(
      'Every "now" above came from the EA\'s last ordinary push, which it sends every two ' +
      'seconds while the account is online. For a symbol held open, that is the freshest ' +
      'price this app has — fresher than the bid and ask further down.');
  }
  lines.push('');

  const pending = accounts.flatMap(a => (a.pending ?? []).map(o => ({ ...o, account: a.name })));
  if (pending.length > 0) {
    lines.push(`PENDING ORDERS (${pending.length})`);
    for (const o of pending.slice(0, 30)) {
      lines.push(`- #${o.ticket} ${o.symbol} ${o.type} ${o.lots} lots at ${o.openPrice} on ${o.account}`);
    }
    lines.push('');
  }

  // ── What a lot is actually worth ───────────────────────────────────────
  //
  // Without these the assistant is guessing at position size, and a guess
  // about lots is worse than no answer at all. They arrive from EA v1.4.
  const withSpecs = await prisma.account.findMany({
    where: { userId },
    select: { id: true, name: true, accountNumber: true, currency: true, specs: true, specsAt: true },
  });

  /**
   * The newest price this app holds for a symbol, account by account.
   *
   * Two feeds carry a price and they do not arrive at the same rate. The
   * specs below are pushed once a minute; an open position's currentPrice
   * rides the ordinary two-second push. So for any symbol the person
   * actually holds there were two numbers for the same thing, as much as a
   * minute apart, and nothing in this text said which one to believe. While
   * the market is quiet they agree and it does not matter. While it runs
   * they do not, and the model was left to choose — the same silence that
   * let it answer once with an entry price no one had quoted.
   *
   * Only an account the EA is still pushing counts. Status turns offline
   * after thirty seconds without a push, so online means this number is
   * seconds old, not hours.
   */
  const heldPrice = new Map<string, number>();
  for (const a of accounts) {
    if (a.status !== 'online') continue;
    for (const o of a.orders ?? []) {
      if (typeof o.currentPrice === 'number' && o.currentPrice > 0) heldPrice.set(`${a.id}|${o.symbol}`, o.currentPrice);
    }
  }

  const specLines: string[] = [];
  /** True where any account's quotes have gone quiet long enough to distrust. */
  let anyStale = false;
  /** True once any symbol line carries a seconds-old price to prefer. */
  let anyHeld = false;

  for (const a of withSpecs) {
    const specs = Array.isArray(a.specs) ? (a.specs as unknown as SpecRow[]) : [];
    if (specs.length === 0) continue;
    const cur = a.currency || 'USD';

    /**
     * How old these quotes are.
     *
     * The EA sends them every few minutes, so they are a snapshot, never
     * the tick. Handing over a bid and an ask with no date on them invites
     * exactly one mistake — treating a price from an hour ago as the price
     * now — and the cost of that mistake is a stop placed on the wrong
     * side of the market and an order the broker refuses.
     */
    const mins = a.specsAt ? Math.round((Date.now() - new Date(a.specsAt).getTime()) / 60000) : null;
    const age = mins == null ? 'age unknown'
      : mins <= 1 ? 'quoted just now'
      : `quoted ${mins} minutes ago`;
    if (mins == null || mins > 15) anyStale = true;

    for (const sp of specs.slice(0, 25)) {
      const perLot = sp.tickSize > 0 ? sp.tickValue / sp.tickSize : 0;
      // Said here rather than left for the model to find in the positions
      // list above: this is the line it reads when it wants a price.
      const held = heldPrice.get(`${a.id}|${sp.symbol}`);
      if (held != null) anyHeld = true;
      specLines.push(
        `- ${sp.symbol} on ${a.name} (#${a.accountNumber}): bid ${sp.bid}, ask ${sp.ask}, ` +
        `1 lot = ${sp.contractSize} units, moving 1.0 in price = ${perLot.toFixed(2)} ${cur} per lot, ` +
        `lots ${sp.volMin}–${sp.volMax} in steps of ${sp.volStep}, ` +
        `broker's minimum stop ${sp.stopsLevel} points (1 point = ${sp.point}), ` +
        `ATR over 14 days ${sp.atr14}, ${age}` +
        (held != null ? `, PRICE NOW ${held} (seconds old, off an open position on this symbol)` : ''),
      );
    }
  }

  if (specLines.length > 0) {
    lines.push('SYMBOL FACTS, FROM THE TERMINAL');
    lines.push(...specLines);
    lines.push('Risk on one order = (distance from entry to stop) ÷ 1.0 × (that symbol\'s money per lot) × lots.');
    lines.push('Use these numbers. Do not use remembered contract sizes — this broker\'s may differ.');
    lines.push(
      'Each bid and ask above is a snapshot from the EA\'s last push, not the tick. It is ' +
      'good enough to size a position and to say how far a stop is; it is not the price an ' +
      'order will fill at. Never call one "the current price" without saying when it was quoted.');
    if (anyHeld) {
      lines.push(
        'WHERE A LINE CARRIES "PRICE NOW", that is the current price of that symbol, seconds ' +
        'old, and the bid and ask in front of it are up to a minute behind it. Quote PRICE NOW, ' +
        'size from PRICE NOW, and keep the bid and ask for the spread, the point size and the ' +
        'money per lot. A symbol with no PRICE NOW has only the bid and ask, at their stated age.');
    }
    if (anyStale) {
      lines.push(
        'SOME OF THOSE QUOTES ARE OLD (over fifteen minutes, or undated). Treat those symbols ' +
        'as having no price: say the EA has gone quiet and ask, rather than working a stop out ' +
        'from a number the market has left behind. A symbol carrying PRICE NOW is not one of ' +
        'them — that price is good.');
    }
    lines.push('');
  } else {
    lines.push('SYMBOL FACTS: none yet. The EA sends them a few minutes after starting (v1.4 and up).');
    lines.push('Without them you cannot work out what a lot is worth: say so rather than estimating.');
    lines.push('');
  }

  // ── History, as figures ────────────────────────────────────────────────
  const since = new Date(Date.now() - 30 * 864e5);
  const closed = await prisma.closedTrade.findMany({
    where: { userId, closeTime: { gte: since } },
    select: { symbol: true, type: true, lots: true, profit: true, swap: true, commission: true, closeTime: true, accountCurrency: true },
  });

  lines.push(`CLOSED TRADES, LAST 30 DAYS (${closed.length})`);
  if (closed.length === 0) {
    lines.push('- none recorded');
  } else {
    const bySymbol = new Map<string, { n: number; wins: number; net: number; lots: number; currency: string }>();
    for (const c of closed) {
      const net = (c.profit ?? 0) + (c.swap ?? 0) + (c.commission ?? 0);
      const row = bySymbol.get(c.symbol) ?? { n: 0, wins: 0, net: 0, lots: 0, currency: c.accountCurrency || 'USD' };
      row.n += 1;
      row.wins += net > 0 ? 1 : 0;
      row.net += net;
      row.lots += c.lots ?? 0;
      bySymbol.set(c.symbol, row);
    }
    const rows = [...bySymbol.entries()].sort((a, b) => Math.abs(b[1].net) - Math.abs(a[1].net));
    for (const [symbol, r] of rows.slice(0, 20)) {
      lines.push(
        `- ${symbol}: ${r.n} trades, ${Math.round((r.wins / r.n) * 100)}% won, ` +
        `net ${money(Number(r.net.toFixed(2)), r.currency)}, ${r.lots.toFixed(2)} lots traded`,
      );
    }
  }
  lines.push('');

  // MT5's own daily figures, which are the authority on a finished day.
  const daily = await prisma.dailyPnl.findMany({
    where: { userId, brokerDate: { gte: new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10) } },
    orderBy: { brokerDate: 'desc' },
    take: 40,
  });
  if (daily.length > 0) {
    lines.push('DAILY P/L FROM MT5, LAST 14 DAYS (the broker\'s own figures)');
    for (const d of daily) {
      lines.push(`- ${d.brokerDate} ${d.accountName ?? ''}: ${money(d.netProfit, d.accountCurrency || 'USD')} over ${d.deals} deals`);
    }
    lines.push('');
  }

  return { text: lines.join('\n'), accounts: accounts.length, openOrders: open.length };
};
