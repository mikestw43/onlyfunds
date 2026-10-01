import { useQuery } from '@tanstack/react-query';
import { fetchAnnouncements } from '../../services/api';
import { useUIStore } from '../../stores/uiStore';
import { IconMegaphone } from '../icons';
import { useLastSeen } from './announceSeen';

/**
 * Unread notices, as their own mark next to the bell.
 *
 * Deliberately not folded into the bell. That one carries drawdown and
 * margin warnings about this person's money, and a release note must never
 * be able to push one of those out of sight or add to a count someone
 * reads as "something is wrong with my accounts". Two marks, two meanings.
 *
 * "Read" is per browser, like the bell's: the server has no business
 * recording when somebody glanced at a notice, and a count that followed
 * you between devices would be more surprising than useful.
 */
export const AnnounceButton = () => {
  const go = useUIStore(s => s.setCurrentPage);
  const page = useUIStore(s => s.currentPage);

  const { data = [] } = useQuery({
    queryKey: ['announcements'],
    queryFn: fetchAnnouncements,
    // A notice is not urgent. Often enough that one posted this morning is
    // there by lunchtime, rarely enough to be free.
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });

  // Recomputed whenever the page marks them read, so the count clears
  // without a reload.
  const seen = useLastSeen();
  const unread = data.filter(a => new Date(a.createdAt).getTime() > seen).length;
  const open = page === 'announce';

  return (
    <button
      onClick={() => go('announce')}
      title="Announcements"
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
      onMouseEnter={e => { if (!open) { e.currentTarget.style.borderColor = 'var(--accent-blue)'; e.currentTarget.style.color = 'var(--accent-blue)'; }}}
      onMouseLeave={e => { if (!open) { e.currentTarget.style.borderColor = 'var(--border2)'; e.currentTarget.style.color = 'var(--text-muted)'; }}}
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
  );
};
