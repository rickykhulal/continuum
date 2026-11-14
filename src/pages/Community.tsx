// Community Hub — crowdsourced posts, polls and verified anomaly alerts.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { nf } from '../lib/format';
import { playAlertChime } from '../lib/sound';

const API_BASE = import.meta.env.VITE_API_BASE || '/api/v1';

async function apiJson(path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `API ${res.status}`);
  }
  return res.json();
}

type Post = {
  id: string;
  author: string;
  type: 'text' | 'poll' | 'anomaly';
  content: string;
  imageUrl: string;
  isAnomaly: boolean;
  verified: boolean;
  createdAt: string;
  options?: string[];
  votes?: Record<string, number>;
};

type Announcement = {
  id: string;
  sourcePostId: string;
  author: string;
  content: string;
  imageUrl: string;
  createdAt: string;
};

export function Community() {
  const store = useStore();
  const t = (key: string) => store.t(key as never);
  const [posts, setPosts] = useState<Post[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ author: string; type: 'text' | 'poll' | 'anomaly'; content: string; imageUrl: string; isAnomaly: boolean }>({
    author: '',
    type: 'text',
    content: '',
    imageUrl: '',
    isAnomaly: false,
  });
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiJson('/community/feed');
      setPosts(data.posts || []);
      setAnnouncements(data.announcements || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the community feed.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      let type = draft.type;
      let options: string[] | undefined;
      if (type === 'poll') {
        options = pollOptions.filter((o) => o.trim()).slice(0, 6);
        if (options.length < 2) throw new Error('Polls need at least two options.');
      }
      await apiJson('/community/posts', {
        method: 'POST',
        body: JSON.stringify({
          author: draft.author.trim() || 'anonymous',
          type,
          content: draft.content.trim(),
          imageUrl: draft.imageUrl.trim(),
          isAnomaly: draft.isAnomaly,
          options,
        }),
      });
      playAlertChime();
      setDraft({ author: '', type: 'text', content: '', imageUrl: '', isAnomaly: false });
      setPollOptions(['', '']);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create post.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVote = async (postId: string, optionIndex: number) => {
    try {
      await apiJson('/community/vote', {
        method: 'POST',
        body: JSON.stringify({ postId, optionIndex }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not register vote.');
    }
  };

  const handleVerify = async (postId: string, verified: boolean) => {
    try {
      await apiJson('/community/verify', {
        method: 'POST',
        body: JSON.stringify({ postId, verified }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update verification.');
    }
  };

  const totalVotes = (post: Post) => {
    if (!post.votes) return 0;
    return Object.values(post.votes).reduce((s, n) => s + Number(n || 0), 0);
  };

  if (loading) {
    return (
      <section className="page community-page" aria-label="Community Hub">
        <PageHeader title={t('loading')} />
      </section>
    );
  }

  return (
    <section className="page community-page" aria-label="Community Hub">
      <PageHeader
        eyebrow="Community Hub"
        title="Crowdsourced fire-watch"
        intro={
          <div className="community-disclaimer">
            Community discussions are user-generated and do not represent official NASA data until verified.
            <a href="#" className="feed-link" onClick={(e) => { e.preventDefault(); }} target="_blank" rel="noreferrer">
              Read the method
            </a>
          </div>
        }
        actions={
          <>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => store.setView('watch')}>← Orbital Watch</button>
          </>
        }
      />
      {error && <div className="community-error">{error}</div>}
      <AnnouncementsBanner announcements={announcements} />
      <ComposeBox
        draft={draft}
        pollOptions={pollOptions}
        setDraft={setDraft}
        setPollOptions={setPollOptions}
        isAnomaly={draft.isAnomaly}
        setIsAnomaly={(v) => setDraft({ ...draft, isAnomaly: v })}
        setType={(v) => setDraft({ ...draft, type: v })}
        setContent={(v) => setDraft({ ...draft, content: v })}
        setAuthor={(v) => setDraft({ ...draft, author: v })}
        setImageUrl={(v) => setDraft({ ...draft, imageUrl: v })}
        onSubmit={handleCreate}
        submitting={submitting}
      />
      <div className="feed">
        <h2 className="feed-title">{posts.length === 0 ? 'No posts yet — start the conversation.' : 'Community feed'}</h2>
        {posts.map((post) => (
          <article key={post.id} className={`feed-card ${post.type} ${post.verified ? 'verified' : ''}`}>
            <div className="card-head">
              <span className="card-author">{post.author}</span>
              <span className="card-meta">{new Date(post.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              {post.isAnomaly && <span className="card-badge anomaly">⚠️ {t('anomaly')}</span>}
              {post.verified && <span className="card-badge verified-badge">Verified</span>}
            </div>
            <div className="card-body">
              <p className="card-content">{post.content}</p>
              {post.imageUrl && <img className="card-image" src={post.imageUrl} alt={post.content} loading="lazy" />}
              {post.type === 'poll' && post.options && (
                <div className="poll">
                  {post.options.map((opt, i) => (
                    <button
                      key={i}
                      type="button"
                      className={`poll-btn ${post.votes?.[String(i)] ? 'voted' : ''}`}
                      onClick={() => handleVote(post.id, i)}
                    >
                      {opt} <span className="poll-count">({(post.votes?.[String(i)] || 0)})</span>
                    </button>
                  ))}
                  <span className="poll-total">{totalVotes(post)} vote{totalVotes(post) === 1 ? '' : 's'}</span>
                </div>
              )}
            </div>
            <div className="card-foot">
              {post.type === 'anomaly' && !post.verified && (
                <button type="button" className="btn btn-small btn-ghost verify-btn" onClick={() => handleVerify(post.id, true)}>
                  Verify → Announce
                </button>
              )}
              {post.type === 'anomaly' && post.verified && (
                <span className="chip">Escalated to announcement</span>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function PageHeader({ eyebrow, title, intro, actions }: { eyebrow?: string; title: string; intro?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="page-head">
      {eyebrow && <span className="page-eyebrow">{eyebrow}</span>}
      <h1 className="page-title">{title}</h1>
      {intro && <p className="page-intro">{intro}</p>}
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

function AnnouncementsBanner({ announcements }: { announcements: Announcement[] }) {
  if (!announcements.length) return null;
  return (
    <section className="announcements-banner" aria-label="Verified announcements">
      <div className="banner-inner">
        <span className="banner-label">📢 Verified alerts</span>
        <ul className="banner-list">
          {announcements.map((a) => (
            <li key={a.id} className="banner-item">
              <strong>{a.author}</strong>: {a.content}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ComposeBox({
  draft,
  pollOptions,
  setDraft,
  setPollOptions,
  isAnomaly,
  setIsAnomaly,
  setType,
  setContent,
  setAuthor,
  setImageUrl,
  onSubmit,
  submitting,
}: {
  draft: { author: string; type: string; content: string; imageUrl: string; isAnomaly: boolean };
  pollOptions: string[];
  setDraft: (v: { author: string; type: 'text' | 'poll' | 'anomaly'; content: string; imageUrl: string; isAnomaly: boolean }) => void;
  setPollOptions: (v: string[]) => void;
  isAnomaly: boolean;
  setIsAnomaly: (v: boolean) => void;
  setType: (v: 'text' | 'poll' | 'anomaly') => void;
  setContent: (v: string) => void;
  setAuthor: (v: string) => void;
  setImageUrl: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  submitting: boolean;
}) {
  return (
    <form className="compose-box" onSubmit={onSubmit}>
      <div className="compose-inner">
        <textarea
          className="compose-text"
          value={draft.content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="What are you seeing? Describe a fire, smoke, or data oddity…"
          rows={3}
          maxLength={500}
        />
        <div className="compose-row">
          <input
            className="compose-input"
            value={draft.author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="Your name (optional)"
            maxLength={40}
          />
          <input
            className="compose-input"
            value={draft.imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="Image URL (optional)"
          />
        </div>
        <div className="compose-controls">
          <label className="compose-toggle">
            <input type="checkbox" checked={isAnomaly} onChange={(e) => setIsAnomaly(e.target.checked)} />
            ⚠️ Report data anomaly
          </label>
          {draft.type === 'poll' && (
            <div className="poll-options">
              {pollOptions.map((opt, i) => (
                <input
                  key={i}
                  className="compose-input"
                  value={opt}
                  onChange={(e) => {
                    const next = [...pollOptions];
                    next[i] = e.target.value;
                    setPollOptions(next);
                  }}
                  placeholder={`Option ${i + 1}`}
                />
              ))}
              <button type="button" className="btn btn-small btn-ghost" onClick={() => setPollOptions([...pollOptions, ''])}>
                + option
              </button>
            </div>
          )}
          <select className="compose-select" value={draft.type as string} onChange={(e) => setType((e.target.value as 'text' | 'poll' | 'anomaly'))}>
            <option value="text">Text post</option>
            <option value="poll">Poll</option>
            <option value="anomaly">Data anomaly</option>
          </select>
          <button type="submit" className="btn btn-primary" disabled={submitting || !draft.content.trim()}>
            {submitting ? 'Posting…' : 'Post'}
          </button>
        </div>
      </div>
    </form>
  );
}
