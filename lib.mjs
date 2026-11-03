export const STATE_VERSION = 1;
const ID = /^[a-zA-Z0-9_-]{11}$/;
export function readState(raw) {
  const blank = {version: STATE_VERSION, saved: [], liked: [], disliked: [], history: []};
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!value || typeof value !== 'object' || Array.isArray(value) || (value.version != null && value.version !== STATE_VERSION)) return blank;
    for (const key of ['saved', 'liked', 'disliked', 'history']) {
      if (Array.isArray(value[key])) blank[key] = [...new Set(value[key].filter(id => typeof id === 'string' && ID.test(id)))].slice(0, 20000);
    }
    blank.liked = blank.liked.filter(id => !blank.disliked.includes(id));
    return blank;
  } catch { return blank; }
}
export function formatDuration(seconds) {
  const n = Math.max(0, Math.floor(Number(seconds) || 0));
  if (!n) return '—';
  const h = Math.floor(n / 3600), m = Math.floor(n % 3600 / 60), s = n % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
const cats = v => (Array.isArray(v.categories) ? v.categories : []).map(c => typeof c === 'object' ? String(c.id) : String(c));
const base = v => Number.isFinite(Number(v.score)) ? Number(v.score) : 0;
const stamp = s => { const n = typeof s === 'number' ? s * (s < 1e12 ? 1000 : 1) : Date.parse(s); return Number.isFinite(n) ? n : 0; };
export function recommendVideos(videos, state = {}) {
  const liked = new Set(state.liked || []), disliked = new Set(state.disliked || []), seen = new Set(state.history || []), affinity = new Map();
  for (const video of videos) {
    const weight = liked.has(video.vid) ? 1 : disliked.has(video.vid) ? -1 : 0;
    if (weight) for (const c of cats(video)) affinity.set(c, (affinity.get(c) || 0) + weight);
  }
  const max = Math.max(1, ...videos.map(base));
  const rank = v => base(v) / max + cats(v).reduce((s, c) => s + (affinity.get(c) || 0) * .18, 0) - (seen.has(v.vid) ? 1.5 : 0);
  return videos.filter(v => !disliked.has(v.vid)).slice().sort((a, b) => rank(b) - rank(a) || base(b) - base(a) || String(a.vid).localeCompare(String(b.vid)));
}
export function filterVideos(videos, filters = {}, state = {}) {
  const view = filters.view || 'discover';
  const q = String(filters.q || filters.search || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  let result = videos.filter(v => {
    if (['saved', 'liked', 'history'].includes(view) && !(state[view] || []).includes(v.vid)) return false;
    if (!['saved', 'liked', 'history'].includes(view) && (state.disliked || []).includes(v.vid)) return false;
    if (filters.area && !(v.categories || []).some(c => String(c.area) === String(filters.area) || c.area_name === filters.area)) return false;
    if (filters.category && !cats(v).includes(String(filters.category))) return false;
    const duration = Number(v.duration_s) || 0;
    if ((filters.duration === 'short' && (!duration || duration >= 600)) || (filters.duration === 'medium' && (duration < 600 || duration >= 1800)) || (filters.duration === 'long' && duration < 1800)) return false;
    if ((view === 'longs' || filters.longs) && duration < 3600) return false;
    if ((view === 'gems' || filters.hiddenGems) && (v.views == null || !Number.isFinite(Number(v.views)) || Number(v.views) >= 100000)) return false;
    if ((filters.type || filters.content_type) && v.content_type !== (filters.type || filters.content_type)) return false;
    const text = [v.title, v.channel, v.summary, v.primary_topic, ...(v.tags || []), ...(v.categories || []).map(c => c.name)].join(' ').toLowerCase();
    return q.every(word => text.includes(word));
  });
  if (filters.sort === 'recent') return result.sort((a,b) => stamp(b.published) - stamp(a.published) || base(b) - base(a));
  if (view === 'history') return result.sort((a,b) => (state.history || []).indexOf(a.vid) - (state.history || []).indexOf(b.vid));
  // Calculate affinity against the whole library, not just the currently filtered subset.
  const order = new Map(recommendVideos(videos, state).map((v,i) => [v.vid,i]));
  return result.sort((a,b) => (order.get(a.vid) ?? Infinity) - (order.get(b.vid) ?? Infinity) || base(b) - base(a) || String(a.vid).localeCompare(String(b.vid)));
}
