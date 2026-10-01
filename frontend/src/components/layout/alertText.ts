/**
 * Turning a stored alert into something readable on screen.
 *
 * Alerts are written for Telegram and kept exactly as they were sent, so
 * what the log holds is Telegram's HTML: literal <b> tags, a leading
 * "[OnlyFunds]" that was the message's heading, and one fact per line.
 * Printed straight into the panel that read as
 *
 *   [OnlyFunds] ⚠️ <b>DRAWDOWN ALERT</b> Account: <b>HoldBro</b> …
 *
 * which is markup, a sender's name and three labels in front of the two
 * numbers anybody actually wants.
 *
 * The rewriting is deliberately forgiving. Every message the server sends
 * has the same shape — a headline, "Account: name", then measurements —
 * but a message that does not is still shown, with its tags gone, rather
 * than dropped or mangled. Nothing here invents or rounds a figure: the
 * numbers are the ones that were sent, only with thousands separated.
 */

export interface AlertText {
  /** The account, when the message names one. */
  account: string | null;
  /** What was measured, lowercase: "drawdown", "margin level". */
  label: string;
  /** The reading. Null when the message has no number in it. */
  value: string | null;
  /** The threshold and anything else, already joined. */
  detail: string;
  /** Everything, tags removed — shown when the shape is not recognised. */
  plain: string;
}

/** 1071839.17 reads as a number; 1,071,839.17 reads as money. */
const separate = (text: string): string =>
  text.replace(/\$\s?(\d{4,})(\.\d+)?/g, (_m, whole: string, frac = '') =>
    '$' + Number(whole).toLocaleString('en-US') + frac);

const clean = (raw: string): string[] =>
  raw
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    // The heading the message was sent under. Inside the dashboard it is
    // saying the dashboard's name to the dashboard.
    .replace(/^\s*\[[^\]]*\]\s*/, '')
    .split('\n').map(l => l.trim()).filter(Boolean);

export const readAlert = (raw: string): AlertText => {
  const lines = clean(raw).map(separate);
  const plain = lines.join(' · ');
  if (lines.length === 0) return { account: null, label: '', value: null, detail: '', plain: '' };

  // The headline, without the emoji in front of it. The chip beside it
  // already says which kind of alert this is.
  const headline = lines[0].replace(/^[^A-Za-z฀-๿]+/, '').trim();

  const accountLine = lines.find(l => /^Account:/i.test(l));
  const account = accountLine ? accountLine.replace(/^Account:\s*/i, '').trim() : null;
  const rest = lines.slice(1).filter(l => l !== accountLine);

  // "Drawdown: 78.49% (threshold: 50%)" — the first measurement is the one
  // that caused the alert, so it goes on the line that gets read.
  const first = rest[0] ?? '';
  const m = first.match(/^([^:]+):\s*([^(]+?)\s*(?:\(threshold:\s*([^)]*)\))?$/i);

  if (!account || !m) {
    // No measurement to lead with, so the headline does — minus the word
    // "alert", which the chip beside it already says.
    const bare = headline.replace(/\s*alert\s*$/i, '').toLowerCase();
    return { account, label: bare, value: null, detail: rest.join(' · '), plain };
  }

  const label = m[1].trim().toLowerCase();
  const value = m[2].trim();
  const limit = m[3]?.trim();

  const detail = [
    limit ? `Limit ${limit}` : null,
    // "Equity: $1,071,839.17" → "equity $1,071,839.17"
    ...rest.slice(1).map(l => l.replace(/^([^:]+):\s*/, (_x, k: string) => `${k.toLowerCase()} `)),
  ].filter(Boolean).join(' · ');

  return { account, label, value, detail, plain };
};
