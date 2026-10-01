import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import {
  fetchAnnouncements, postAnnouncement, updateAnnouncement, deleteAnnouncement,
  type Announcement,
} from '../../services/api';
import { useTranslation } from '../../i18n/useTranslation';

const TYPE_CFG = {
  info:        { label: 'INFO',        color: 'var(--cyan)',   bg: 'rgba(96,165,250,.08)',  icon: '◈' },
  warning:     { label: 'WARNING',     color: 'var(--yellow)', bg: 'rgba(251,191,36,.08)',  icon: '▲' },
  update:      { label: 'UPDATE',      color: 'var(--green)',  bg: 'rgba(52,211,153,.08)',   icon: '▸' },
  maintenance: { label: 'MAINTENANCE', color: 'var(--orange)', bg: 'rgba(251,146,60,.08)', icon: '⚙' },
};

/** The list shows a day; the stamp is a full timestamp. */
const asDay = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

const emptyForm = { title: '', body: '', type: 'info' as Announcement['type'], pinned: false };

export const AnnouncePage = () => {
  const t = useTranslation();
  const user = useAuthStore(s => s.user);
  const isAdmin = user?.role === 'admin';
  const addToast = useUIStore(s => s.addToast);
  const qc = useQueryClient();

  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ['announcements'],
    queryFn: fetchAnnouncements,
  });

  // This page does not mark anything read. It is where notices are
  // written, and the panel in the header is where they are read — so an
  // admin who posts one sees the mark appear like everybody else, instead
  // of the act of writing silently counting as having read it.

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['announcements'] });
  const failed = (err: unknown) => addToast({
    type: 'error',
    title: (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'That did not go through',
  });

  const post = useMutation({
    mutationFn: postAnnouncement,
    onSuccess: () => { setForm(emptyForm); setShowForm(false); refresh(); },
    onError: failed,
  });

  const remove = useMutation({
    mutationFn: deleteAnnouncement,
    onSuccess: () => { setDeleteId(null); refresh(); },
    onError: (err) => { setDeleteId(null); failed(err); },
  });

  const pin = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) => updateAnnouncement(id, { pinned }),
    onSuccess: refresh,
    onError: failed,
  });

  const handlePost = () => {
    if (!form.title.trim() || !form.body.trim()) return;
    post.mutate({ title: form.title, body: form.body, type: form.type, pinned: form.pinned });
  };

  const handleDelete = (id: string) => remove.mutate(id);

  const pinned = announcements.filter(a => a.pinned);
  const regular = announcements.filter(a => !a.pinned);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Header */}
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)',
        padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontFamily: 'var(--ff-title)', fontSize: 'var(--fs-title)', color: 'var(--text-primary)', letterSpacing: '1px' }}>
            {t('announce.title')}
          </div>
          <div style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)', color: 'var(--text-muted)', marginTop: '6px' }}>
            {t('announce.subtitle')}
          </div>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowForm(p => !p)}
            style={{
              padding: '8px 16px',
              background: showForm ? 'rgba(248,113,113,.1)' : 'rgba(96,165,250,.1)',
              border: `1px solid ${showForm ? 'var(--red)' : 'var(--cyan)'}`,
              color: showForm ? 'var(--red)' : 'var(--cyan)',
              fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)',
              cursor: 'pointer', letterSpacing: '.5px',
            }}
          >
            {showForm ? `✕ ${t('announce.cancel')}` : `+ ${t('announce.post')}`}
          </button>
        )}
      </div>

      {/* Post form (admin only) */}
      {isAdmin && showForm && (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--cyan)',
          padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px',
        }}>
          <div style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', color: 'var(--text-primary)', fontWeight: 600, letterSpacing: '1px' }}>
            {t('announce.new')}
          </div>

          {/* Type selector */}
          <div style={{ display: 'flex', gap: '6px' }}>
            {(Object.keys(TYPE_CFG) as Announcement['type'][]).map(t => {
              const cfg = TYPE_CFG[t];
              const active = form.type === t;
              return (
                <button
                  key={t}
                  onClick={() => setForm(p => ({ ...p, type: t }))}
                  style={{
                    padding: '5px 12px',
                    border: `1px solid ${active ? cfg.color : 'var(--border2)'}`,
                    background: active ? cfg.bg : 'none',
                    color: active ? cfg.color : 'var(--text-muted)',
                    fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)',
                    cursor: 'pointer', letterSpacing: '.5px',
                  }}
                >
                  {cfg.icon} {cfg.label}
                </button>
              );
            })}
          </div>

          <input
            value={form.title}
            onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
            placeholder={t('announce.title_ph')}
            style={{
              background: 'var(--bg-card2)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)',
              color: 'var(--text)', fontFamily: 'var(--ff-input)', fontSize: 'var(--fs-input)',
              padding: '9px 12px', outline: 'none',
            }}
          />
          <textarea
            value={form.body}
            onChange={e => setForm(p => ({ ...p, body: e.target.value }))}
            placeholder={t('announce.body_ph')}
            rows={4}
            style={{
              background: 'var(--bg-card2)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)',
              color: 'var(--text)', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)',
              padding: '9px 12px', outline: 'none', resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)', color: 'var(--text-muted)' }}>
              <input
                type="checkbox"
                checked={form.pinned}
                onChange={e => setForm(p => ({ ...p, pinned: e.target.checked }))}
                style={{ accentColor: 'var(--yellow)', width: '15px', height: '15px', cursor: 'pointer' }}
              />
              {t('announce.pin_it')}
            </label>
            <button
              onClick={handlePost}
              disabled={post.isPending}
              style={{
                padding: '9px 20px',
                background: 'rgba(52,211,153,.1)', border: '1px solid var(--green)',
                color: 'var(--green)', fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)',
                cursor: 'pointer', letterSpacing: '.5px',
              }}
            >
              {post.isPending ? t('announce.posting') : `▸ ${t('announce.post')}`}
            </button>
          </div>
        </div>
      )}

      {/* Pinned */}
      {pinned.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', color: 'var(--text-muted)', letterSpacing: '1px', padding: '0 4px' }}>
            {t('announce.pinned')}
          </div>
          {pinned.map(a => <AnnCard key={a.id} ann={a} isAdmin={isAdmin} onDelete={setDeleteId} onPin={(id, p) => pin.mutate({ id, pinned: p })} />)}
        </div>
      )}

      {/* Regular */}
      {regular.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {pinned.length > 0 && (
            <div style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', color: 'var(--text-muted)', letterSpacing: '1px', padding: '0 4px' }}>
              {t('announce.recent')}
            </div>
          )}
          {regular.map(a => <AnnCard key={a.id} ann={a} isAdmin={isAdmin} onDelete={setDeleteId} onPin={(id, p) => pin.mutate({ id, pinned: p })} />)}
        </div>
      )}

      {announcements.length === 0 && !isLoading && (
        <div style={{
          textAlign: 'center', padding: '60px 20px',
          fontFamily: 'var(--ff-input)', fontSize: 'var(--fs-input)', color: 'var(--text-muted)',
        }}>
          {t('announce.empty')}
        </div>
      )}

      {/* Delete confirm */}
      {deleteId && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 800,
        }}>
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--red)',
            padding: '24px 28px', minWidth: '320px',
          }}>
            <div style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', color: 'var(--red)', marginBottom: '12px' }}>
              {t('announce.del_title')}
            </div>
            <div style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)', color: 'var(--text-muted)', marginBottom: '20px' }}>
              {t('announce.del_warn')}
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setDeleteId(null)} style={{
                padding: '8px 16px', background: 'none', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)',
                color: 'var(--text-muted)', fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', cursor: 'pointer',
              }}>{t('announce.cancel')}</button>
              <button onClick={() => handleDelete(deleteId)} style={{
                padding: '8px 16px', background: 'rgba(248,113,113,.1)', border: '1px solid var(--red)',
                color: 'var(--red)', fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', cursor: 'pointer',
              }}>{t('announce.delete')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const AnnCard = ({ ann, isAdmin, onDelete, onPin }: {
  ann: Announcement;
  isAdmin: boolean;
  onDelete: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
}) => {
  const cfg = TYPE_CFG[ann.type];
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)',
      borderLeft: `3px solid ${cfg.color}`,
      padding: '14px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
        <span style={{ fontSize: '16px', color: cfg.color, flexShrink: 0, marginTop: '2px' }}>{cfg.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' }}>
            <span style={{ fontFamily: 'var(--ff-input)', fontSize: 'var(--fs-input)', color: 'var(--text)', fontWeight: 600 }}>
              {ann.title}
            </span>
            {ann.pinned && (
              <span style={{
                fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', padding: '2px 6px',
                border: '1px solid var(--yellow)', color: 'var(--yellow)', background: 'rgba(251,191,36,.06)',
              }}>PINNED</span>
            )}
            <span style={{
              fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', padding: '2px 6px',
              border: `1px solid ${cfg.color}`, color: cfg.color, background: cfg.bg,
            }}>{cfg.label}</span>
            <span style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-muted)', marginLeft: 'auto' }}>
              {asDay(ann.createdAt)}
            </span>
          </div>
          <div style={{ fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            {ann.body}
          </div>
        </div>
        {isAdmin && (
          <button
            onClick={() => onPin(ann.id, !ann.pinned)}
            title={ann.pinned ? 'Unpin' : 'Pin to the top'}
            style={{
              padding: '4px 8px', background: 'none', border: '1px solid transparent',
              color: ann.pinned ? 'var(--yellow)' : 'var(--text-muted)', fontSize: '12px',
              cursor: 'pointer', flexShrink: 0,
            }}
          >
            ★
          </button>
        )}
        {isAdmin && (
          <button
            onClick={() => onDelete(ann.id)}
            style={{
              padding: '4px 8px', background: 'none', border: '1px solid transparent',
              color: 'var(--text-muted)', fontSize: '12px', cursor: 'pointer', flexShrink: 0,
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--red)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(248,113,113,.3)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent';
            }}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
};
