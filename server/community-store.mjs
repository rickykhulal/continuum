// Community Hub local JSON store (hackathon database substitute).
// Zero dependencies: node:fs only. Lives in data/community.json so it survives
// server restarts but stays out of the data pipeline bundle.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd(), '..');
const DATA_DIR = path.join(root, 'data');
const STORE_PATH = path.join(DATA_DIR, 'community.json');

const EMPTY = { posts: [], polls: [], announcements: [] };

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(EMPTY, null, 2) + '\n', 'utf8');
  }
  return read();
}

function read() {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...EMPTY };
    return {
      posts: Array.isArray(parsed.posts) ? parsed.posts : [],
      polls: Array.isArray(parsed.polls) ? parsed.polls : [],
      announcements: Array.isArray(parsed.announcements) ? parsed.announcements : [],
    };
  } catch {
    return { ...EMPTY };
  }
}

function write(data) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function nextId(data) {
  const max = Math.max(0, ...data.posts.map((p) => Number(p.id || 0)), ...data.announcements.map((a) => Number(a.id || 0)));
  return String(max + 1);
}

function nowIso() {
  return new Date().toISOString();
}

/** Public API ------------------------------------------------------------ */

ensureStore();

export function getPosts() {
  const data = read();
  return [...data.posts].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

export function createPost({ author, type, content, imageUrl, isAnomaly, options }) {
  const data = read();
  const id = nextId(data);
  const post = {
    id,
    author: String(author ?? 'anonymous'),
    type: type === 'poll' || type === 'anomaly' ? type : 'text',
    content: String(content ?? ''),
    imageUrl: imageUrl ? String(imageUrl) : '',
    isAnomaly: type === 'anomaly' ? true : Boolean(isAnomaly),
    verified: false,
    createdAt: nowIso(),
    votes: {},
  };
  if (post.type === 'poll' && Array.isArray(options)) {
    post.options = options.map((o) => String(o)).slice(0, 6);
    post.votes = Object.fromEntries(post.options.map((_, i) => [i, 0]));
    data.polls.push({ postId: id, options: post.options.map((_, i) => ({ text: post.options[i], votes: 0 })) });
  }
  data.posts.unshift(post);
  write(data);
  return post;
}

export function votePoll({ postId, optionIndex }) {
  const data = read();
  const post = data.posts.find((p) => p.id === String(postId));
  if (!post || post.type !== 'poll') return null;
  const idx = Number(optionIndex);
  if (!Number.isInteger(idx) || idx < 0 || !post.options || idx >= post.options.length) return null;
  post.votes[idx] = (post.votes[idx] || 0) + 1;
  const poll = data.polls.find((p) => p.postId === post.id);
  if (poll && poll.options[idx]) poll.options[idx].votes = (poll.options[idx].votes || 0) + 1;
  write(data);
  return post;
}

export function verifyAnomaly({ postId, verified }) {
  const data = read();
  const post = data.posts.find((p) => p.id === String(postId));
  if (!post || post.type !== 'anomaly') return null;
  post.verified = Boolean(verified);
  if (post.verified) {
    const exists = data.announcements.some((a) => a.sourcePostId === post.id);
    if (!exists) {
      const announcement = {
        id: nextId(data),
        sourcePostId: post.id,
        author: post.author,
        content: post.content,
        imageUrl: post.imageUrl,
        createdAt: nowIso(),
      };
      data.announcements.unshift(announcement);
    }
  } else {
    data.announcements = data.announcements.filter((a) => a.sourcePostId !== post.id);
  }
  write(data);
  return post;
}

export function getAnnouncements() {
  const data = read();
  return [...data.announcements].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}
