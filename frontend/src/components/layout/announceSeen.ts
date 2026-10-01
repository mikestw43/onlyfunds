import { useEffect, useState } from 'react';

/**
 * When this browser last looked at the announcements.
 *
 * Kept here rather than on the server: when somebody glanced at a notice
 * is not the server's business, and a count that followed them between
 * devices would surprise more than it helped. The same choice the
 * notification bell already makes.
 */
const LS_KEY = 'announce_last_seen';
const EVENT = 'announce-seen';

export const lastSeen = (): number => {
  try {
    return parseInt(localStorage.getItem(LS_KEY) || '0', 10) || 0;
  } catch {
    // Private windows and blocked site data: everything reads as unread,
    // which is the harmless direction.
    return 0;
  }
};

/** Called by the page once the notices are on screen. */
export const markAnnouncementsSeen = (): void => {
  try {
    localStorage.setItem(LS_KEY, Date.now().toString());
  } catch { /* nothing to remember it with; the mark simply stays */ }
  window.dispatchEvent(new Event(EVENT));
};

/** The stamp, re-read whenever the page clears it, so the count drops
 *  without a reload. */
export const useLastSeen = (): number => {
  const [seen, setSeen] = useState(lastSeen);
  useEffect(() => {
    const onSeen = () => setSeen(lastSeen());
    window.addEventListener(EVENT, onSeen);
    return () => window.removeEventListener(EVENT, onSeen);
  }, []);
  return seen;
};
