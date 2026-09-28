import type { ReactNode } from 'react';

/**
 * One outline icon family for the whole shell — the bottom bar, the sidebar
 * and the account menu.
 *
 * They replace a mix of typographic glyphs (◈ ▦ ⏻ …) that rendered at a
 * different weight and baseline on every device, and squares-and-lines SVGs
 * that read as neither a house nor a chart. All of these are drawn on the
 * same 24×24 grid with the same stroke, so a row of them lines up.
 *
 * Every path uses `currentColor`, so an icon inherits the colour of the
 * button it sits in — active, muted or danger — with nothing to keep in sync.
 */

interface SvgProps {
  /** Rendered box, in px. The grid is always 24, so the stroke scales with it. */
  size?: number;
  /** Heavier for the small standalone marks (the bars) that would vanish otherwise. */
  stroke?: number;
  children: ReactNode;
}

const Svg = ({ size = 18, stroke = 1.75, children }: SvgProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    style={{ flexShrink: 0, display: 'block' }}
  >
    {children}
  </svg>
);

export type IconProps = { size?: number };

// ── Main navigation ──────────────────────────────────────────────────────────

export const IconHome = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M4.8 10.4 12 4.2l7.2 6.2V19a1.5 1.5 0 0 1-1.5 1.5H6.3A1.5 1.5 0 0 1 4.8 19z" />
  </Svg>
);

/** Trades: three candles. A price chart, not the three stacked lines that
 *  everyone reads as a hamburger menu. */
export const IconCandles = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M6 6.5v2.2M6 15.3v2.2" />
    <rect x="4" y="8.7" width="4" height="6.6" rx="1" />
    <path d="M12.5 3.5v3M12.5 17.5v3" />
    <rect x="10.5" y="6.5" width="4" height="11" rx="1" />
    <path d="M19 7.5v1.8M19 14.7v1.8" />
    <rect x="17" y="9.3" width="4" height="5.4" rx="1" />
  </Svg>
);

export const IconCalendar = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M8 2.8v3.4M16 2.8v3.4" />
    <rect x="3.2" y="4.5" width="17.6" height="16.7" rx="2.2" />
    <path d="M3.2 10h17.6" />
  </Svg>
);

/** Stats: three ascending bars, drawn as thick round-capped strokes so they
 *  keep their shape at 18px instead of turning into grey smudges. */
export const IconBars = ({ size }: IconProps) => (
  <Svg size={size} stroke={2.6}>
    <path d="M6 20v-5.5M12 20v-9.5M18 20v-14" />
  </Svg>
);

// ── Account menu ─────────────────────────────────────────────────────────────

export const IconUser = ({ size }: IconProps) => (
  <Svg size={size}>
    <circle cx="12" cy="7.8" r="3.9" />
    <path d="M19 20.4v-1.6a4.2 4.2 0 0 0-4.2-4.2H9.2A4.2 4.2 0 0 0 5 18.8v1.6" />
  </Svg>
);

export const IconGear = ({ size }: IconProps) => (
  <Svg size={size} stroke={1.6}>
    <circle cx="12" cy="12" r="3.1" />
    <path d="M12.22 2.6h-.44a1.9 1.9 0 0 0-1.9 1.9v.2a1.9 1.9 0 0 1-.95 1.64l-.4.23a1.9 1.9 0 0 1-1.9 0l-.16-.09a1.9 1.9 0 0 0-2.6.7l-.22.38a1.9 1.9 0 0 0 .7 2.6l.16.09a1.9 1.9 0 0 1 .95 1.64v.46a1.9 1.9 0 0 1-.95 1.65l-.16.09a1.9 1.9 0 0 0-.7 2.6l.22.38a1.9 1.9 0 0 0 2.6.7l.16-.09a1.9 1.9 0 0 1 1.9 0l.4.23a1.9 1.9 0 0 1 .95 1.64v.2a1.9 1.9 0 0 0 1.9 1.9h.44a1.9 1.9 0 0 0 1.9-1.9v-.2a1.9 1.9 0 0 1 .95-1.64l.4-.23a1.9 1.9 0 0 1 1.9 0l.16.09a1.9 1.9 0 0 0 2.6-.7l.22-.38a1.9 1.9 0 0 0-.7-2.6l-.16-.09a1.9 1.9 0 0 1-.95-1.65v-.46a1.9 1.9 0 0 1 .95-1.64l.16-.09a1.9 1.9 0 0 0 .7-2.6l-.22-.38a1.9 1.9 0 0 0-2.6-.7l-.16.09a1.9 1.9 0 0 1-1.9 0l-.4-.23a1.9 1.9 0 0 1-.95-1.64v-.2a1.9 1.9 0 0 0-1.9-1.9z" />
  </Svg>
);

export const IconDownload = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M12 3.4v11.2" />
    <path d="m7.4 10 4.6 4.6 4.6-4.6" />
    <path d="M20.4 15.2V19a1.8 1.8 0 0 1-1.8 1.8H5.4A1.8 1.8 0 0 1 3.6 19v-3.8" />
  </Svg>
);

/** Sliders, not a gear: a gear says settings, and these are filters — the
 *  four pages that offer them were all using a ⚙ emoji, which renders at
 *  whatever weight and baseline the device feels like and matches nothing
 *  else in the shell. */
export const IconFilter = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M4 7h10" />
    <path d="M18.5 7H20" />
    <circle cx="16.2" cy="7" r="2.3" />
    <path d="M4 17h4.2" />
    <path d="M12.7 17H20" />
    <circle cx="10.4" cy="17" r="2.3" />
  </Svg>
);

/** Paper plane — Telegram. It was a ✈ emoji, which each phone draws in its
 *  own colour and weight, next to outline icons. */
export const IconSend = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M21 3 10.5 13.5" />
    <path d="M21 3l-6.6 18-3.9-7.5L3 9.6 21 3z" />
  </Svg>
);

/** A card with a title line and a rule — the settings account panel. */
export const IconCard = ({ size }: IconProps) => (
  <Svg size={size}>
    <rect x="3" y="5" width="18" height="14" rx="2.2" />
    <path d="M3 10h18" />
    <path d="M7 14.5h4" />
  </Svg>
);

/** Stacked lines — a report. */
export const IconReport = ({ size }: IconProps) => (
  <Svg size={size}>
    <rect x="4" y="3" width="16" height="18" rx="2.2" />
    <path d="M8 8h8" />
    <path d="M8 12h8" />
    <path d="M8 16h5" />
  </Svg>
);

/** A running band of quotes — the ticker. */
export const IconTicker = ({ size }: IconProps) => (
  <Svg size={size}>
    <rect x="2.5" y="7" width="19" height="10" rx="2" />
    <path d="M6 11.2h2.6" />
    <path d="M11 11.2h2.2" />
    <path d="M15.6 11.2h2.4" />
    <path d="M6 14h3.4" />
    <path d="M12 14h6" />
  </Svg>
);

/** A bell — notifications. */
export const IconBell = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M18 9.4a6 6 0 1 0-12 0c0 5.2-2 6.6-2 6.6h16s-2-1.4-2-6.6" />
    <path d="M13.7 19.4a2 2 0 0 1-3.4 0" />
  </Svg>
);

export const IconUsers = ({ size }: IconProps) => (
  <Svg size={size}>
    <circle cx="9.2" cy="7.6" r="3.6" />
    <path d="M15.8 20.4v-1.5a4 4 0 0 0-4-4H6.6a4 4 0 0 0-4 4v1.5" />
    <path d="M16.4 4.4a3.6 3.6 0 0 1 0 6.9" />
    <path d="M21.4 20.4v-1.5a4 4 0 0 0-3-3.86" />
  </Svg>
);

/** EA Repository: a shipping box — a package of files you take away. */
export const IconPackage = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M20.4 8.1a1.8 1.8 0 0 0-.9-1.56l-6.6-3.8a1.8 1.8 0 0 0-1.8 0l-6.6 3.8A1.8 1.8 0 0 0 3.6 8.1v7.8a1.8 1.8 0 0 0 .9 1.56l6.6 3.8a1.8 1.8 0 0 0 1.8 0l6.6-3.8a1.8 1.8 0 0 0 .9-1.56z" />
    <path d="m3.85 7.1 8.15 4.75 8.15-4.75" />
    <path d="M12 21.4v-9.55" />
  </Svg>
);

export const IconMegaphone = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="m3.2 10.8 17.6-4.9v12.2L3.2 13.9z" />
    <path d="M11.4 16.5a2.9 2.9 0 1 1-5.6-1.6" />
  </Svg>
);

export const IconLanguages = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M2.6 5.2h9.6" />
    <path d="M7.2 3v2.2" />
    <path d="M9.8 5.2c0 3.9-2.7 7.2-6.4 8.4" />
    <path d="M5.6 9.4c.9 2 2.7 3.6 4.9 4.2" />
    <path d="m13.4 21.4 4.1-8.6 4.1 8.6" />
    <path d="M15.1 17.9h4.8" />
  </Svg>
);

export const IconPower = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M12 3v9" />
    <path d="M18.1 7a8.4 8.4 0 1 1-12.2 0" />
  </Svg>
);

/**
 * The mark on an entry worth coming back to.
 *
 * A bookmark rather than a star: the repository now rates entries out of five
 * stars, and one glyph cannot mean both "I flagged this" and "this scored 1".
 * Filled when the entry is marked, outlined when it is not, so the toggle
 * reads without its label.
 */
export const IconBookmark = ({ size = 18, filled }: IconProps & { filled?: boolean }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    style={{ flexShrink: 0, display: 'block' }}
  >
    <path d="M6 3h12a1.5 1.5 0 0 1 1.5 1.5V21l-7.5-4.3L4.5 21V4.5A1.5 1.5 0 0 1 6 3z" />
  </svg>
);

/** Opens the controls that change or remove one attachment. */
export const IconPencil = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M4 20.2h4.2L19.4 9a2.1 2.1 0 0 0-3-3L5.2 17.2z" />
    <path d="M14.6 6.8 17.2 9.4" />
  </Svg>
);

/** Removes it. A bin rather than a ✕, which on the same row would read as
 *  "cancel what I am typing" — the two sit side by side while editing. */
export const IconTrash = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M4.6 6.6h14.8" />
    <path d="M9.4 6.6V4.9a1.3 1.3 0 0 1 1.3-1.3h2.6a1.3 1.3 0 0 1 1.3 1.3v1.7" />
    <path d="M6.6 6.6 7.5 19a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l.9-12.4" />
  </Svg>
);

/** AI: a four-point spark. Drawn on the same grid as the rest rather than
 *  borrowed from an emoji font, which renders at a different weight and
 *  baseline on every device — the reason the old ⚙ and ✈ marks had to go. */
export const IconSpark = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M12 3.2 13.9 9 19.8 11 13.9 13 12 18.8 10.1 13 4.2 11 10.1 9z" />
    <path d="M18.4 3.6 19 5.4l1.8.6-1.8.6-.6 1.8-.6-1.8L16 5.9l1.8-.5z" />
  </Svg>
);

/** A microphone, for speaking instead of typing. Same grid, same stroke. */
export const IconMic = ({ size }: IconProps) => (
  <Svg size={size}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
    <path d="M12 18v3" />
  </Svg>
);

/** Add something: a plain plus, on the same grid as the rest. */
export const IconPlus = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

/** Copy: one sheet behind another. For taking an answer out of the chat. */
export const IconCopy = ({ size }: IconProps) => (
  <Svg size={size}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h8" />
  </Svg>
);

/** Ask again: a circle that comes back round to where it started. */
export const IconRetry = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M20 12a8 8 0 1 1-2.6-5.9" />
    <path d="M20 4v4.5h-4.5" />
  </Svg>
);

/** Send: straight up, the way every chat on a phone sends a message. */
export const IconArrowUp = ({ size }: IconProps) => (
  <Svg size={size} stroke={2.2}>
    <path d="M12 19V6" />
    <path d="M6 11.5 12 5.5l6 6" />
  </Svg>
);

// ── The order desk ───────────────────────────────────────────────────────────
//
// Emoji were quicker to write and wrong for the same reason the old ⚙ and ✈
// were: they come from the phone's own font, at its own weight and baseline,
// in its own colours — a row of them next to this family reads as a row of
// stickers. These are the family: 24×24, one stroke, currentColor, so each one
// takes the colour of the group it is in.

/** Quick commands. A bolt, not the assistant's sparkle — the button that
 *  opens the desk sits an inch from the one that opens the assistant, and
 *  two sparkles said the two did the same thing. */
export const IconBolt = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M13.2 3 5.8 13.2h5L9.9 21l7.4-10.2h-5z" />
  </Svg>
);

/** Where the account stands: the report page's own mark, at desk size. */
export const IconSummary = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M4 20h16" />
    <path d="M7 20v-6M12 20v-10M17 20v-4" />
  </Svg>
);

/** A stop that is not there: the shield, broken by the line through it. */
export const IconShieldOff = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M12 3.2 19 6v5.6c0 4-2.9 7.3-7 8.4-4.1-1.1-7-4.4-7-8.4V6z" />
    <path d="M4 20 20 4" />
  </Svg>
);

/** A stop that is there. */
export const IconShield = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M12 3.2 19 6v5.6c0 4-2.9 7.3-7 8.4-4.1-1.1-7-4.4-7-8.4V6z" />
    <path d="M9 11.8 11.3 14l4-4.2" />
  </Svg>
);

/** Two sides weighed against each other — buy against sell. */
export const IconScale = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M12 4v16" />
    <path d="M5 7h14" />
    <path d="M8.2 7 5.4 13h5.6zM15.8 7 13 13h5.6z" />
  </Svg>
);

/** Going the wrong way. */
export const IconTrendDown = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M4 8l5.5 5.5 3.5-3.5 6 6" />
    <path d="M19 12v4h-4" />
  </Svg>
);

/** Going the right way. */
export const IconTrendUp = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M4 16l5.5-5.5 3.5 3.5 6-6" />
    <path d="M19 12V8h-4" />
  </Svg>
);

/** Break-even: the stop, moved up to the line the position opened on. */
export const IconBreakEven = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M4 15h16" />
    <path d="M12 12V4" />
    <path d="M8.5 7.5 12 4l3.5 3.5" />
    <path d="M4 20h16" />
  </Svg>
);

/** Take part of it off: the position, cut in two. */
export const IconHalf = ({ size }: IconProps) => (
  <Svg size={size}>
    <rect x="4" y="7" width="16" height="10" rx="2" />
    <path d="M12 4v16" strokeDasharray="2.5 2.5" />
  </Svg>
);
