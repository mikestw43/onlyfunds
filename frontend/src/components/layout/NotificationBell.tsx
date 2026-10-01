import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchNotifications } from '../../services/api';
import type { NotificationLogEntry } from '../../types';
import { readAlert } from './alertText';

// Format relative time
const relTime = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

// Persistent "last seen" so badge resets on open
const LS_KEY = 'noti_last_seen';
const getLastSeen = (): number => parseInt(localStorage.getItem(LS_KEY) || '0', 10);
const setLastSeen = ()  => localStorage.setItem(LS_KEY, Date.now().toString());

export const NotificationBell = () => {
  const [open, setOpen]           = useState(false);
  const [lastSeen, setLastSeenSt] = useState(getLastSeen);
  const panelRef                  = useRef<HTMLDivElement>(null);
  const queryClient               = useQueryClient();

  // Fetch latest 20 notifications (only when panel is open or on mount)
  const { data } = useQuery({
    queryKey: ['notifications-bell'],
    queryFn: () => fetchNotifications(1, 20),
    refetchInterval: open ? 10_000 : 60_000,
    staleTime: 5_000,
  });

  const logs: NotificationLogEntry[] = data?.logs ?? [];

  // Count unread = logs newer than lastSeen
  const unreadCount = logs.filter(l => new Date(l.sentAt).getTime() > lastSeen).length;

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(o => {
      if (!o) {
        // opening — mark all as read
        setLastSeen();
        setLastSeenSt(Date.now());
      }
      return !o;
    });
  }, []);

  const handleClear = () => {
    // No backend clear; just mark all as seen and close
    setLastSeen();
    setLastSeenSt(Date.now());
    setOpen(false);
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Refetch when opened
  useEffect(() => {
    if (open) queryClient.invalidateQueries({ queryKey: ['notifications-bell'] });
  }, [open, queryClient]);

  return (
    <div style={{ position: 'relative' }} ref={panelRef}>
      {/* Bell button */}
      <button
        onClick={handleToggle}
        title="Notifications"
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
        onMouseEnter={e => { if (!open) { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent-blue)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent-blue)'; }}}
        onMouseLeave={e => { if (!open) { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border2)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'; }}}
      >
        {/* Bell SVG */}
        <svg width="14" height="16" viewBox="0 0 14 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
          <path d="M7 1a1 1 0 0 0-1 1v.5A5 5 0 0 0 2 7.5V11l-1.5 1.5v.5h13V12.5L12 11V7.5A5 5 0 0 0 8 2.5V2a1 1 0 0 0-1-1z"/>
          <path d="M5.5 13a1.5 1.5 0 0 0 3 0"/>
        </svg>

        {/* Red badge */}
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: '-5px', right: '-5px',
            minWidth: '16px', height: '16px',
            background: 'var(--danger)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)',
            color: '#fff', padding: '0 3px',
            lineHeight: 1,
          }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0,
          zIndex: 600,
          background: 'var(--bg-card)',
          border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)',
          width: '290px',
          maxHeight: '360px',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Header */}
          <div style={{
            padding: '9px 14px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexShrink: 0,
          }}>
            <span style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', color: 'var(--text-primary)', letterSpacing: '1px' }}>
              NOTIFICATIONS
            </span>
            <button
              onClick={handleClear}
              style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-muted)', cursor: 'pointer', background: 'none', border: 'none', padding: 0, transition: 'color .15s' }}
              onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--danger)')}
              onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)')}
            >
              CLEAR ALL
            </button>
          </div>

          {/* List */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {logs.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)', color: 'var(--text-muted)' }}>
                No notifications
              </div>
            ) : (
              logs.map(log => {
                const isUnread = new Date(log.sentAt).getTime() > lastSeen;
                return (
                  <div
                    key={log.id}
                    style={{
                      padding: '10px 14px',
                      borderBottom: '1px solid var(--border-color)',
                      borderLeft: isUnread ? '2px solid var(--accent-blue)' : '2px solid transparent',
                      cursor: 'default',
                      transition: 'background .1s',
                    }}
                    onMouseEnter={e => ((e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,.03)')}
                    onMouseLeave={e => ((e.currentTarget as HTMLDivElement).style.background = 'transparent')}
                  >
                    {/* Type badge + title */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                      <span style={{
                        fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)',
                        padding: '2px 4px',
                        border: `1px solid ${log.success ? 'rgba(52,211,153,.4)' : 'rgba(248,113,113,.4)'}`,
                        color: log.success ? 'var(--success)' : 'var(--danger)',
                        background: log.success ? 'rgba(52,211,153,.06)' : 'rgba(248,113,113,.06)',
                        flexShrink: 0,
                      }}>
                        {log.type.replace(/_/g, ' ').toUpperCase()}
                      </span>
                    </div>
                    {/* The account and the figure that caused it, then the
                        limit and the supporting number underneath. What is
                        stored is Telegram's own markup; printing it here
                        showed the tags. */}
                    {(() => {
                      const a = readAlert(log.message);
                      if (!a.account) {
                        return (
                          <div style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)', color: 'var(--text-primary)', lineHeight: 1.35 }}>
                            {a.plain}
                          </div>
                        );
                      }
                      return (
                        <>
                          <div style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)', color: 'var(--text-primary)', marginBottom: '2px', lineHeight: 1.35 }}>
                            <strong>{a.account}</strong>
                            {' — '}{a.label}
                            {a.value && (
                              <strong style={{ color: log.success ? 'var(--text-primary)' : 'var(--danger)' }}>
                                {' '}{a.value}
                              </strong>
                            )}
                          </div>
                          {a.detail && (
                            <div style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-dim)', lineHeight: 1.5 }}>
                              {a.detail}
                            </div>
                          )}
                        </>
                      );
                    })()}
                    <div style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-muted)', marginTop: '3px' }}>
                      {relTime(log.sentAt)}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
