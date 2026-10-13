// 데모 백엔드 — 브라우저 localStorage 에 데이터를 저장해요.
// 서버 없이 앱 전체를 체험하고 테스트할 수 있어요. 다른 탭과도 실시간으로 동기화돼요.
import { buildDemoDb } from './seed.js';
import { shapeEventSummary, shapeEventDetail, shapeSession, shapeSong, indexBy, groupSegments, canPremium } from './shape.js';
import { UserError, uid } from '../util.js';

const DB_KEY = 'setreview-demo-db-v1';
const SESSION_KEY = 'setreview-demo-session-v1';
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('setreview-demo') : null;

let db = null;
const listeners = new Set();
const authListeners = new Set();

function load() {
  try {
    const s = localStorage.getItem(DB_KEY);
    if (s) return JSON.parse(s);
  } catch { /* 저장소를 못 쓰면 새로 만들어요 */ }
  return null;
}
function save() {
  try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch { /* 사생활 보호 모드 등 */ }
  channel?.postMessage({ type: 'db' });
  emit();
}
function emit() { listeners.forEach((fn) => fn()); }

function sessionUserId() {
  try { return localStorage.getItem(SESSION_KEY); } catch { return memorySession; }
}
let memorySession = null;
function setSessionUserId(id) {
  memorySession = id;
  try { id ? localStorage.setItem(SESSION_KEY, id) : localStorage.removeItem(SESSION_KEY); } catch { /* 무시 */ }
  channel?.postMessage({ type: 'auth' });
  authListeners.forEach((fn) => fn());
}

function me() {
  const id = sessionUserId();
  return id ? db.profiles.find((p) => p.id === id) || null : null;
}
function requireUser() {
  const u = me();
  if (!u) throw new UserError('로그인이 필요해요.');
  return u;
}
function requireAdmin() {
  const u = requireUser();
  if (u.role !== 'admin') throw new UserError('운영자만 할 수 있어요.');
  return u;
}
const settings = () => ({ freeBeta: !!db.settings.free_beta });
const premium = () => canPremium(shapeSession(me()), settings());

// 지연을 살짝 줘서 실제 서버처럼 동작해요
const tick = (v) => new Promise((r) => setTimeout(() => r(v), 60));

export const demo = {
  mode: 'demo',

  async init() {
    db = load();
    if (!db) {
      db = buildDemoDb();
      try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch { /* 무시 */ }
    }
    window.addEventListener('storage', (e) => {
      if (e.key === DB_KEY) { db = load() || db; emit(); }
      if (e.key === SESSION_KEY) authListeners.forEach((fn) => fn());
    });
    channel?.addEventListener('message', (e) => {
      if (e.data?.type === 'db') { db = load() || db; emit(); }
      if (e.data?.type === 'auth') authListeners.forEach((fn) => fn());
    });
  },

  // ---------- 인증 ----------
  async getSession() { return shapeSession(me(), { provider: 'demo' }); },
  onAuth(fn) { authListeners.add(fn); return () => authListeners.delete(fn); },
  async signInDemo(kind) {
    setSessionUserId(kind === 'admin' ? 'u-admin' : 'u-demo');
    return tick();
  },
  async signIn() { throw new UserError('데모 모드에서는 데모 계정으로 로그인해요.'); },
  async signOut() { setSessionUserId(null); return tick(); },
  async updateNickname(nickname) {
    const u = requireUser();
    u.nickname = String(nickname).trim().slice(0, 20) || u.nickname;
    save();
    return tick();
  },

  // ---------- 설정 ----------
  async getSettings() { return settings(); },
  async setFreeBeta(on) { requireAdmin(); db.settings.free_beta = !!on; save(); return tick(); },
  async resetDemo() {
    db = buildDemoDb();
    save();
    return tick();
  },

  // ---------- 공연 ----------
  async listEvents({ includeUnpublished = false } = {}) {
    const artists = indexBy(db.artists);
    const isAdmin = me()?.role === 'admin';
    return tick(
      db.events
        .filter((e) => e.published || (includeUnpublished && isAdmin))
        .map((e) => shapeEventSummary(e, db.performances.filter((p) => p.event_id === e.id), artists))
    );
  },

  async getEventBySlug(slug) {
    const ev = db.events.find((e) => e.slug === slug);
    if (!ev || (!ev.published && me()?.role !== 'admin')) return tick(null);
    const perfs = db.performances.filter((p) => p.event_id === ev.id);
    const perfIds = new Set(perfs.map((p) => p.id));
    const items = db.setlist.filter((it) => perfIds.has(it.performance_id));
    const songIds = new Set(items.map((it) => it.song_id).filter(Boolean));
    const songs = indexBy(db.songs.filter((s) => songIds.has(s.id)));
    const segs = premium() ? groupSegments(db.segments.filter((g) => songIds.has(g.song_id))) : {};
    return tick(shapeEventDetail(ev, perfs, indexBy(db.artists), items, songs, segs));
  },

  subscribe(_eventId, fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  // ---------- 내 공연 · 예습 ----------
  async listFollows() {
    const u = me();
    return tick(u ? db.follows.filter((f) => f.user_id === u.id).map((f) => f.event_id) : []);
  },
  async follow(eventId) {
    const u = requireUser();
    if (db.follows.some((f) => f.user_id === u.id && f.event_id === eventId)) return;
    if (!premium() && db.follows.filter((f) => f.user_id === u.id).length >= 1) {
      throw new UserError('무료 이용자는 공연 1개까지 담을 수 있어요. 멤버십으로 무제한 담아 보세요.');
    }
    db.follows.push({ user_id: u.id, event_id: eventId, created_at: new Date().toISOString() });
    save();
    return tick();
  },
  async unfollow(eventId) {
    const u = requireUser();
    db.follows = db.follows.filter((f) => !(f.user_id === u.id && f.event_id === eventId));
    save();
    return tick();
  },
  async listProgress() {
    const u = me();
    return tick(u ? db.progress.filter((p) => p.user_id === u.id).map((p) => p.song_id) : []);
  },
  async setProgress(songId, done) {
    const u = requireUser();
    db.progress = db.progress.filter((p) => !(p.user_id === u.id && p.song_id === songId));
    if (done) db.progress.push({ user_id: u.id, song_id: songId, created_at: new Date().toISOString() });
    save();
    return tick();
  },

  // ---------- 제보 · 출시 알림 ----------
  async submitReport({ performanceId, kind, songId = null, title = '', atSec = null }) {
    const u = requireUser();
    if (!['now_playing', 'chant'].includes(kind)) throw new UserError('제보 종류가 올바르지 않아요.');
    if (!songId && !String(title).trim()) throw new UserError('곡을 고르거나 곡 이름을 적어 주세요.');
    db.reports.push({
      id: uid('rp'), user_id: u.id, performance_id: performanceId, kind, song_id: songId,
      title: String(title).trim().slice(0, 120), at_sec: atSec, status: 'pending', created_at: new Date().toISOString(),
    });
    save();
    return tick();
  },
  async joinWaitlist(email, consent = true) {
    const e = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new UserError('이메일 주소를 확인해 주세요.');
    if (!consent) throw new UserError('개인정보 수집·이용에 동의해 주세요.');
    if (!db.waitlist.some((w) => w.email === e)) {
      db.waitlist.push({ id: uid('wl'), email: e, consent: true, created_at: new Date().toISOString() });
      save();
    }
    return tick();
  },

  // ---------- 멤버십 (데모: 가상 결제) ----------
  async membershipStatus() {
    const u = me();
    if (!u) return null;
    const active = u.membership_until && new Date(u.membership_until) > new Date();
    return { status: active ? (u.demo_canceled ? 'canceled' : 'active') : 'none', currentPeriodEnd: u.membership_until };
  },
  async demoStartMembership() {
    const u = requireUser();
    const end = new Date();
    end.setMonth(end.getMonth() + 1);
    u.membership_until = end.toISOString();
    u.demo_canceled = false;
    save();
    return tick();
  },
  async cancelMembership() {
    const u = requireUser();
    u.demo_canceled = true;
    save();
    return tick();
  },

  // ---------- 운영자 ----------
  async adminListArtists() { requireAdmin(); return tick([...db.artists].sort((a, b) => a.name.localeCompare(b.name))); },
  async adminUpsertArtist({ id, name }) {
    requireAdmin();
    const n = String(name || '').trim();
    if (!n) throw new UserError('아티스트 이름을 적어 주세요.');
    if (id) { const a = db.artists.find((x) => x.id === id); if (a) a.name = n; }
    else {
      const slug = n.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-|-$/g, '') || uid('artist');
      if (db.artists.some((a) => a.slug === slug)) throw new UserError('같은 이름의 아티스트가 이미 있어요.');
      id = uid('a');
      db.artists.push({ id, name: n, slug });
    }
    save();
    return tick(id);
  },

  async adminListSongs(artistId) {
    requireAdmin();
    const songs = db.songs.filter((s) => !artistId || s.artist_id === artistId);
    const segs = groupSegments(db.segments);
    return tick(songs.map((s) => shapeSong(s, segs[s.id] || [])).sort((a, b) => a.title.localeCompare(b.title)));
  },
  async adminUpsertSong(song) {
    requireAdmin();
    const title = String(song.title || '').trim();
    if (!title || !song.artistId) throw new UserError('아티스트와 곡 제목을 적어 주세요.');
    let row = song.id && db.songs.find((s) => s.id === song.id);
    if (!row && db.songs.some((s) => s.artist_id === song.artistId && s.title.toLowerCase() === title.toLowerCase())) {
      throw new UserError('같은 제목의 곡이 이미 있어요.');
    }
    if (!row) { row = { id: uid('s') }; db.songs.push(row); }
    Object.assign(row, {
      artist_id: song.artistId, title, album: song.album || null, album_art_url: song.albumArtUrl || null,
      duration_sec: song.durationSec || null, spotify_id: song.spotifyId || null,
    });
    // 셋리스트에 적힌 제목도 같이 맞춰요
    db.setlist.forEach((it) => { if (it.song_id === row.id) it.title = title; });
    save();
    return tick(row.id);
  },
  async adminDeleteSong(id) {
    requireAdmin();
    db.songs = db.songs.filter((s) => s.id !== id);
    db.segments = db.segments.filter((g) => g.song_id !== id);
    db.setlist.forEach((it) => { if (it.song_id === id) it.song_id = null; });
    save();
    return tick();
  },
  async adminUpsertSegment(seg) {
    requireAdmin();
    if (!(seg.endSec > seg.startSec)) throw new UserError('끝 시간이 시작 시간보다 뒤여야 해요.');
    let row = seg.id && db.segments.find((g) => g.id === seg.id);
    if (!row) { row = { id: uid('seg') }; db.segments.push(row); }
    Object.assign(row, {
      song_id: seg.songId, kind: seg.kind, label: seg.label || null, start_sec: seg.startSec, end_sec: seg.endSec,
      score: seg.kind === 'chant' ? Math.max(0, Math.min(100, Number(seg.score) || 0)) : null,
    });
    save();
    return tick(row.id);
  },
  async adminDeleteSegment(id) {
    requireAdmin();
    db.segments = db.segments.filter((g) => g.id !== id);
    save();
    return tick();
  },

  async adminUpsertEvent(ev) {
    requireAdmin();
    if (!ev.title || !ev.slug || !ev.startsAt || !ev.endsAt) throw new UserError('제목, 주소, 시작·종료 시간을 모두 적어 주세요.');
    if (new Date(ev.endsAt) <= new Date(ev.startsAt)) throw new UserError('종료 시간이 시작 시간보다 뒤여야 해요.');
    if (db.events.some((e) => e.slug === ev.slug && e.id !== ev.id)) throw new UserError('이미 쓰는 주소예요. 다른 주소를 적어 주세요.');
    let row = ev.id && db.events.find((e) => e.id === ev.id);
    if (!row) { row = { id: uid('e') }; db.events.push(row); }
    Object.assign(row, {
      slug: ev.slug, title: ev.title, kind: ev.kind, venue: ev.venue || null, city: ev.city || null,
      starts_at: ev.startsAt, ends_at: ev.endsAt, cover_url: ev.coverUrl || null, description: ev.description || null,
      published: ev.published !== false,
    });
    save();
    return tick(row.id);
  },
  async adminDeleteEvent(id) {
    requireAdmin();
    const perfIds = new Set(db.performances.filter((p) => p.event_id === id).map((p) => p.id));
    db.events = db.events.filter((e) => e.id !== id);
    db.performances = db.performances.filter((p) => p.event_id !== id);
    db.setlist = db.setlist.filter((it) => !perfIds.has(it.performance_id));
    db.follows = db.follows.filter((f) => f.event_id !== id);
    db.reports = db.reports.filter((r) => !perfIds.has(r.performance_id));
    save();
    return tick();
  },
  async adminUpsertPerformance(p) {
    requireAdmin();
    if (!p.eventId || !p.artistId) throw new UserError('공연과 아티스트를 골라 주세요.');
    let row = p.id && db.performances.find((x) => x.id === p.id);
    if (!row) {
      row = { id: uid('p'), status: 'scheduled', sort: db.performances.filter((x) => x.event_id === p.eventId).length };
      db.performances.push(row);
    }
    Object.assign(row, { event_id: p.eventId, artist_id: p.artistId, stage: p.stage || null, starts_at: p.startsAt || null, ends_at: p.endsAt || null });
    save();
    return tick(row.id);
  },
  async adminDeletePerformance(id) {
    requireAdmin();
    db.performances = db.performances.filter((p) => p.id !== id);
    db.setlist = db.setlist.filter((it) => it.performance_id !== id);
    db.reports = db.reports.filter((r) => r.performance_id !== id);
    save();
    return tick();
  },
  async adminSetPerformanceStatus(id, status) {
    requireAdmin();
    const p = db.performances.find((x) => x.id === id);
    if (p) p.status = status;
    save();
    return tick();
  },
  // 예상 셋리스트 통째로 바꾸기: [{ songId, title, isEncore }]
  async adminSetPredicted(performanceId, list) {
    requireAdmin();
    db.setlist = db.setlist.filter((it) => !(it.performance_id === performanceId && it.kind === 'predicted'));
    list.forEach((x, i) => {
      db.setlist.push({
        id: uid('it'), performance_id: performanceId, kind: 'predicted', position: i + 1,
        song_id: x.songId || null, title: x.title, is_encore: !!x.isEncore, note: null, played_at: null,
      });
    });
    save();
    return tick();
  },
  async adminAddActual(performanceId, { songId = null, title, isEncore = false, playedAt = null }) {
    requireAdmin();
    const t = String(title || '').trim();
    if (!t) throw new UserError('곡 이름을 적어 주세요.');
    const pos = db.setlist.filter((it) => it.performance_id === performanceId && it.kind === 'actual').length + 1;
    db.setlist.push({
      id: uid('it'), performance_id: performanceId, kind: 'actual', position: pos, song_id: songId,
      title: t, is_encore: !!isEncore, note: null, played_at: playedAt || new Date().toISOString(),
    });
    save();
    return tick();
  },
  async adminDeleteSetlistItem(id) {
    requireAdmin();
    const it = db.setlist.find((x) => x.id === id);
    db.setlist = db.setlist.filter((x) => x.id !== id);
    if (it) {
      db.setlist
        .filter((x) => x.performance_id === it.performance_id && x.kind === it.kind)
        .sort((a, b) => a.position - b.position)
        .forEach((x, i) => { x.position = i + 1; });
    }
    save();
    return tick();
  },

  async adminListReports() {
    requireAdmin();
    const perfs = indexBy(db.performances);
    const events = indexBy(db.events);
    const artists = indexBy(db.artists);
    const songs = indexBy(db.songs);
    const profiles = indexBy(db.profiles);
    return tick(
      [...db.reports]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((r) => {
          const p = perfs[r.performance_id];
          return {
            id: r.id, kind: r.kind, status: r.status, createdAt: r.created_at, atSec: r.at_sec,
            songId: r.song_id, title: r.song_id ? songs[r.song_id]?.title || r.title : r.title,
            performanceId: r.performance_id,
            eventTitle: p ? events[p.event_id]?.title : '', artistName: p ? artists[p.artist_id]?.name : '',
            performanceStatus: p?.status || '', nickname: profiles[r.user_id]?.nickname || '',
          };
        })
    );
  },
  async adminResolveReport(id, status) {
    requireAdmin();
    const r = db.reports.find((x) => x.id === id);
    if (r) r.status = status;
    save();
    return tick();
  },
  async adminListWaitlist() {
    requireAdmin();
    return tick([...db.waitlist].sort((a, b) => b.created_at.localeCompare(a.created_at)));
  },
  async adminDeleteWaitlist(id) {
    requireAdmin();
    db.waitlist = db.waitlist.filter((w) => w.id !== id);
    save();
    return tick();
  },
};
