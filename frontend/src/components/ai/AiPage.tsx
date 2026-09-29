import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { askAi, fetchAiContext, fetchAiStatus, type AiContext, type AiStatus, fetchAiChats, fetchAiChat, deleteAiChat, truncateAiChat,
  type AiChatSummary, fetchAccounts } from '../../services/api';
import type { Account, Order } from '../../types';
import { useTranslation } from '../../i18n/useTranslation';
import { useUIStore } from '../../stores/uiStore';
import { useAccountStore } from '../../stores/accountStore';
import { IconSpark, IconMic, IconPlus, IconCopy, IconRetry, IconPencil, IconArrowUp,
  IconBolt, IconSummary, IconShield, IconShieldOff, IconScale, IconTrendDown,
  IconTrendUp, IconBreakEven, IconHalf } from '../icons';
import { prepareImage } from '../../utils/imagePrep';
import { useDictation } from '../../hooks/useDictation';
import { RichText } from './RichText';
import { readPlan, readMemoryOffer, OrderDraftCard } from './OrderDraft';
import { MemoryOffer } from './MemoryOffer';

/**
 * The assistant's room.
 *
 * The screens go in before any model does, so this page has to be honest
 * about that: it asks the server whether a provider is connected and says so
 * in the one place a person would look for an answer, rather than letting
 * the first question fail with a red toast.
 *
 * The screen is mostly the conversation. Everything that is true whether or
 * not anyone is talking — what the assistant can see, whether it is
 * connected, what it cannot do — is one line at the top that opens when
 * tapped. The first version put all of it on the page at once, and the
 * conversation started halfway down.
 *
 * It is a sheet over the page rather than a page of its own, and it closes
 * by being pushed down. The first version put a BACK button in the top left
 * corner — the one place a thumb cannot reach on a phone held in one hand,
 * which is how this app is mostly used. Dragging the handle, flicking it
 * down, tapping the dimmed page behind it and Escape all close it.
 */

/**
 * Whether the last conversation has already been fetched.
 *
 * Opening the assistant should show what was being talked about, not an
 * empty room — but only the first time it is opened. After NEW CHAT, an
 * empty room is exactly what was asked for, and re-opening the sheet must
 * not undo that. It lives outside the component because the sheet is
 * unmounted every time it closes.
 */
let pickedUpWhereWeLeftOff = false;

/** The time of day, in figures, which reads the same in both languages. */
const clock = (ms: number): string =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

/** When a past conversation was last touched: the time if that was today,
 *  the date if it was not. */
const when = (iso: string): string => {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.getDate() === today.getDate()
    && d.getMonth() === today.getMonth()
    && d.getFullYear() === today.getFullYear();
  return sameDay ? clock(d.getTime()) : d.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
};

/**
 * What is left of the screen above the sheet: the strip the clock and the
 * battery live in, plus a little, so the sheet clears them and there is
 * still somewhere to tap to close.
 *
 * The strip is measured rather than guessed — it is 0 on a phone with no
 * notch, and about 59 on one with, and a number typed here would be wrong
 * on one of them.
 */
const topGap = (): number => {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  const inset = probe.getBoundingClientRect().height;
  probe.remove();
  return Math.max(24, Math.round(inset) + 8);
};

export const AiSheet = () => {
  const t = useTranslation();
  const addToast = useUIStore(st => st.addToast);
  const open = useUIStore(st => st.aiOpen);
  const setOpen = useUIStore(st => st.setAiOpen);
  const language = useUIStore(st => st.language);
  const mic = useDictation(language);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [ctx, setCtx] = useState<AiContext | null>(null);
  const messages = useUIStore(st => st.aiMessages);
  const addMessage = useUIStore(st => st.addAiMessage);
  const clearMessages = useUIStore(st => st.clearAiMessages);
  const setMessages = useUIStore(st => st.setAiMessages);
  const truncateFrom = useUIStore(st => st.truncateAiFrom);
  const chatId = useUIStore(st => st.aiChatId);
  const setChatId = useUIStore(st => st.setAiChatId);
  const [draft, setDraft] = useState('');
  // Photos waiting to go with the next question, already shrunk.
  const [photos, setPhotos] = useState<{ dataUrl: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  // True while a Thai or other IME is mid-word: Enter there confirms the
  // word being composed and must not send the question.
  const [typing, setTyping] = useState(false);
  // The keyboard is up when the box has focus. visualViewport says so too,
  // but not on every iOS — a web app added to the home screen has been
  // known not to report the change at all. Focus is the signal the browser
  // cannot get wrong.
  const [writing, setWriting] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  /**
   * Typing "/" offers the accounts.
   *
   * Naming the account is not optional — the assistant is told never to
   * guess which one, so an unnamed order costs a round trip every time —
   * and the thing it wants is an account number nobody has memorised.
   * Picking it from a list is also the only way the spelling is certainly
   * right, which for the one field that decides where an order lands is
   * worth more than the keystrokes it saves.
   */
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [slash, setSlash] = useState<{ at: number; query: string } | null>(null);

  /**
   * Typing "@" offers the open positions.
   *
   * Half the commands worth giving name one — close half of it, move its
   * stop — and the assistant is told never to invent a ticket, so the
   * alternative was reading an eleven-digit number off a card and typing
   * it into a phone without a digit going astray. It is the same argument
   * as the account picker one step further in: the field that decides
   * which position gets closed is the last one to leave to memory.
   *
   * The live positions are in the dashboard's own store, put there by the
   * socket. /api/accounts reports `orders` as a count, so the list the
   * picker needs is not in what this page fetches for the "/" list.
   */
  const [at, setAt] = useState<{ at: number; query: string } | null>(null);
  const liveAccounts = useAccountStore(st => st.accounts);
  const [hi, setHi] = useState(0);
  // The question in flight, so STOP has something to cancel.
  const inflight = useRef<AbortController | null>(null);
  // Shown only once the conversation has been scrolled away from the end.
  const [awayFromEnd, setAwayFromEnd] = useState(false);
  // The list of past conversations, when it is open.
  const [chats, setChats] = useState<AiChatSummary[] | null>(null);
  const [loadingChat, setLoadingChat] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // How far the sheet has been pushed down, in px, while a finger is on it.
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);
  const startedAt = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);

  const close = () => { setDragY(0); setDragging(false); setOpen(false); };

  // What the microphone hears goes into the box, never straight out: this
  // box can open a trade, and saying something aloud is not the same as
  // meaning it. The person still presses send.
  useEffect(() => {
    if (!open) return;
    void fetchAccounts()
      .then((rows: Account[]) => setAccounts(Array.isArray(rows) ? rows : []))
      // The picker is a shortcut, not the way in: typing the name still
      // works, so a failure here goes no further than an absent list.
      .catch(() => setAccounts([]));
  }, [open]);

  useEffect(() => {
    if (mic.heard) setDraft(mic.heard);
  }, [mic.heard]);

  useEffect(() => {
    if (!mic.error) return;
    addToast({
      type: 'error',
      title: t('ai.title'),
      message: mic.error === 'denied' ? t('ai.mic_denied') : t('ai.mic_failed'),
    });
  }, [mic.error]);

  // Escape closes it, like any other overlay.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  /**
   * Push-down-to-close.
   *
   * A drag starts only when the conversation is already scrolled to the top,
   * or when the finger is on the handle — otherwise every attempt to scroll
   * the messages would drag the sheet instead. Past a third of the way down,
   * or on a quick flick, it closes; anything less springs back.
   */
  const onTouchStart = (e: React.TouchEvent, fromHandle = false) => {
    const touch = e.touches[0];
    if (!touch) return;
    const atTop = (scroller.current?.scrollTop ?? 0) <= 0;
    if (!fromHandle && !atTop) return;
    startY.current = touch.clientY;
    startedAt.current = Date.now();
    setDragging(true);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!dragging) return;
    const touch = e.touches[0];
    if (!touch) return;
    const dy = touch.clientY - startY.current;
    setDragY(dy > 0 ? dy : 0);
  };

  const onTouchEnd = () => {
    if (!dragging) return;
    const travelled = dragY;
    const ms = Math.max(1, Date.now() - startedAt.current);
    const speed = travelled / ms;           // px per millisecond

    // Two ways to mean it, and a short quick swipe is neither. The first
    // version closed on 60px in under 300ms, which is also what flicking
    // the conversation to scroll it feels like — so the sheet kept leaving
    // when the intent was to read. A throw now has to cover 140px as well
    // as be quick: distance is what separates "away with it" from a flick
    // of the wrist, and it is the part a thumb does on purpose.
    const deliberate = travelled > window.innerHeight * 0.3;
    const thrown = speed > 0.7 && travelled > 140;

    setDragging(false);
    if (deliberate || thrown) close();
    else setDragY(0);
  };

  useEffect(() => {
    let alive = true;
    fetchAiStatus().then(s => { if (alive) setStatus(s); }).catch(() => {});
    fetchAiContext().then(c => { if (alive) setCtx(c); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Carry on from the last conversation, once, if there is nothing on
  // screen to carry on from.
  useEffect(() => {
    if (pickedUpWhereWeLeftOff || messages.length > 0 || chatId) return;
    pickedUpWhereWeLeftOff = true;
    void (async () => {
      try {
        const [recent] = await fetchAiChats();
        if (recent) await openChat(recent.id);
      } catch { /* an empty room is a fine place to start */ }
    })();
  }, []);

  const toEnd = (behavior: ScrollBehavior = 'smooth') =>
    endRef.current?.scrollIntoView({ behavior, block: 'end' });

  // Following the conversation should not yank the page out from under
  // someone who has scrolled up to read an earlier answer. It follows when
  // they are at the end, and when the new message is their own.
  useEffect(() => {
    const mine = messages[messages.length - 1]?.who === 'me';
    if (mine || !awayFromEnd) toEnd();
  }, [messages.length]);

  /** How far from the bottom counts as "reading something else". */
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setAwayFromEnd(el.scrollHeight - el.scrollTop - el.clientHeight > 90);
  };

  /**
   * On a phone the keyboard does not resize the window, it covers it — so
   * a sheet that is 88% of the window ends up with its composer behind the
   * keys. visualViewport is the part still visible, and the sheet is sized
   * to that instead.
   */
  const [viewport, setViewport] = useState<{ height: number; top: number; keyboard: boolean; gap: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    // Only where it is a sheet held in a hand. On a desktop it is a panel
    // with its own height and no keyboard covering anything.
    const measure = () =>
      setViewport(window.matchMedia('(max-width: 900px)').matches
        ? {
            height: vv.height,
            top: vv.offsetTop,
            keyboard: window.innerHeight - vv.height > 120,
            gap: topGap(),
          }
        : null);
    measure();
    vv.addEventListener('resize', measure);
    vv.addEventListener('scroll', measure);
    return () => {
      vv.removeEventListener('resize', measure);
      vv.removeEventListener('scroll', measure);
    };
  }, []);

  // The box follows the text: measured from nothing each time, because a
  // textarea that has already grown reports its own height as the content
  // height and would never shrink again. An empty box is left at one row
  // rather than measured — measuring it measures the placeholder.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    if (draft === '') { box.style.height = ''; return; }
    box.style.height = 'auto';
    box.style.height = `${Math.min(box.scrollHeight, 132)}px`;
  }, [draft]);

  const MAX_PHOTOS = 4;

  const pickPhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) {
      addToast({ type: 'warning', title: t('ai.title'), message: t('ai.attach_limit') });
      return;
    }
    const chosen = Array.from(files).slice(0, room);
    for (const file of chosen) {
      try {
        const ready = await prepareImage(file);
        setPhotos(p => [...p, { dataUrl: ready.dataUrl, name: ready.name }]);
      } catch {
        addToast({ type: 'error', title: t('ai.title'), message: t('ai.attach_failed') });
      }
    }
  };

  const send = async (text: string) => {
    const question = text.trim();
    const attached = photos.map(p => p.dataUrl);
    // A photo on its own is a question — "what do you make of this?" — so
    // an empty box with a picture in it still sends.
    if ((!question && attached.length === 0) || busy) return;
    setDraft('');
    setSlash(null);
    setAt(null);
    setPhotos([]);
    // The composer holds focus through the tap so the button does not
    // move out from under the finger; once the question is away, the
    // keyboard has nothing left to do and the answer wants the room.
    boxRef.current?.blur();
    addMessage({ who: 'me', text: question, ...(attached.length ? { images: attached } : {}) });
    setBusy(true);
    try {
      const priorTurns = messages.map(m => ({
        role: (m.who === 'me' ? 'user' : 'assistant') as 'user' | 'assistant',
        text: m.text,
      }));
      const control = new AbortController();
      inflight.current = control;
      const answer = await askAi(question, attached, priorTurns, language, control.signal, chatId);
      // The reply carries the ids the server filed this turn under. Taking
      // them means edit and delete point at the same rows the server has.
      if (answer.chatId) setChatId(answer.chatId);
      addMessage({ who: 'ai', text: answer.reply, id: answer.answerId, model: answer.model });
    } catch (err) {
      // A question the person stopped themselves needs no error in the
      // conversation; they know why it ended.
      const stopped = (err as { code?: string; name?: string }).code === 'ERR_CANCELED'
        || (err as { name?: string }).name === 'CanceledError';
      if (!stopped) {
        // Some refusals carry `message`, the rate limiter carries `error`.
        // Printing "could not reach the server" over "you have asked a lot
        // of questions this hour" sends the reader looking for a fault
        // that is not there.
        const data = (err as { response?: { data?: { message?: string; error?: string } } }).response?.data;
        addMessage({ who: 'ai', text: data?.message || data?.error || t('ai.unreachable') });
      }
    } finally {
      inflight.current = null;
      setBusy(false);
    }
  };

  /** Everything said in one saved conversation, onto the screen. */
  const openChat = async (id: string) => {
    setLoadingChat(true);
    try {
      const chat = await fetchAiChat(id);
      setMessages(chat.messages.map(m => ({
        id: m.id,
        who: m.who,
        text: m.text,
        at: new Date(m.at).getTime(),
        photos: m.photos,
        model: m.model,
      })));
      setChatId(chat.id);
      setChats(null);
      setTimeout(() => toEnd('auto'), 60);
    } catch {
      addToast({ type: 'error', title: t('ai.title'), message: t('ai.chat_load_failed') });
    } finally {
      setLoadingChat(false);
    }
  };

  const showChats = async () => {
    setChats([]);
    try {
      setChats(await fetchAiChats());
    } catch {
      setChats(null);
      addToast({ type: 'error', title: t('ai.title'), message: t('ai.chat_load_failed') });
    }
  };

  const removeChat = async (id: string) => {
    setChats(list => (list ?? []).filter(c => c.id !== id));
    try {
      await deleteAiChat(id);
      if (id === chatId) clearMessages();
    } catch {
      void showChats();
    }
  };

  /**
   * Take a question back to be asked differently.
   *
   * The old question, the answer it got and anything after go — on screen
   * and on the server — because a conversation that carries both versions
   * is one the model reads both of.
   */
  const editMessage = async (m: { id: string; text: string }) => {
    setDraft(m.text);
    truncateFrom(m.id);
    boxRef.current?.focus();
    if (chatId && !m.id.startsWith('local-')) {
      try { await truncateAiChat(chatId, m.id); } catch { /* the screen is what matters */ }
    }
  };

  /** Ask the same question again — for an answer that went wrong. */
  const retry = async (answerId: string) => {
    const at = messages.findIndex(m => m.id === answerId);
    const question = at > 0 ? messages[at - 1] : null;
    if (!question || question.who !== 'me' || busy) return;
    truncateFrom(question.id);
    if (chatId && !question.id.startsWith('local-')) {
      try { await truncateAiChat(chatId, question.id); } catch { /* as above */ }
    }
    void send(question.text);
  };

  const copy = async (m: { id: string; text: string }) => {
    try {
      await navigator.clipboard.writeText(m.text);
      setCopied(m.id);
      setTimeout(() => setCopied(c => (c === m.id ? null : c)), 1600);
    } catch {
      addToast({ type: 'error', title: t('ai.title'), message: t('ai.copy_failed') });
    }
  };

  /**
   * Tapping a button while the keyboard is up used to cost two taps.
   *
   * The first tap took focus off the box, the keyboard came down, the
   * sheet grew back into the space it left — and the button had moved out
   * from under the finger before the tap landed. Refusing the focus change
   * at pointer-down keeps the keyboard where it is, so the first tap is
   * the one that works.
   */
  const keepKeyboard = (e: React.PointerEvent) => e.preventDefault();

  /**
   * A tap belongs to the thing it began on, whatever moves underneath.
   *
   * Everything in this footer sits above the keyboard, the keyboard opens
   * and closes because of these very taps, and it takes a quarter of a
   * second to do it — during which the footer travels the height of the
   * keyboard. A browser decides what was clicked by looking at what is
   * under the finger when it lifts, so by then the answer is whatever slid
   * into that spot. Every fault reported here is that one fact wearing a
   * different hat: the account row that needs tapping twice, the button
   * that opens nothing, the command that sends itself.
   *
   * Capturing the pointer settles it at the start instead of the end. The
   * element that the finger went down on receives the release, wherever
   * the pixels have gone, and an element that arrives under the finger
   * afterwards cannot receive anything. A drag that turns into a scroll
   * fires pointercancel, which disarms it — so a list still scrolls.
   *
   * The click handler stays for keyboards and for any browser that does
   * not capture; the flag keeps the two from both firing.
   */
  const tapArmed = useRef<{ id: number; x: number; y: number } | null>(null);
  const tapDone = useRef(false);
  /** Past this, the finger was going somewhere, not choosing something. */
  const TAP_SLOP = 10;
  const onTap = (fn: () => void, hold = false) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      // `hold` keeps the box focused, so the keyboard stays where it is and
      // so does this whole footer. Only for things that are not scrollable
      // lists: on a list, preventDefault cancels the scroll gesture.
      if (hold) e.preventDefault();
      tapArmed.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable; click still covers it */ }
    },
    // A drag down the list is a scroll, not a choice. Touch says so itself
    // by firing pointercancel once it commits to scrolling, but a mouse
    // never does — and a list dragged with a mouse must not pick either.
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const t = tapArmed.current;
      if (!t || t.id !== e.pointerId) return;
      if (Math.abs(e.clientX - t.x) > TAP_SLOP || Math.abs(e.clientY - t.y) > TAP_SLOP) {
        tapArmed.current = null;
        tapDone.current = true;   // and the click this drag may end in is not a choice either
      }
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      if (tapArmed.current?.id !== e.pointerId) return;
      tapArmed.current = null;
      tapDone.current = true;
      fn();
    },
    onPointerCancel: () => { tapArmed.current = null; tapDone.current = true; },
    onClick: () => {
      if (tapDone.current) { tapDone.current = false; return; }
      fn();
    },
  });

  /** A "/" that begins a word, and whatever has been typed after it. */
  const SLASH = /(?:^|\s)\/([^\s/]*)$/;

  /** An "@" that begins a word, and whatever has been typed after it. */
  const AT = /(?:^|\s)@([^\s@]*)$/;

  const onDraft = (value: string, caret: number) => {
    setDraft(value);
    const head = value.slice(0, caret);
    const m = head.match(SLASH);
    // The slash itself sits one character before what was typed after it.
    setSlash(m ? { at: caret - m[1].length - 1, query: m[1] } : null);
    const a = head.match(AT);
    setAt(a ? { at: caret - a[1].length - 1, query: a[1] } : null);
    setHi(0);
  };

  /**
   * Every open position, newest first, with the account it belongs to.
   *
   * Newest first because a command about a position is usually about one
   * just opened, and because thirty-two of them in ticket order is a wall
   * of digits.
   */
  const openPositions = useMemo(() => {
    const rows: { o: Order; accountName: string; accountNumber: string }[] = [];
    for (const a of liveAccounts) {
      if (!Array.isArray(a.orders)) continue;
      for (const o of a.orders) {
        rows.push({ o, accountName: a.name, accountNumber: String(a.accountNumber ?? '') });
      }
    }
    return rows.sort((x, y) =>
      new Date(y.o.openTime).getTime() - new Date(x.o.openTime).getTime());
  }, [liveAccounts]);

  /**
   * The account already named in the sentence, if there is one.
   *
   * Matched against the real account numbers rather than any "#digits",
   * because by the time a second "@" is typed the draft usually holds a
   * ticket as well, and a ticket is also digits behind a hash. The
   * negative lookahead stops an account number matching the front of a
   * longer ticket.
   */
  const namedAccount = useMemo(() => {
    const hits = accounts
      .map(a => String(a.accountNumber ?? ''))
      .filter(n => n && new RegExp(`#${n}(?!\\d)`).test(draft));
    // Longest wins, so one number that is a prefix of another cannot win
    // over the one actually written.
    return hits.sort((a, b) => b.length - a.length)[0] ?? null;
  }, [draft, accounts]);

  /**
   * Matched on symbol, on account, or on the ticket's digits — and
   * narrowed to the account already named, because offering positions
   * from elsewhere is offering a command that contradicts itself.
   */
  const orderPicks = at
    ? openPositions.filter(r => {
        if (namedAccount && r.accountNumber !== namedAccount) return false;
        const q = at.query.toLowerCase();
        return q === ''
          || r.o.symbol.toLowerCase().includes(q)
          || r.accountName.toLowerCase().includes(q)
          || String(r.o.ticket).includes(q);
      })
    : [];

  /**
   * Put the position into the sentence: the symbol, then the ticket.
   *
   * The ticket alone is what the assistant acts on and is meaningless to
   * read back; the symbol in front of it makes the sent message say what
   * it did without having to look the number up again.
   */
  const pickOrder = (r: { o: Order; accountName: string }) => {
    if (!at) return;
    const box = boxRef.current;
    const caret = box?.selectionStart ?? draft.length;
    const label = `${r.o.symbol} #${r.o.ticket}`;
    setDraft(draft.slice(0, at.at) + label + ' ' + draft.slice(caret));
    setAt(null);
    const to = at.at + label.length + 1;
    requestAnimationFrame(() => { box?.focus(); box?.setSelectionRange(to, to); });
  };

  /**
   * Every account that matches, not the first handful.
   *
   * This was capped at six back when the list could not be scrolled, so
   * the cap was the only thing keeping it off the whole screen. Now that
   * it scrolls, the cap is what stops the seventh account from existing:
   * with a dozen accounts, four of them demo and named alike, the ones
   * you most want are at the bottom.
   */
  const picks = slash
    ? accounts.filter(a => {
        const q = slash.query.toLowerCase();
        return q === ''
          || a.name.toLowerCase().includes(q)
          || String(a.accountNumber ?? '').includes(q);
      })
    : [];

  /**
   * Put the account into the sentence, name and number both.
   *
   * The number alone is what the assistant wants and is unreadable to a
   * person; the name alone is readable and can repeat between brokers.
   * Together the sentence still says what it means when read back a week
   * later, and there is nothing for the assistant to resolve.
   */
  const pick = (a: Account) => {
    if (!slash) return;
    const box = boxRef.current;
    const caret = box?.selectionStart ?? draft.length;
    const label = a.accountNumber ? `${a.name} #${a.accountNumber}` : a.name;
    setDraft(draft.slice(0, slash.at) + label + ' ' + draft.slice(caret));
    setSlash(null);
    const to = slash.at + label.length + 1;
    // After React has written the new value, or the caret lands in the old one.
    requestAnimationFrame(() => { box?.focus(); box?.setSelectionRange(to, to); });
  };

  /** Abandon the question in flight. */
  const stop = () => {
    inflight.current?.abort();
    inflight.current = null;
    setBusy(false);
  };

  const lbl: React.CSSProperties = {
    fontFamily: 'var(--ff-label)', fontSize: 'var(--fs-micro)',
    color: 'var(--text-muted)', letterSpacing: '1px',
  };
  const card: React.CSSProperties = {
    background: 'var(--bg-card)', border: '1px solid var(--border2)',
    borderRadius: 'var(--radius-sm)', padding: '12px', minWidth: 0,
  };

  const stat = (label: string, value: string, color?: string) => (
    <div style={{ minWidth: 0 }}>
      <div style={{ ...lbl, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      <div style={{
        fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)',
        color: color ?? 'var(--text)', marginTop: '2px',
      }}>{value}</div>
    </div>
  );

  const money = (n: number) => `${n < 0 ? '−' : n > 0 ? '+' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const chips = [t('ai.suggest_today'), t('ai.suggest_risk'), t('ai.suggest_compare'), t('ai.suggest_week')];

  /**
   * The order desk.
   *
   * Two kinds of command, and the difference between them is the whole
   * point of the panel. An ASK goes straight out: the worst it can do is
   * cost a question. A DO never does — it writes itself into the box and
   * stops there, so the account still has to be chosen and the words read
   * before anything is sent, and even then the answer comes back as a card
   * with a CONFIRM button on it. Nothing here places an order by itself.
   */
  const DESK: { do_: boolean; icon: ReactNode; label: string; text: string }[] = [
    { do_: false, icon: <IconSummary size={17} />,   label: t('ai.cmd_summary'),    text: t('ai.cmd_summary_q') },
    { do_: false, icon: <IconShieldOff size={17} />, label: t('ai.cmd_nosl'),       text: t('ai.cmd_nosl_q') },
    { do_: false, icon: <IconScale size={17} />,     label: t('ai.cmd_exposure'),   text: t('ai.cmd_exposure_q') },
    { do_: false, icon: <IconTrendDown size={17} />, label: t('ai.cmd_losing'),     text: t('ai.cmd_losing_q') },
    { do_: true,  icon: <IconShield size={17} />,    label: t('ai.cmd_setsl'),      text: t('ai.cmd_setsl_q') },
    { do_: true,  icon: <IconBreakEven size={17} />, label: t('ai.cmd_breakeven'),  text: t('ai.cmd_breakeven_q') },
    { do_: true,  icon: <IconHalf size={17} />,      label: t('ai.cmd_half'),       text: t('ai.cmd_half_q') },
    { do_: true,  icon: <IconTrendUp size={17} />,   label: t('ai.cmd_takeprofit'), text: t('ai.cmd_takeprofit_q') },
  ];
  /**
   * Open where it stands, and leave the keyboard alone.
   *
   * Three attempts at this went the other way: the list wanted the whole
   * screen, so opening it put the keyboard away, so opening it moved the
   * footer by the height of a keyboard — and a menu that moves as it opens
   * cannot be tapped reliably by anyone. Every fault reported came from
   * that, and no amount of event plumbing could fix a design where the act
   * of opening the menu moved the menu.
   *
   * The account list one block down had the answer all along: it appears
   * with the keyboard up, in whatever room is left, short and scrollable,
   * and nothing moves. Nobody has ever reported it mis-tapping. The desk
   * does the same now — the height it is given adapts to the room there
   * is, rather than the room being made for it.
   */
  const [desk, setDesk] = useState(false);

  if (!open) return null;

  return (
    <div
      className="ai-backdrop"
      style={viewport
        // inset:0 is the page, which on a phone runs on behind the
        // keyboard and behind iOS's own bar above it. Sitting the sheet in
        // the part that can actually be seen is what puts the box to type
        // in directly above the keys, with no dead strip under it.
        ? { top: `${viewport.top}px`, height: `${viewport.height}px`, bottom: 'auto' }
        : undefined}
    >
      {/* The dimming is its own layer. Fading the container faded the sheet
          with it — text over the dashboard, unreadable — because opacity
          applies to everything inside. Only the dark should lift. */}
      <div
        className="ai-dim"
        onClick={close}
        onTouchEnd={close}
        style={{ opacity: dragging ? Math.max(0.15, 1 - dragY / 420) : 1 }}
      />
      <div
        className="ai-sheet"
        onTouchStart={e => onTouchStart(e)}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          transform: `translateY(${dragY}px)`,
          transition: dragging ? 'none' : 'transform .22s cubic-bezier(.2,.8,.3,1)',
          // Measured against what can actually be seen, which is not the
          // window once the keyboard is up. All of it while typing;
          // otherwise all but a strip at the top, which keeps the sheet
          // clear of the status bar and leaves somewhere to tap to close.
          ...(viewport
            ? (() => {
                const h = Math.round(viewport.height) - (viewport.keyboard ? 0 : viewport.gap);
                return { height: `${h}px`, maxHeight: `${h}px` };
              })()
            : {}),
        }}
      >
        {/* The handle. Dragging it works wherever the conversation happens to
            be scrolled, which is why it is its own target. */}
        <div
          className="ai-grip"
          onTouchStart={e => onTouchStart(e, true)}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onClick={close}
          role="button"
          aria-label="Close"
        >
          <span />
        </div>

        {/* While the microphone is live, the first tap anywhere stops it.
            A stuck listening state used to leave nothing to press. */}
        {mic.listening && (
          <div
            className="ai-catch"
            onPointerDown={mic.stop}
          />
        )}

        {/* Fixed head: who this is, and what it is looking at. */}
        <div className="ai-head">

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
        <span style={{
          fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)',
          color: 'var(--text-dim)', letterSpacing: '2px',
        }}>{t('ai.title')}</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => (chats ? setChats(null) : void showChats())}
          title={t('ai.past_chats')}
          aria-label={t('ai.past_chats')}
          className="ai-round"
          style={chats ? { borderColor: 'var(--accent-blue)', color: 'var(--accent-blue)' } : undefined}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
          </svg>
        </button>

        {messages.length > 0 && (
          <button
            onClick={() => { pickedUpWhereWeLeftOff = true; setChats(null); clearMessages(); }}
            title={t('ai.new_chat')}
            aria-label={t('ai.new_chat')}
            style={{
              background: 'none', border: '1px solid var(--border2)', borderRadius: '999px',
              padding: '5px 12px', cursor: 'pointer', flexShrink: 0,
              color: 'var(--text-primary)', fontFamily: 'var(--ff-label)',
              fontSize: 'var(--fs-micro)', letterSpacing: '1px',
            }}
          >{t('ai.new_chat')}</button>
        )}

        {/* A mouse has no swipe, and a keyboard user needs a target. */}
        <button
          onClick={close}
          aria-label="Close"
          style={{
            background: 'none', border: 'none', padding: '2px 4px', cursor: 'pointer',
            color: 'var(--text-primary)', fontSize: '17px', lineHeight: 1, flexShrink: 0,
          }}
        >✕</button>
      </div>

      {/* One line for everything that is true whether or not anyone is
          talking. Tap it for the rest. */}
      <button
        onClick={() => setShowDetails(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
          background: 'var(--bg-card)', border: '1px solid var(--border2)',
          borderRadius: 'var(--radius-sm)', padding: '8px 10px',
          cursor: 'pointer', textAlign: 'left', minWidth: 0,
        }}
      >
        {status && !status.configured && (
          <span style={{
            width: '6px', height: '6px', borderRadius: '50%',
            background: 'var(--warning)', flexShrink: 0,
          }} />
        )}
        <span style={{
          flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          // The one line of the portfolio anyone actually reads, so it is
          // sized to be read rather than to fit a table.
          fontFamily: 'var(--ff-body)', fontSize: '13.5px', color: 'var(--text-primary)',
        }}>
          {ctx
            ? `${ctx.openOrders} ${t('ai.sum_open')} · ${ctx.losingOrders} ${t('ai.sum_losing')} · ${ctx.ordersWithoutStop} ${t('ai.sum_nosl')} · ${money(ctx.todayPnl)}`
            : t('ai.watching')}
        </span>
        <span style={{ ...lbl, flexShrink: 0 }}>
          {showDetails ? t('ai.hide_details') : t('ai.details')} {showDetails ? '▴' : '▾'}
        </span>
      </button>

      {showDetails && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {ctx && (
            <div style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
              {stat(t('ai.ctx_accounts'), `${ctx.online}/${ctx.accounts}`)}
              {stat(t('ai.ctx_open'), String(ctx.openOrders))}
              {stat(t('ai.ctx_today'), money(ctx.todayPnl), ctx.todayPnl < 0 ? 'var(--red)' : 'var(--green)')}
              {stat(t('ai.ctx_losing'), String(ctx.losingOrders), ctx.losingOrders > 0 ? 'var(--red)' : undefined)}
              {stat(t('ai.ctx_nosl'), String(ctx.ordersWithoutStop), ctx.ordersWithoutStop > 0 ? 'var(--warning)' : undefined)}
              {stat(t('ai.ctx_history'), String(ctx.closedTrades30d))}
            </div>
          )}

          {status && !status.configured && (
            <div style={{
              padding: '10px 12px', borderRadius: 'var(--radius-sm)',
              background: 'rgba(251,191,36,.06)', border: '1px solid rgba(251,191,36,.3)',
              fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)',
              color: 'var(--text-dim)', lineHeight: 1.6,
            }}>
              <span style={{ color: 'var(--warning)' }}>{t('ai.not_connected')}</span>
              {' — '}{t('ai.not_connected_body')}
            </div>
          )}

          <div style={{
            fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-micro)',
            color: 'var(--text-muted)', lineHeight: 1.6,
          }}>{t('ai.disclaimer')}</div>
        </div>
      )}

        </div>

      {/* The conversation, and the only part that scrolls. Everything used
          to sit in here together, so a long conversation pushed the box to
          type in clean off the bottom of the screen. */}
      {/* The scroller and anything that covers it. */}
      <div className="ai-mid">

      <div className="ai-scroll" ref={scroller} onScroll={onScroll}>

        {messages.length === 0 && (
          <div style={{ ...card, borderLeft: '2px solid var(--accent-blue)' }}>
            <div className="ai-msg" style={{ color: 'var(--text-primary)', marginBottom: '12px' }}>
              {status && !status.configured ? t('ai.offline_short') : t('ai.greeting')}
            </div>
            {/* Two columns rather than a wrapping row: at a size worth
                reading, one long opener per line pushed the other three
                down the card. */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {chips.map(c => (
                <button
                  key={c}
                  onClick={() => send(c)}
                  disabled={busy}
                  className="ai-chip"
                  style={{ cursor: busy ? 'default' : 'pointer' }}
                >{c}</button>
              ))}
            </div>
            {/* Only worth saying with something to choose between, and
                only here: it goes away as soon as the conversation
                starts, which is when it stops being news. */}
            {accounts.length > 1 && (
              <div style={{
                marginTop: '12px',
                fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-micro)',
                color: 'var(--text-muted)',
              }}>{t('ai.slash_hint')}<br />{t('ai.order_hint')}</div>
            )}
          </div>
        )}

        {messages.map(m => m.who === 'me' ? (
          <div key={m.id} style={{ display: 'grid', gap: '3px', justifyItems: 'stretch' }}>
          <div style={{
            marginLeft: '28px', padding: '10px 12px', borderRadius: 'var(--radius-sm)',
            background: 'rgba(96,165,250,.10)', border: '1px solid rgba(96,165,250,.35)',
            color: 'var(--text)', wordBreak: 'break-word', whiteSpace: 'pre-wrap',
          }} className="ai-msg">
            {m.images && m.images.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: m.text ? '8px' : 0 }}>
                {m.images.map((src, i) => (
                  <img
                    key={i}
                    src={src}
                    alt=""
                    style={{
                      width: m.images!.length === 1 ? '100%' : 'calc(50% - 3px)',
                      maxHeight: '220px', objectFit: 'cover',
                      borderRadius: 'var(--radius-sm)', display: 'block',
                    }}
                  />
                ))}
              </div>
            )}
            {m.text}
            {/* A conversation brought back from the server remembers that
                photos went with a question, but not the photos: keeping
                them would outweigh everything else in the database. */}
            {!m.images && !!m.photos && (
              <div style={{
                marginTop: '6px', fontFamily: 'var(--ff-body)',
                fontSize: 'var(--fs-micro)', color: 'var(--text-muted)',
              }}>{m.photos === 1 ? t('ai.had_photo') : `${m.photos} ${t('ai.had_photos')}`}</div>
            )}
          </div>
          {/* Under the question: when it was asked, and a way to ask it
              differently — which is what editing a sent message means
              here, since the answer to the old wording is no longer
              wanted. */}
          <div className="ai-meta" style={{ justifyContent: 'flex-end' }}>
            <span>{clock(m.at)}</span>
            {!busy && (
              <button
                onClick={() => void editMessage(m)}
                onPointerDown={keepKeyboard}
                className="ai-act"
                aria-label={t('ai.edit')}
                title={t('ai.edit')}
              ><IconPencil size={17} /></button>
            )}
          </div>
          </div>
        ) : (
          <div key={m.id} style={{ display: 'grid', gap: '3px' }}>
          <div style={{ ...card, borderLeft: '2px solid var(--accent-blue)' }}>
            <div style={{ ...lbl, marginBottom: '6px' }}>AI</div>
            {/* --text-dim is right for a meta line in a table and wrong
                for three paragraphs to read on a phone in daylight. */}
            {(() => {
              // An answer may carry an order written out for confirming.
              // It comes out of the text and becomes a card with a button:
              // printing the JSON at somebody is not an offer they can act
              // on, and leaving it in the prose is just noise.
              const { plan, rest: withoutPlan } = readPlan(m.text);
              // An answer can also ask for something to be remembered.
              const { offer, rest } = readMemoryOffer(withoutPlan);
              return (
                <>
                  <div className="ai-msg" style={{ color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                    <RichText text={rest} />
                  </div>
                  {plan && (
                    <div style={{ marginTop: '10px' }}>
                      <OrderDraftCard plan={plan} />
                    </div>
                  )}
                  {offer && <MemoryOffer text={offer} />}
                </>
              );
            })()}
          </div>
          <div className="ai-meta">
            <span>{clock(m.at)}</span>
            <button
              onClick={() => void copy(m)}
              onPointerDown={keepKeyboard}
              className={copied === m.id ? 'ai-act ai-act-done' : 'ai-act'}
              aria-label={t('ai.copy')}
              title={copied === m.id ? t('ai.copied') : t('ai.copy')}
            >
              {copied === m.id
                ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
                : <IconCopy size={17} />}
            </button>
            {!busy && (
              <button
                onClick={() => void retry(m.id)}
                onPointerDown={keepKeyboard}
                className="ai-act"
                aria-label={t('ai.retry')}
                title={t('ai.retry')}
              ><IconRetry size={17} /></button>
            )}
            {m.model && <span style={{ marginLeft: 'auto' }}>{m.model}</span>}
          </div>
          </div>
        ))}
        {/* Something is happening, and it can be called off. Until now the
            only sign was the send button going pale. */}
        {busy && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '2px 2px 2px 4px', minWidth: 0,
          }}>
            <span className="ai-dots" aria-hidden="true"><i /><i /><i /></span>
            <span style={{
              fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-dim)',
            }}>{t('ai.thinking')}</span>
            <button onClick={stop} className="ai-stop">
              <span className="ai-stop-mark" />
              {t('ai.stop')}
            </button>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* What was asked before today. Tapping one brings it back.

          Over the conversation, not at the top of it. It used to be the
          first thing inside the scroller, which looks the same until the
          conversation is longer than the screen: then the panel opens
          somewhere above where you are reading and tapping the clock
          appears to do nothing at all. A panel is a mode, not a message,
          so it goes where the eyes already are and closes on a tap
          outside. */}
      {chats !== null && (
        <div
          className="ai-hist"
          onPointerDown={e => { if (e.target === e.currentTarget) setChats(null); }}
        >
          {chats !== null && (
            <div style={{ ...card, padding: '6px' }}>
              <div style={{ ...lbl, padding: '6px 8px 8px' }}>{t('ai.past_chats')}</div>
              {chats.length === 0 && (
                <div style={{
                  padding: '6px 8px 12px', fontFamily: 'var(--ff-body)',
                  fontSize: 'var(--fs-body-sm)', color: 'var(--text-muted)',
                }}>{t('ai.no_past_chats')}</div>
              )}
              {chats.map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <button
                    onClick={() => void openChat(c.id)}
                    className="ai-chat-row"
                    style={c.id === chatId ? { color: 'var(--accent-blue)' } : undefined}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-micro)', flexShrink: 0 }}>
                      {when(c.updatedAt)}
                    </span>
                  </button>
                  <button
                    onClick={() => void removeChat(c.id)}
                    aria-label={t('common.delete')}
                    title={t('common.delete')}
                    className="ai-round"
                    style={{ width: '30px', height: '30px', flexShrink: 0 }}
                  >✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      </div>

      {/* Back to the newest answer, from wherever the reading got to. */}
      {awayFromEnd && (
        <button
          className="ai-jump"
          onClick={() => toEnd()}
          aria-label={t('ai.to_latest')}
          title={t('ai.to_latest')}
          // The composer loses its safe-area padding while the keyboard is
          // up, so the button follows it down.
          style={viewport?.keyboard || writing ? { bottom: '76px' } : undefined}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5v14M6 13l6 6 6-6" />
          </svg>
        </button>
      )}

      {/* While the keyboard is up there is no home indicator to keep
          clear of — the keyboard is over it — so the safe-area padding
          under the composer is just a strip of empty sheet between the
          box and the keys. */}
      <div className={viewport?.keyboard || writing ? 'ai-foot ai-foot-kb' : 'ai-foot'}>
      {/* Photos waiting to be sent */}
      {photos.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {photos.map((ph, i) => (
            <div key={i} style={{ position: 'relative', width: '64px', height: '64px', flexShrink: 0 }}>
              <img
                src={ph.dataUrl}
                alt={ph.name}
                style={{
                  width: '100%', height: '100%', objectFit: 'cover',
                  borderRadius: 'var(--radius-sm)', border: '1px solid var(--border2)', display: 'block',
                }}
              />
              <button
                onPointerDown={() => setPhotos(p => p.filter((_, k) => k !== i))}
                aria-label={t('ai.remove_photo')}
                title={t('ai.remove_photo')}
                style={{
                  position: 'absolute', top: '-6px', right: '-6px',
                  width: '20px', height: '20px', borderRadius: '50%',
                  background: 'var(--bg-card)', border: '1px solid var(--border2)',
                  color: 'var(--text)', fontSize: '11px', lineHeight: 1,
                  cursor: 'pointer', padding: 0,
                }}
              >✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Typing "@" offers the open positions. Two lines a row: at 430px
          one line of symbol, side, lots, account and an eleven-digit
          ticket squeezed the symbol — the thing being looked for — to
          nothing, the same way the pending rows did. */}
      {at && picks.length === 0 && (
        <div className="ai-pick" role="listbox" aria-label={t('ai.pick_order')}>
          {orderPicks.length === 0 && (
            <div className="ai-pick-empty">{t('ai.no_orders')}</div>
          )}
          {orderPicks.map((r, i) => (
            <button
              key={`${r.accountNumber}-${r.o.ticket}`}
              role="option"
              aria-selected={i === hi}
              // Click, for every reason the account list below gives.
              {...onTap(() => pickOrder(r))}
              className={i === hi ? 'ai-ord-row ai-pick-on' : 'ai-ord-row'}
            >
              <span className="ai-ord-top">
                <span className="ai-ord-sym">{r.o.symbol}</span>
                <span className={r.o.type === 'SELL' ? 'ai-ord-sell' : 'ai-ord-buy'}>
                  {r.o.type === 'SELL' ? 'sell' : 'buy'} {Number(r.o.lots ?? 0).toFixed(2)}
                </span>
                <span className="ai-ord-gap" />
                <span className={Number(r.o.profit ?? 0) < 0 ? 'ai-ord-loss' : 'ai-ord-win'}>
                  {Number(r.o.profit ?? 0) < 0 ? '' : '+'}{Number(r.o.profit ?? 0).toFixed(2)}
                </span>
              </span>
              <span className="ai-ord-sub">
                <span className="ai-ord-acc">{r.accountName}</span>
                <span className="ai-ord-gap" />
                <span className="ai-ord-tic">#{r.o.ticket}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Typing "/" offers the accounts by name */}
      {picks.length > 0 && (
        <div className="ai-pick" role="listbox" aria-label={t('ai.pick_account')}>
          {picks.map((a, i) => (
            <button
              key={a.id}
              role="option"
              aria-selected={i === hi}
              // Click, not pointerdown. Pointerdown fires the moment a
              // finger lands, before there is any way to know whether it
              // is a tap or the start of a scroll — so the list could not
              // be scrolled at all, every touch picked whatever it landed
              // on, and preventDefault on top of that killed the scroll
              // gesture outright. Worse, picking unmounts the list, the
              // sheet collapses, and the click that follows the finger
              // lands on whatever moved under it — which is the send
              // button, so a scroll attempt sent the message.
              //
              // A click only fires when the finger stays put, and it is
              // the last event of the gesture, so nothing arrives after
              // it to land anywhere else. The keyboard is put back by
              // pick() rather than held open here.
              {...onTap(() => pick(a))}
              className={i === hi ? 'ai-pick-row ai-pick-on' : 'ai-pick-row'}
            >
              <span className="ai-pick-name">{a.name}</span>
              {a.isDemo && <span className="ai-pick-tag">DEMO</span>}
              <span className="ai-pick-num">#{a.accountNumber}</span>
            </button>
          ))}
        </div>
      )}

      {/* The order desk, above the composer for the same reason the account
          list is: it pushes the conversation up rather than covering it,
          and it can never end up behind the phone keyboard. */}
      {desk && picks.length === 0 && !at && (
        <div
          className="ai-desk"
          // vh is the whole screen; the keyboard covers part of it without
          // resizing the window, so a panel sized in vh overflows the room
          // it actually has and pushes the composer off the bottom.
          // visualViewport is the part still visible. The subtraction is
          // the sheet's own furniture: its header, the summary bar and the
          // composer under the list.
          style={viewport ? { maxHeight: Math.max(150, viewport.height - 240) } : undefined}
        >
          <div className="ai-desk-head">{t('ai.desk_ask')}</div>
          {DESK.filter(c => !c.do_).map(c => (
            <button key={c.label} className="ai-desk-row" disabled={busy}
              {...onTap(() => { setDesk(false); void send(c.text); })}>
              <span className="ai-desk-ico">{c.icon}</span>
              <span className="ai-desk-lbl">{c.label}</span>
            </button>
          ))}
          <div className="ai-desk-head">{t('ai.desk_do')}</div>
          {DESK.filter(c => c.do_).map(c => (
            <button key={c.label} className="ai-desk-row ai-desk-do" disabled={busy}
              {...onTap(() => {
                // Written into the box, never sent. The account still has
                // to be chosen and the words read first.
                setDesk(false);
                // A command that needs a ticket ends in "@", which is the
                // picker's own trigger: the list opens on it, so the one
                // field nobody can recite is chosen rather than typed. A
                // trailing space would break the match it depends on.
                const text = c.text.endsWith('@') ? c.text : c.text + ' ';
                onDraft(text, text.length);
                boxRef.current?.focus();
              })}>
              <span className="ai-desk-ico">{c.icon}</span>
              <span className="ai-desk-lbl">{c.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Composer */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', minWidth: 0 }}>
        <button
          className={desk ? 'ai-plus ai-plus-on' : 'ai-plus'}
          // Same guard the send button has, and needed for the same
          // reason. With the box focused, letting this steal the focus
          // blurs it, the footer swaps ai-foot-kb for ai-foot, its
          // padding grows, and the button has moved out from under the
          // finger before the click lands — so the first tap only shut
          // the keyboard and a second was needed to open anything.
          {...onTap(() => setDesk(d => !d), true)}
          title={t('ai.desk')} aria-label={t('ai.desk')}
          style={{ border: 0 }}
        ><IconBolt size={19} /></button>
        {/* A label, not a button that calls click() on a hidden input: iOS
            only opens the picker for a real activation, and a programmatic
            click from pointerdown is not one — the button did nothing at
            all on the phone. Tapping a label is the browser's own path to
            the input and needs no script.
            accept="image/*" with no capture attribute is what makes the
            phone offer the camera and the library both. */}
        <label
          className="ai-plus"
          title={t('ai.attach')}
          aria-label={t('ai.attach')}
          // Keeps the box focused, as above. preventDefault here stops the
          // focus moving and nothing else: the click that follows still
          // reaches the input, which is what opens the picker, and which
          // iOS requires to be a real activation.
          onPointerDown={keepKeyboard}
        >
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={e => { void pickPhotos(e.target.files); e.target.value = ''; }}
          />
          <IconPlus size={19} />
        </label>
        <div style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex' }}>
          {/* A textarea, because a question can be three lines long and a
              single-line input just scrolls sideways under the thumb. It
              grows with the text to a point and then scrolls.
              This was briefly a contenteditable div, to try to stop iOS
              putting its ‹ › Done bar above the keyboard. iOS shows that
              bar for editable text too, so the trick bought nothing and
              cost the plain, well-behaved form control. */}
          <textarea
            ref={boxRef}
            value={draft}
            rows={1}
            onChange={e => onDraft(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            onKeyDown={e => {
              // While the account list is up it owns the keys that move
              // through it and the one that chooses. Enter picks here on a
              // phone too: the list is only up because a "/" was typed, and
              // a new line is not what that key is for at that moment.
              if (picks.length > 0) {
                if (e.key === 'Escape') { e.preventDefault(); setSlash(null); return; }
                if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => (h + 1) % picks.length); return; }
                if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => (h - 1 + picks.length) % picks.length); return; }
                if ((e.key === 'Enter' && !e.shiftKey && !typing) || e.key === 'Tab') {
                  e.preventDefault(); pick(picks[hi] ?? picks[0]); return;
                }
              }
              if (orderPicks.length > 0) {
                if (e.key === 'Escape') { e.preventDefault(); setAt(null); return; }
                if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => (h + 1) % orderPicks.length); return; }
                if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => (h - 1 + orderPicks.length) % orderPicks.length); return; }
                if ((e.key === 'Enter' && !e.shiftKey && !typing) || e.key === 'Tab') {
                  e.preventDefault(); pickOrder(orderPicks[hi] ?? orderPicks[0]!); return;
                }
              }
              if (e.key !== 'Enter' || e.shiftKey || typing) return;
              // On a phone the return key writes a new line; there is a
              // SEND button an inch away. With a real keyboard Enter sends
              // and Shift+Enter breaks the line.
              if (window.matchMedia('(pointer: coarse)').matches) return;
              e.preventDefault();
              void send(draft);
            }}
            onCompositionStart={() => setTyping(true)}
            onCompositionEnd={() => setTyping(false)}
            onFocus={() => setWriting(true)}
            onBlur={() => setWriting(false)}
            // Short. The hint about "/" lives in the opening card, where
            // there is room for it: in here it wrapped to a second line
            // and spilled out of a box one row high.
            placeholder={mic.listening ? t('ai.listening') : t('ai.ask_placeholder')}
            className="ai-box"
            style={{
              border: `1px solid ${mic.listening ? 'var(--danger)' : 'var(--border2)'}`,
              paddingRight: mic.supported ? '42px' : '12px',
            }}
          />

          {/* Only where the browser can actually listen. A microphone that
              does nothing is worse than none. */}
          {mic.supported && (
            <button
              // One pointer event, not a touch and a click: handling both
              // fired twice per tap — start then stop — and the button
              // looked dead. This covers finger and mouse alike.
              onPointerDown={e => { e.preventDefault(); if (mic.listening) mic.stop(); else mic.start(); }}
              title={mic.listening ? t('ai.listening') : t('ai.speak')}
              aria-label={t('ai.speak')}
              className={mic.listening ? 'ai-mic ai-mic-on' : 'ai-mic'}
            >
              <IconMic size={17} />
            </button>
          )}
        </div>
        {/* Round, with an arrow, the way every chat on a phone sends: the
            word SEND in a box took a third of the composer's width and
            still had to be aimed at. */}
        <button
          onClick={() => send(draft)}
          onPointerDown={keepKeyboard}
          disabled={busy || (!draft.trim() && photos.length === 0)}
          title={t('ai.send')}
          aria-label={t('ai.send')}
          className="ai-send"
        >
          <IconArrowUp size={20} />
        </button>
      </div>
      </div>
      </div>

      <style>{`
        .ai-backdrop {
          /* Above the header (100) and its menus (600): a sheet that leaves
             the header tappable is a sheet you can start a second thing from
             while it is open, and the header also swallowed taps meant for
             the dimmed area behind it. */
          position: fixed; inset: 0; z-index: 900;
          display: flex; align-items: flex-end; justify-content: center;
          pointer-events: none;
        }
        .ai-dim {
          position: absolute; inset: 0;
          background: rgba(0,0,0,.55);
          pointer-events: auto;
        }
        .ai-backdrop > .ai-sheet { pointer-events: auto; }
        .ai-sheet {
          position: relative;
          width: 100%; max-width: 640px;
          height: calc(100vh - 46px); max-height: calc(100vh - 46px);
          background: var(--bg-primary);
          border: 1px solid var(--border2);
          border-bottom: none;
          border-radius: 16px 16px 0 0;
          box-shadow: 0 -10px 40px rgba(0,0,0,.5);
          display: flex; flex-direction: column;
          overflow: hidden;
          animation: ai-rise .24s cubic-bezier(.2,.8,.3,1);
        }
        @keyframes ai-rise { from { transform: translateY(100%); } to { transform: translateY(0); } }
        .ai-catch {
          position: absolute; inset: 0; z-index: 5;
          background: transparent;
        }
        .ai-plus {
          position: relative;
          width: 38px; height: 38px; border-radius: 50%; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          background: none; border: 1px solid var(--border2);
          color: var(--text-muted); cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }
        .ai-plus:active { background: var(--bg-input); }
        /* Covers the label so the tap lands on the input itself wherever it
           is pressed, which is the most reliable path on iOS. */
        .ai-plus input[type="file"] {
          position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%;
          cursor: pointer;
        }
        /* Chat is prose, not a dense table, and --fs-body is 12px on a
           phone. This is the one place in the app that is read a paragraph
           at a time, so it gets a reading size of its own. */
        .ai-msg {
          font-family: var(--ff-body);
          /* 16.5 was the answer to text nobody could read; it overshot.
             15 still clears what a phone needs to be comfortable and puts
             a couple more lines on screen, which is what a conversation
             this long is short of. */
          font-size: 15px;
          line-height: 1.65;
        }
        .ai-msg strong { color: var(--text); }
        /* The four openers are read and tapped, so they are sized to be
           read and tapped, not like a caption under a table. */
        .ai-chip {
          font-family: var(--ff-body);
          font-size: 15px;
          line-height: 1.4;
          color: var(--text-primary);
          background: var(--bg-input);
          border: 1px solid var(--border2);
          border-radius: 999px;
          padding: 9px 14px;
          text-align: left;
          -webkit-tap-highlight-color: transparent;
        }
        .ai-chip:active { background: var(--bg-tertiary); }
        /* The line under a message: when it was said, and what can be
           done with it. Quiet enough to ignore while reading. */
        .ai-meta {
          display: flex; align-items: center; gap: 12px;
          padding: 0 2px;
          font-family: var(--ff-body); font-size: 12px;
          color: var(--text-primary);
        }
        /* Icons, and a target a thumb can actually hit: the words "Copy"
           and "Edit" at micro size were both hard to read and hard to
           land on. 34px square is the smallest that reliably takes a tap. */
        .ai-act {
          width: 34px; height: 34px; margin: -6px 0;
          display: inline-flex; align-items: center; justify-content: center;
          background: none; border: none; padding: 0;
          /* The muted greys are for text under a table; an icon this size
             disappears in them. */
          color: var(--text-primary); opacity: .72;
          cursor: pointer; border-radius: 50%;
          -webkit-tap-highlight-color: transparent;
        }
        .ai-act:active { background: var(--bg-input); color: var(--accent-blue); opacity: 1; }
        .ai-act-done { color: var(--success); opacity: 1; }
        /* The send button: a filled circle with an arrow in it. */
        .ai-send {
          width: 44px; height: 44px; border-radius: 50%; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          background: var(--accent-blue); color: #12151a;
          border: none; padding: 0; cursor: pointer;
          transition: opacity .15s, transform .1s;
          -webkit-tap-highlight-color: transparent;
        }
        .ai-send:disabled { opacity: .38; cursor: default; }
        .ai-send:not(:disabled):active { transform: scale(.93); }
        /* A small round button: the history clock, and the ✕ on a row in
           the list of past conversations. */
        .ai-round {
          width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          background: none; border: 1px solid var(--border2);
          color: var(--text-primary); cursor: pointer; padding: 0;
          font-size: 12px; line-height: 1;
          -webkit-tap-highlight-color: transparent;
        }
        .ai-round:active { background: var(--bg-input); }
        .ai-chat-row {
          flex: 1; min-width: 0;
          display: flex; align-items: center; justify-content: space-between; gap: 10px;
          background: none; border: none; text-align: left;
          padding: 10px 8px; cursor: pointer;
          font-family: var(--ff-body); font-size: 14.5px; color: var(--text-primary);
          -webkit-tap-highlight-color: transparent;
        }
        .ai-chat-row:active { background: var(--bg-input); border-radius: var(--radius-sm); }
        .ai-box {
          flex: 1; min-width: 0; width: 100%;
          background: var(--bg-input);
          border-radius: var(--radius-sm);
          color: var(--text);
          font-family: var(--ff-body);
          /* 16px or iOS zooms the whole page in when the box is focused. */
          font-size: 16px;
          line-height: 1.5;
          padding: 9px 12px;
          outline: none;
          overflow-y: auto;
          max-height: 132px;
          box-sizing: border-box;
          resize: none;
          overflow-wrap: anywhere;
        }
        .ai-mic {
          /* Pinned to the bottom, not the middle: the box grows upward as
             the question gets longer and a centred button would drift. */
          position: absolute; right: 5px; bottom: 4px;
          z-index: 6;
          width: 32px; height: 32px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          background: none; border: 1px solid var(--border2);
          color: var(--text-muted); cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }
        .ai-mic-on {
          color: var(--danger); border-color: var(--danger);
          animation: ai-pulse 1.1s ease-in-out infinite;
        }
        @keyframes ai-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(248,113,113,.45); }
          50%      { box-shadow: 0 0 0 6px rgba(248,113,113,0); }
        }
        .ai-grip {
          padding: 10px 0 6px; display: flex; justify-content: center;
          flex-shrink: 0; cursor: pointer; touch-action: none;
        }
        .ai-grip span {
          width: 42px; height: 4px; border-radius: 2px;
          background: var(--border2); display: block;
        }
        /* Three rows that do not move: the head, the conversation, the box
           to type in. min-height:0 is the part that matters — without it a
           flex child refuses to shrink below its content, which is how the
           composer ended up pushed off the bottom of the sheet. */
        .ai-head {
          flex-shrink: 0;
          display: flex; flex-direction: column; gap: 10px;
          padding: 4px 16px 10px;
        }
        /* Holds the scroller and whatever covers it, so a panel can
           fill exactly the conversation's area and neither slide under
           the header nor over the composer. */
        .ai-mid {
          position: relative;
          flex: 1 1 auto; min-height: 0;
          display: flex; flex-direction: column;
        }
        .ai-hist {
          position: absolute;
          inset: 0;
          z-index: 6;
          overflow-y: auto; overscroll-behavior: contain;
          padding: 0 16px 8px;
          background: rgba(0, 0, 0, 0.45);
          backdrop-filter: blur(2px);
        }
        .ai-scroll {
          flex: 1 1 auto; min-height: 0;
          overflow-y: auto; overscroll-behavior: contain;
          display: flex; flex-direction: column; gap: 10px;
          min-width: 0;
          padding: 0 16px 8px;
        }
        .ai-foot {
          flex-shrink: 0;
          display: flex; flex-direction: column; gap: 8px;
          padding: 10px 16px calc(10px + env(safe-area-inset-bottom, 0px));
          border-top: 1px solid var(--border-color);
          background: var(--bg-primary);
        }
        .ai-foot-kb { padding-bottom: 8px; }

        /* The account list. It sits in the footer rather than floating
           over the conversation, so it pushes the messages up instead of
           covering the one being replied to, and it cannot end up behind
           the phone keyboard. */
        .ai-pick {
          display: flex;
          flex-direction: column;
          max-height: 216px;
          overflow-y: auto;
          /* The list scrolls under the finger, and only up and down — a
             sideways drag belongs to the sheet, not to this. */
          touch-action: pan-y;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
          border: 1px solid var(--border2);
          border-radius: var(--radius-sm);
          background: var(--bg-card);
        }
        .ai-pick-row {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          /* 44px is the smallest thing a thumb hits reliably, and this
             list decides which account an order goes to. */
          min-height: 44px;
          padding: 8px 12px;
          background: none;
          border: 0;
          border-bottom: 1px solid var(--border);
          color: var(--text);
          font-size: 15px;
          text-align: left;
          cursor: pointer;
        }
        .ai-pick-row:last-child { border-bottom: 0; }
        /* An open position, two lines: the symbol and the side on top, the
           account and the ticket underneath. */
        .ai-ord-row {
          display: flex;
          flex-direction: column;
          gap: 3px;
          width: 100%;
          min-height: 44px;
          padding: 8px 12px;
          background: none;
          border: 0;
          border-bottom: 1px solid var(--border);
          text-align: left;
          cursor: pointer;
        }
        .ai-ord-row:last-child { border-bottom: 0; }
        .ai-ord-top, .ai-ord-sub { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
        .ai-ord-gap { flex: 1; }
        .ai-ord-sym {
          color: var(--text); font-size: 15px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .ai-ord-buy  { color: var(--accent-blue); font-size: 13px; flex-shrink: 0; }
        .ai-ord-sell { color: var(--warning, #f59e0b); font-size: 13px; flex-shrink: 0; }
        .ai-ord-win  { color: var(--success, #34d399); font-size: 13px; flex-shrink: 0; font-variant-numeric: tabular-nums; }
        .ai-ord-loss { color: var(--danger, #f87171); font-size: 13px; flex-shrink: 0; font-variant-numeric: tabular-nums; }
        .ai-ord-acc {
          color: var(--text-dim); font-size: 12px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .ai-ord-tic {
          color: var(--text-muted); font-size: 12px; flex-shrink: 0;
          font-variant-numeric: tabular-nums;
        }
        .ai-pick-empty {
          padding: 12px;
          font-family: var(--ff-body); font-size: var(--fs-body-sm);
          color: var(--text-muted); text-align: center;
        }
        .ai-pick-on { background: var(--bg-hover, rgba(255,255,255,0.06)); }
        .ai-pick-name {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ai-pick-tag {
          flex-shrink: 0;
          font-size: 10px;
          letter-spacing: 0.04em;
          padding: 2px 6px;
          border-radius: 999px;
          border: 1px solid var(--border2);
          color: var(--text-dim);
        }
        .ai-pick-num {
          flex-shrink: 0;
          font-variant-numeric: tabular-nums;
          font-size: 13px;
          color: var(--text-dim);
        }
        /* The order desk. Same slot and the same scroll rules as the
           account list, so the two behave alike under a thumb. */
        .ai-desk {
          display: flex;
          flex-direction: column;
          /* Tall enough that all eight fit on a phone without scrolling —
             a command you have to scroll to find is one you forget you
             have. Still a cap, and still scrollable, for a short screen
             or a keyboard that has eaten half of it. */
          max-height: 55vh;
          overflow-y: auto;
          touch-action: pan-y;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
          border: 1px solid var(--border2);
          border-radius: var(--radius-sm);
          background: var(--bg-card);
          margin-bottom: 8px;
        }
        .ai-desk-head {
          padding: 8px 12px 4px;
          font-family: var(--ff-body);
          font-size: 11px;
          letter-spacing: 0.04em;
          color: var(--text-muted);
          background: var(--bg-input);
          border-bottom: 1px solid var(--border);
        }
        .ai-desk-row {
          display: flex;
          align-items: center;
          width: 100%;
          min-height: 44px;
          padding: 8px 12px;
          background: none;
          border: 0;
          border-bottom: 1px solid var(--border);
          border-left: 2px solid var(--accent-blue);
          color: var(--text);
          font-size: 15px;
          text-align: left;
          cursor: pointer;
        }
        /* Orange, because these write a command rather than ask a
           question, and the eye should know which is which before the
           thumb lands. */
        .ai-desk-do { border-left-color: var(--warning, #f59e0b); }
        /* The mark takes the colour of the group it is in, and the labels
           line up because every icon reserves the same width. */
        .ai-desk-ico {
          flex-shrink: 0;
          width: 22px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-right: 10px;
          color: var(--accent-blue);
        }
        .ai-desk-do .ai-desk-ico { color: var(--warning, #f59e0b); }
        .ai-desk-row:last-child { border-bottom: 0; }
        .ai-desk-lbl {
          flex: 1; min-width: 0;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .ai-plus-on { background: var(--bg-hover, rgba(255,255,255,0.10)); }

        /* Three dots that say the question is on its way. */
        .ai-dots { display: inline-flex; gap: 4px; align-items: center; }
        .ai-dots i {
          width: 6px; height: 6px; border-radius: 50%;
          background: var(--accent-blue); display: block;
          animation: ai-think 1.1s ease-in-out infinite;
        }
        .ai-dots i:nth-child(2) { animation-delay: .15s; }
        .ai-dots i:nth-child(3) { animation-delay: .3s; }
        @keyframes ai-think {
          0%, 80%, 100% { opacity: .25; transform: translateY(0); }
          40%           { opacity: 1;   transform: translateY(-3px); }
        }
        .ai-stop {
          display: inline-flex; align-items: center; gap: 6px;
          background: none; border: 1px solid var(--border2);
          border-radius: 999px; padding: 4px 11px; cursor: pointer;
          color: var(--text-dim);
          font-family: var(--ff-label); font-size: var(--fs-micro); letter-spacing: 1px;
          -webkit-tap-highlight-color: transparent;
        }
        .ai-stop:active { background: var(--bg-input); }
        .ai-stop-mark {
          width: 8px; height: 8px; border-radius: 1px;
          background: var(--danger); display: block;
        }
        /* Centred above the composer, where a thumb of either hand
           reaches it, and filled rather than outlined so the arrow reads
           at a glance against a wall of text. */
        .ai-jump {
          position: absolute; left: 50%; transform: translateX(-50%); z-index: 7;
          bottom: calc(78px + env(safe-area-inset-bottom, 0px));
          transition: bottom .15s;
          width: 40px; height: 40px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          background: var(--bg-tertiary); border: 1px solid var(--border2);
          color: var(--text-primary);
          cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.5);
          -webkit-tap-highlight-color: transparent;
        }
        .ai-jump:active { transform: translateX(-50%) scale(.94); }
        /* On a desktop it is a panel, not a sheet: nothing to swipe, and a
           full-height column of chat on a wide screen reads badly. The
           breakpoint is the shell's own — the sidebar appears at 901px, and
           anything narrower is still a screen you hold. */
        @media (min-width: 901px) {
          .ai-backdrop { align-items: center; }
          .ai-sheet { height: 80vh; border-radius: 12px; border-bottom: 1px solid var(--border2); }
          /* Nothing to swipe with a mouse. */
          .ai-grip { display: none; }
          /* A desktop browser does not zoom the page when a box is
             focused, so the composer can match the rest of the page. */
          .ai-box { font-size: 14px; }
        }
      `}</style>
    </div>
  );
};

/**
 * The floating button that opens it, on phones only.
 *
 * It sits above the bottom bar rather than in it: the bar's four buttons are
 * places in the app, and this is an action that can be taken from any of
 * them. It hides itself on the AI page — a button that goes where you
 * already are is just something covering the text.
 */
export const AiFab = ({ onClick, hidden }: { onClick: () => void; hidden?: boolean }) => {
  if (hidden) return null;
  return (
    <button
      onClick={onClick}
      aria-label="AI"
      className="ai-fab"
    >
      <IconSpark size={22} />
      <style>{`
        .ai-fab {
          position: fixed;
          right: 16px;
          /* Clear of the bottom bar, and of the home indicator under it. */
          bottom: calc(68px + env(safe-area-inset-bottom, 0px));
          width: 52px; height: 52px; border-radius: 50%;
          display: none; align-items: center; justify-content: center;
          background: var(--accent-blue);
          color: #10141b;
          border: 1px solid rgba(255,255,255,.18);
          box-shadow: 0 6px 18px rgba(0,0,0,.45);
          cursor: pointer; z-index: 60;
          -webkit-tap-highlight-color: transparent;
        }
        .ai-fab:active { transform: scale(.94); }
        /* Wherever the sidebar is not — the sidebar is the only other way
           in. At 767px this left a gap from 768 to 900 with neither: an
           unfolded Pixel Fold lands at about 840 and had no way to open the
           assistant at all. */
        @media (max-width: 900px) {
          .ai-fab { display: flex; }
        }
      `}</style>
    </button>
  );
};
