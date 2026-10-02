import { useState } from 'react';

type DownloadVariant = {
  platform: 'MT4' | 'MT5';
  filename: string;
  ext: string;
};

type EaRelease = {
  name: string;
  version: string;
  description: string;
  downloads: DownloadVariant[];
};

/** EA catalog — one entry per EA, with both platform variants inside. */
const EA_RELEASES: EaRelease[] = [
  {
    name: 'OnlyFunds AI',
    version: 'v1.5',
    description:
      'Reports the account AND carries out the orders the dashboard sends, ' +
      'once you set EnableTrading = true on its chart. Also closes part of a ' +
      'position, and sends the contract figures the assistant needs before ' +
      'it will say anything about lot sizes. Put this one on a demo account ' +
      'first. Take the .EX5 — it is already compiled, and drops straight into ' +
      'MQL5/Experts. The source is there for anyone who wants to read it.',
    downloads: [
      { platform: 'MT5', filename: 'OnlyFunds_AI_v1.5.ex5', ext: '.EX5' },
      { platform: 'MT5', filename: 'OnlyFunds_AI_v1.5.mq5', ext: '.MQ5 SOURCE' },
    ],
  },
  {
    name: 'OnlyFunds Report',
    version: 'v1.5',
    description:
      'The same reporting and the same contract figures, with the trading ' +
      'code left out of the build entirely — not switched off: absent. There ' +
      'is no setting to find and nothing the server sends can make it place, ' +
      'change or close an order. This is the one for accounts where real ' +
      'money is working. Take the .EX5; the source is there to be read, and ' +
      'reading it is how you confirm there is no trading code in it.',
    downloads: [
      { platform: 'MT5', filename: 'OnlyFunds_Report_v1.5.ex5', ext: '.EX5' },
      { platform: 'MT5', filename: 'OnlyFunds_Report_v1.5.mq5', ext: '.MQ5 SOURCE' },
    ],
  },
  {
    name: 'OnlyFunds Reporter',
    version: 'v1.1',
    description:
      'The old report-only build, kept for MT4 — v1.5 is MT5 only, and this ' +
      'is the only .MQ4 there is. On MT5 take OnlyFunds Report instead: it ' +
      'reports the same things and adds the contract figures the assistant ' +
      'needs before it will say anything about lot sizes.',
    // There is no compiled .ex4, and a button for one would just 404. The
    // MT4 source is here though: the description points MT4 users at it, so
    // leaving it off the list would be a promise the page does not keep.
    downloads: [
      { platform: 'MT5', filename: 'OnlyFunds_Reporter_v1.1.ex5', ext: '.EX5' },
      { platform: 'MT4', filename: 'OnlyFunds_Reporter_v1.1.mq4', ext: '.MQ4 SOURCE' },
    ],
  },
];

// The EA must point at whatever host is serving this dashboard, so read it
// from the browser. VITE_SERVER_URL overrides it if the API lives elsewhere.
const SERVER_URL = import.meta.env.VITE_SERVER_URL || window.location.origin;

const INSTALL_STEPS = [
  'Open MetaTrader → File → Open Data Folder',
  'Navigate to MQL5/Experts',
  'Copy the downloaded file into the Experts folder',
  'A .mq5 must be opened in MetaEditor and compiled (F7) first',
  'Restart MetaTrader or refresh Navigator',
  'Drag EA onto any chart, set your API Key',
  'Enable AutoTrading, add ServerURL to WebRequest whitelist',
];

export const DownloadPage = () => {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(SERVER_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setRevealed(true);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Page header */}
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)',
        padding: '16px 20px',
      }}>
        <div style={{ fontFamily: 'var(--ff-title)', fontSize: 'var(--fs-title)', color: 'var(--text-primary)', letterSpacing: '1px' }}>
          DOWNLOAD EA
        </div>
        <div style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)', color: 'var(--text-muted)', marginTop: '6px' }}>
          Expert Advisors for MetaTrader 4 + 5
        </div>
      </div>

      {/* EA boxes — one per release, both platform variants inside */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {EA_RELEASES.map(ea => (
          <div key={ea.name + ea.version} style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)',
            padding: '18px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}>
            {/* EA name as header */}
            <div>
              <div style={{
                fontFamily: 'var(--ff-title)', fontSize: 'var(--fs-section)',
                color: 'var(--text-primary)', letterSpacing: '1px',
              }}>
                {ea.name.toUpperCase()} {ea.version}
              </div>
              <div style={{
                fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)',
                color: 'var(--text-muted)', marginTop: '4px',
              }}>
                {ea.description}
              </div>
            </div>

            {/* Compact download buttons — sit inline, no nested tile box */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {ea.downloads.map(d => (
                <a
                  key={d.filename}
                  href={`/ea/${d.filename}`}
                  download
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '7px 12px',
                    background: 'rgba(96,165,250,.06)',
                    border: '1px solid var(--cyan)',
                    color: 'var(--cyan)',
                    fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)',
                    letterSpacing: '1px',
                    textDecoration: 'none',
                    cursor: 'pointer',
                    transition: 'background .15s',
                  }}
                  onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.background = 'rgba(96,165,250,.12)')}
                  onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.background = 'rgba(96,165,250,.06)')}
                >
                  <PixelDownloadIcon pixelSize={2} />
                  <span>{d.platform} {d.ext}</span>
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Installation guide */}
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)',
        padding: '16px 20px',
      }}>
        <div style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', color: 'var(--text-muted)', letterSpacing: '1px', marginBottom: '14px' }}>
          INSTALLATION GUIDE
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {INSTALL_STEPS.map((text, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
              <span style={{
                fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)',
                color: 'var(--cyan)', flexShrink: 0, marginTop: '2px',
              }}>{String(i + 1).padStart(2, '0')}</span>
              <span style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)', color: 'var(--text-muted)' }}>{text}</span>
            </div>
          ))}
        </div>

        {/* WebRequest whitelist — URL is blurred until reveal/copy */}
        <div style={{
          marginTop: '16px',
          padding: '10px 14px',
          background: 'rgba(251,191,36,.05)',
          border: '1px solid rgba(251,191,36,.25)',
          fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)', color: 'var(--text-muted)',
        }}>
          <div style={{ color: 'var(--warning)', fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', letterSpacing: '1px', marginBottom: '6px' }}>
            ⚠ WEBREQUEST WHITELIST
          </div>
          Tools → Options → Expert Advisors → Allow WebRequest for listed URL:

          <div style={{
            marginTop: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
          }}>
            <span
              style={{
                fontFamily: 'var(--ff-mono)',
                color: 'var(--cyan)',
                wordBreak: 'break-all',
                flex: 1,
                minWidth: 0,
                userSelect: revealed ? 'text' : 'none',
                filter: revealed ? 'none' : 'blur(5px)',
                transition: 'filter .2s',
                cursor: revealed ? 'text' : 'pointer',
              }}
              onClick={() => setRevealed(true)}
              title={revealed ? '' : 'Click to reveal'}
            >
              {SERVER_URL}
            </span>
            <button
              onClick={handleCopy}
              style={{
                padding: '6px 12px',
                background: copied ? 'rgba(52,211,153,.15)' : 'rgba(96,165,250,.08)',
                border: `1px solid ${copied ? 'var(--green)' : 'var(--cyan)'}`,
                color: copied ? 'var(--green)' : 'var(--cyan)',
                fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)',
                letterSpacing: '.5px',
                cursor: 'pointer',
                flexShrink: 0,
                transition: 'all .15s',
              }}
            >
              {copied ? '✓ COPIED' : '⧉ COPY'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/** Pixel-art download arrow — drawn from divs so it stays crisp at any size
 *  and matches the rest of the retro/pixel UI (no fuzzy unicode glyph). */
const PixelDownloadIcon = ({ pixelSize = 3 }: { pixelSize?: number }) => {
  const px = pixelSize;
  const cyan = 'currentColor';
  // Coordinates of "on" pixels in a 7-wide × 8-tall grid
  const pixels: [number, number][] = [
    // shaft (col 3, rows 0-3)
    [3, 0], [3, 1], [3, 2], [3, 3],
    // arrowhead row 4 (cols 1-5)
    [1, 4], [2, 4], [3, 4], [4, 4], [5, 4],
    // arrowhead row 5 (cols 2-4)
    [2, 5], [3, 5], [4, 5],
    // arrowhead tip row 6 (col 3)
    [3, 6],
    // baseline / tray row 7 (cols 0-6)
    [0, 7], [1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7],
  ];
  return (
    <div style={{
      position: 'relative',
      width: `${7 * px}px`,
      height: `${8 * px}px`,
      color: cyan,
    }}>
      {pixels.map(([x, y]) => (
        <div
          key={`${x}-${y}`}
          style={{
            position: 'absolute',
            left: `${x * px}px`,
            top: `${y * px}px`,
            width: `${px}px`,
            height: `${px}px`,
            background: 'currentColor',
          }}
        />
      ))}
    </div>
  );
};
