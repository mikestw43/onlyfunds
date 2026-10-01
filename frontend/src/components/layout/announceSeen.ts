import { useEffect, useState } from 'react';

/**
 * Which notices this browser has already been shown.
 *
 * By id, not by time. The first version remembered "last looked at" as a
 * moment and counted anything newer as unread — comparing a timestamp the
 * server wrote against Date.now() in the browser. Those are two different
 * clocks. A server a few seconds ahead stamps a notice into the future, so
 * the moment it is posted it is already newer than "now", and it stays
 * unread however many times it is read. Posting two in a row then leaves
 * the count stuck at one: marking the second as seen finally covers the
 * first, and the second takes its place.
 *
 * An id is an id on both machines. Nothing to synchronise and nothing to
 * get wrong.
 *
 * Kept in the browser rather than on the server, like the notification
 * bell's: when somebody glanced at a notice is not the server's business,
 * and a count that followed them between devices would surprise more than
 * it would help.
 */
const LS_KEY = 'announce_seen_ids';
const EVENT = 'announce-seen';
/** Far more than the hundred the server will ever return. */
const KEEP = 500;

export const seenIds = (): Set<string> => {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw.filter(x => typeof x === 'string') : []);
  } catch {
    // Private windows, blocked site data, or something else's key in the
    // way. Everything reads as unread, which is the harmless direction.
    return new Set();
  }
};

/** Called by the page with whatever it has just put on screen. */
export const markAnnouncementsSeen = (ids: string[]): void => {
  if (ids.length === 0) return;
  try {
    const kept = [...seenIds(), ...ids];
    // Oldest first, so trimming drops the ones least likely to still be
    // on the list the server hands back.
    localStorage.setItem(LS_KEY, JSON.stringify([...new Set(kept)].slice(-KEEP)));
  } catch { /* nothing to remember it with; the mark simply stays */ }
  window.dispatchEvent(new Event(EVENT));
};

/**
 * Notices this reader has cleared out of their own panel.
 *
 * Separate from deleting, which is the admin's and removes it for
 * everybody. Clearing is one person tidying their own list: the notice
 * stays on the admin page and on everyone else's panel, and anything
 * posted afterwards still arrives.
 */
const CLEARED_KEY = 'announce_cleared_ids';

export const clearedIds = (): Set<string> => {
  try {
    const raw = JSON.parse(localStorage.getItem(CLEARED_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw.filter(x => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
};

/** Hide these from this browser's panel, and count them as read with it. */
export const clearAnnouncements = (ids: string[]): void => {
  if (ids.length === 0) return;
  try {
    const kept = [...clearedIds(), ...ids];
    localStorage.setItem(CLEARED_KEY, JSON.stringify([...new Set(kept)].slice(-KEEP)));
  } catch { /* nothing to remember it with */ }
  markAnnouncementsSeen(ids);
};

/** Re-read whenever the page marks something, so the count drops without
 *  a reload. */
export const useSeenIds = (): Set<string> => {
  const [seen, setSeen] = useState(seenIds);
  useEffect(() => {
    const onSeen = () => setSeen(seenIds());
    window.addEventListener(EVENT, onSeen);
    return () => window.removeEventListener(EVENT, onSeen);
  }, []);
  return seen;
};

/** The same, for what has been cleared away. */
export const useClearedIds = (): Set<string> => {
  const [cleared, setCleared] = useState(clearedIds);
  useEffect(() => {
    const onSeen = () => setCleared(clearedIds());
    window.addEventListener(EVENT, onSeen);
    return () => window.removeEventListener(EVENT, onSeen);
  }, []);
  return cleared;
};
