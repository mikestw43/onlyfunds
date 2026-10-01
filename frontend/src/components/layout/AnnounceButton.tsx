import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAnnouncements } from '../../services/api';
import { useTranslation } from '../../i18n/useTranslation';
import { IconMegaphone } from '../icons';
import { markAnnouncementsSeen, clearAnnouncements, useSeenIds, useClearedIds } from './announceSeen';

/**
 * Notices from whoever runs the dashboard, as a panel of their own next to
 * the bell.
 *
 * Deliberately not folded into that bell. It carries drawdown and margin
 * warnings about the reader's own money, and a release note must never be
 * able to push one out of the list or add to a number people read as
 * "something is wrong with my accounts". Two marks, two meanings, and this
 * one is blue where the bell's is red.
 *
 * Reading happens here; writing happens on the admin page. That split is
 * also what makes the count behave: posting no longer marks the notice as
 * read, so an admin who posts one sees the mark appear like everybody
 * else, and opening this panel is what clears it.
 */

const TYPE_COLOR: Record<string, string> = {
  info: 'var(--cyan)',
  warning: 'var(--yellow)',
  update: 'var(--green)',
  maintenance: 'var(--orange)',
};

const relTime = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

export const AnnounceButton = () => {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const { data: all = [] } = useQuery({
    queryKey: ['announcements'],
    queryFn: fetchAnnouncements,
    // A notice is not urgent. Often enough that one posted this morning is
    // there by lunchtime, rarely enough to be free.
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });

  const seen = useSeenIds();
  const cleared = useClearedIds();
  // What this reader has cleared is gone from their panel and from their
  // count — but still on the admin page, and still on everyone else's.
  const data = all.filter(a => !cleared.has(a.id));
  const unread = data.filter(a => !seen.has(a.id)).length;
  // Which ones were new when the panel was opened. Kept separately
  // because marking them read updates `seen` immediately — without this
  // snapshot every notice would lose its mark in the same frame it was
  // shown, and nothing would ever look new.
  const [freshAtOpen, setFreshAtOpen] = useState<Set<string>>(new Set());

  // Opening the panel is reading them. Marked on the way in rather than on
  // the way out, so the count goes the moment they are on screen.
  const toggle = () => {
    setOpen(o => {
      if (!o) {
        setFreshAtOpen(new Set(data.filter(a => !seen.has(a.id)).map(a => a.id)));
        if (data.length) markAnnouncementsSeen(data.map(a => a.id));
      }
      return !o;
    });
  };

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  return (
    <div style={{ position: 'relative' }} ref={panelRef}>
      <button
        onClick={toggle}
        title={t('announce.title')}
        style={{
          width: '30px', height: '30px',
          border: `1px solid ${open ? 'var(--accent-blue)' : 'var(--border2)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: open ? 'var(--accent-blue)' : 'var(--text-muted)',
          fontSize: '13px', cursor: 'pointer',
          background: open ? 'rgba(96,165,250,.08)' : 'none',
          transition: 'all .15s',
          position: 'relative',
          flexShrink: 0,
        }}
        onMouseEnter={e => { if (!open) { e.currentTarget.style.borderColor = 'var(--accent-blue)'; e.currentTarget.style.color = 'var(--accent-blue)'; } }}
        onMouseLeave={e => { if (!open) { e.currentTarget.style.borderColor = 'var(--border2)'; e.currentTarget.style.color = 'var(--text-muted)'; } }}
      >
        <IconMegaphone size={15} />

        {/* Blue, where the bell's is red: this one is news, not a warning. */}
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: '-5px', right: '-5px',
            minWidth: '16px', height: '16px',
            background: 'var(--accent-blue)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)',
            color: '#10141b', padding: '0 3px',
            lineHeight: 1,
          }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="ann-panel" style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0,
          zIndex: 600,
          background: 'var(--bg-card)',
          border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)',
          width: '300px',
          maxHeight: '380px',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            padding: '9px 14px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexShrink: 0,
          }}>
            <span style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', color: 'var(--text-primary)', letterSpacing: '1px' }}>
              {t('announce.title')}
            </span>
            {data.length > 0 && (
              <button
                onClick={() => clearAnnouncements(data.map(a => a.id))}
                style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-muted)', cursor: 'pointer', background: 'none', border: 'none', padding: 0, transition: 'color .15s' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--danger)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
              >
                {t('announce.clear_all')}
              </button>
            )}
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {data.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)', color: 'var(--text-muted)' }}>
                {t('announce.empty')}
              </div>
            ) : data.map(a => {
              const colour = TYPE_COLOR[a.type] || 'var(--text-dim)';
              // Against the snapshot from when the panel opened, so the
              // ones that cleared the count still carry their mark while
              // they are being read.
              const fresh = freshAtOpen.has(a.id);
              return (
                <div
                  key={a.id}
                  style={{
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--border-color)',
                    borderLeft: `2px solid ${fresh ? colour : 'transparent'}`,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px', flexWrap: 'wrap' }}>
                    {a.pinned && (
                      <span style={{ fontFamily: 'var(--ff-micro)', fontSize: 'var(--fs-micro)', color: 'var(--yellow)', letterSpacing: '.5px' }}>
                        {t('announce.pinned')}
                      </span>
                    )}
                    <span style={{ fontFamily: 'var(--ff-micro)', fontSize: 'var(--fs-micro)', color: colour, letterSpacing: '.5px' }}>
                      {a.type.toUpperCase()}
                    </span>
                    <span style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-dim)', marginLeft: 'auto' }}>
                      {relTime(a.createdAt)}
                    </span>
                  </div>
                  <div style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)', color: 'var(--text)', marginBottom: '2px' }}>
                    {a.title}
                  </div>
                  <div style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-muted)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                    {a.body}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Anchored to the button on a wide screen, where there is room to
          its left. On a phone 300px from the button's right edge runs off
          the side of the screen, so it anchors to the screen instead. */}
      <style>{`
        @media (max-width: 480px) {
          .ann-panel {
            position: fixed !important;
            left: 8px !important;
            right: 8px !important;
            width: auto !important;
            top: 52px !important;
          }
        }
      `}</style>
    </div>
  );
};
