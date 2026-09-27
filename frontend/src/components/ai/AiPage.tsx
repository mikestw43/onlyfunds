import { useEffect, useRef, useState } from 'react';
import { askAi, fetchAiContext, fetchAiStatus, type AiContext, type AiStatus, fetchAiChats, fetchAiChat, deleteAiChat, truncateAiChat,
  type AiChatSummary, fetchAccounts } from '../../services/api';
import type { Account } from '../../types';
import { useTranslation } from '../../i18n/useTranslation';
import { useUIStore } from '../../stores/uiStore';
import { IconSpark, IconMic, IconPlus, IconCopy, IconRetry, IconPencil, IconArrowUp } from '../icons';
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

  /** A "/" that begins a word, and whatever has been typed after it. */
  const SLASH = /(?:^|\s)\/([^\s/]*)$/;

  const onDraft = (value: string, caret: number) => {
    setDraft(value);
    const m = value.slice(0, caret).match(SLASH);
    // The slash itself sits one character before what was typed after it.
    setSlash(m ? { at: caret - m[1].length - 1, query: m[1] } : null);
    setHi(0);
  };

  const picks = slash
    ? accounts.filter(a => {
        const q = slash.query.toLowerCase();
        return q === ''
          || a.name.toLowerCase().includes(q)
          || String(a.accountNumber ?? '').includes(q);
      }).slice(0, 6)
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

      {/* Typing "/" offers the accounts by name */}
      {picks.length > 0 && (
        <div className="ai-pick" role="listbox" aria-label={t('ai.pick_account')}>
          {picks.map((a, i) => (
            <button
              key={a.id}
              role="option"
              aria-selected={i === hi}
              // Pointer down, and prevented: a tap that let the textarea
              // blur first would shut the phone keyboard and scroll the
              // sheet out from under the finger mid-tap.
              onPointerDown={e => { e.preventDefault(); pick(a); }}
              className={i === hi ? 'ai-pick-row ai-pick-on' : 'ai-pick-row'}
            >
              <span className="ai-pick-name">{a.name}</span>
              {a.isDemo && <span className="ai-pick-tag">DEMO</span>}
              <span className="ai-pick-num">#{a.accountNumber}</span>
            </button>
          ))}
        </div>
      )}

      {/* Composer */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', minWidth: 0 }}>
        {/* A label, not a button that calls click() on a hidden input: iOS
            only opens the picker for a real activation, and a programmatic
            click from pointerdown is not one — the button did nothing at
            all on the phone. Tapping a label is the browser's own path to
            the input and needs no script.
            accept="image/*" with no capture attribute is what makes the
            phone offer the camera and the library both. */}
        <label className="ai-plus" title={t('ai.attach')} aria-label={t('ai.attach')}>
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
            // The "/" is worth nothing if only the person who asked for it
            // knows it is there, and the placeholder is the one piece of
            // text read by someone about to type. Only with more than one
            // account: with one there is nothing to choose between.
            placeholder={
              mic.listening ? t('ai.listening')
                : accounts.length > 1 ? t('ai.ask_placeholder_slash')
                : t('ai.ask_placeholder')
            }
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
