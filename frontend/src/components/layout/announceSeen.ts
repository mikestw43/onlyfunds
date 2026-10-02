import { markAnnouncementsSeen, clearAnnouncementsForMe } from '../../services/api';

/**
 * Handing this browser's own read marks over to the server, once.
 *
 * Which notices had been read, and which had been tidied away, used to be
 * kept in localStorage. That made "read" mean "read on this device": the
 * same notice still carried a mark on the phone after being read at the
 * desk, and clearing the panel on one device left it full on the other.
 * The server keeps it per person now.
 *
 * Nobody should have to re-read what they have already read to get there,
 * so the first load after the change posts whatever this browser
 * remembered and leaves a flag behind. The old keys are then removed —
 * they are nobody's source of truth any more, and leaving them would have
 * them silently diverge.
 */
const SEEN_KEY = 'announce_seen_ids';
const CLEARED_KEY = 'announce_cleared_ids';
const DONE_KEY = 'announce_read_state_handed_over';

const idsIn = (key: string): string[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    // A private window, blocked site data, or something else's key in the
    // way. Nothing to hand over, which is the harmless direction.
    return [];
  }
};

/**
 * Returns true when something was sent, so the caller knows to refetch.
 * A failure leaves the flag unset and the keys in place: the next load
 * tries again rather than losing the marks.
 */
export const handOverLocalReadState = async (): Promise<boolean> => {
  let done = false;
  try {
    done = localStorage.getItem(DONE_KEY) === '1';
  } catch {
    return false;
  }
  if (done) return false;

  const seen = idsIn(SEEN_KEY);
  const cleared = idsIn(CLEARED_KEY);

  try {
    // Cleared first: it implies seen, and the server records both from
    // the one call, so a failure in between cannot leave a notice cleared
    // but unread.
    await clearAnnouncementsForMe(cleared);
    await markAnnouncementsSeen(seen);
  } catch {
    return false;
  }

  try {
    localStorage.setItem(DONE_KEY, '1');
    localStorage.removeItem(SEEN_KEY);
    localStorage.removeItem(CLEARED_KEY);
  } catch { /* the flag is a convenience; sending again is harmless */ }

  return seen.length > 0 || cleared.length > 0;
};
