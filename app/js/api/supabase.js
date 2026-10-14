// 실제 서비스용 백엔드 — Supabase (Postgres · 로그인 · 실시간 · Edge Functions)
// 권한은 데이터베이스의 RLS 정책(supabase/schema.sql)이 최종적으로 지켜요.
import { config } from '../config.js';
import { shapeEventSummary, shapeEventDetail, shapeSession, shapeSong, indexBy, groupSegments, shapeAttendance, attendanceRow, shapeArtist, shapeNotification } from './shape.js';
import { UserError } from '../util.js';

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

let sb = null;
let authSession = null;
let profile = null;
const authListeners = new Set();

function toUserError(error) {
  const code = error?.code || '';
  if (code === '42501' || /row-level security|permission denied/i.test(error?.message || '')) {
    return new UserError('권한이 없어요. 로그인 상태나 멤버십을 확인해 주세요.');
  }
  if (code === '23505') return new UserError('이미 등록돼 있어요.');
  if (code === '23514') return new UserError('입력값을 확인해 주세요.');
  const e = new UserError(error?.message || '서버 요청에 실패했어요. 잠시 후 다시 시도해 주세요.');
  e.cause = error;
  return e;
}
function emailAuthError(error) {
  const msg = `${error?.code || ''} ${error?.message || ''}`;
  if (error?.status === 429 || /rate limit|over_email_send_rate|security purposes/i.test(msg)) {
    return new UserError('메일을 너무 자주 보냈어요. 잠시 후 다시 시도해 주세요.');
  }
  if (/otp_expired|expired|invalid/i.test(msg)) return new UserError('코드가 맞지 않거나 만료됐어요. 메일을 다시 받아 주세요.');
  if (/email_address_invalid|invalid.*email/i.test(msg)) return new UserError('이메일 주소를 확인해 주세요.');
  if (/not authorized|email_address_not_authorized/i.test(msg)) {
    return new UserError('아직 이 주소로는 메일을 보낼 수 없어요. 운영자에게 문의해 주세요.');
  }
  return toUserError(error);
}
function check({ data, error }) {
  if (error) throw toUserError(error);
  return data;
}
function requireUser() {
  if (!authSession?.user) throw new UserError('로그인이 필요해요.');
  return authSession.user;
}

async function loadProfile() {
  const user = authSession?.user;
  if (!user) { profile = null; return; }
  const { data } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  profile = data || {
    id: user.id,
    nickname: user.user_metadata?.name || user.user_metadata?.nickname || (user.email || '덕후').split('@')[0],
    role: 'user',
    membership_until: null,
  };
}

const uniq = (arr) => [...new Set(arr.filter(Boolean))];
async function inQuery(table, column, values, select = '*') {
  if (!values.length) return [];
  return check(await sb.from(table).select(select).in(column, values));
}

export const supabaseBackend = {
  mode: 'supabase',

  async init() {
    const { createClient } = await import(/* @vite-ignore */ SUPABASE_JS);
    sb = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    const { data } = await sb.auth.getSession();
    authSession = data.session;
    await loadProfile();
    sb.auth.onAuthStateChange((_event, s) => {
      // 콜백 안에서 바로 Supabase 를 다시 부르면 멈출 수 있어서 다음 틱으로 넘겨요
      setTimeout(async () => {
        authSession = s;
        await loadProfile();
        authListeners.forEach((fn) => fn());
      }, 0);
    });
  },

  // ---------- 인증 ----------
  async getSession() {
    const u = authSession?.user;
    return u ? shapeSession(profile, { email: u.email, provider: u.app_metadata?.provider }) : null;
  },
  onAuth(fn) { authListeners.add(fn); return () => authListeners.delete(fn); },
  async signIn(provider) {
    const { error } = await sb.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${location.origin}/app/` },
    });
    if (error) throw toUserError(error);
  },
  // 이메일 로그인: 로그인 링크(+ 6자리 코드)를 메일로 보내요. 처음이면 자동으로 가입돼요.
  async sendEmailLogin(email) {
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/app/`, shouldCreateUser: true },
    });
    if (error) throw emailAuthError(error);
  },
  async verifyEmailCode(email, token) {
    const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
    if (error) throw emailAuthError(error);
  },
  async signInDemo() { throw new UserError('데모 계정은 데모 모드에서만 쓸 수 있어요.'); },
  async signOut() { await sb.auth.signOut(); },
  async updateNickname(nickname) {
    const user = requireUser();
    check(await sb.from('profiles').update({ nickname: String(nickname).trim().slice(0, 20) }).eq('id', user.id));
    await loadProfile();
    authListeners.forEach((fn) => fn());
  },
  async refreshProfile() {
    await loadProfile();
    authListeners.forEach((fn) => fn());
  },

  // ---------- 설정 ----------
  async getSettings() {
    const rows = check(await sb.from('app_settings').select('key, value'));
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return { freeBeta: map.free_beta === true };
  },
  async setFreeBeta(on) {
    check(await sb.from('app_settings').upsert({ key: 'free_beta', value: !!on }));
  },

  // ---------- 공연 ----------
  async listEvents() {
    const events = check(await sb.from('events').select('*').order('starts_at'));
    const perfs = await inQuery('performances', 'event_id', events.map((e) => e.id), 'id, event_id, artist_id, status, sort');
    const artists = await inQuery('artists', 'id', uniq(perfs.map((p) => p.artist_id)), 'id, name');
    const byArtist = indexBy(artists);
    return events.map((e) => shapeEventSummary(e, perfs.filter((p) => p.event_id === e.id), byArtist));
  },

  async getEventBySlug(slug) {
    const ev = check(await sb.from('events').select('*').eq('slug', slug).maybeSingle());
    if (!ev) return null;
    const perfs = check(await sb.from('performances').select('*').eq('event_id', ev.id));
    const items = await inQuery('setlist_items', 'performance_id', perfs.map((p) => p.id));
    const songIds = uniq(items.map((it) => it.song_id));
    const [songs, segs, artists] = await Promise.all([
      inQuery('songs', 'id', songIds),
      inQuery('song_segments', 'song_id', songIds), // 멤버십이 아니면 RLS 가 빈 목록을 돌려줘요
      inQuery('artists', 'id', uniq(perfs.map((p) => p.artist_id)), 'id, name'),
    ]);
    return shapeEventDetail(ev, perfs, indexBy(artists), items, indexBy(songs), groupSegments(segs));
  },

  subscribe(eventId, fn) {
    const ch = sb
      .channel(`event-${eventId}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'setlist_items' }, () => fn())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'performances', filter: `event_id=eq.${eventId}` }, () => fn())
      .subscribe();
    return () => sb.removeChannel(ch);
  },

  // ---------- 내 공연 · 예습 ----------
  async listFollows() {
    if (!authSession?.user) return [];
    return check(await sb.from('follows').select('event_id').eq('user_id', authSession.user.id)).map((r) => r.event_id);
  },
  async follow(eventId) {
    const user = requireUser();
    const { error } = await sb.from('follows').insert({ user_id: user.id, event_id: eventId });
    if (error && error.code !== '23505') {
      if (error.code === '42501') throw new UserError('무료 이용자는 공연 1개까지 담을 수 있어요. 멤버십으로 무제한 담아 보세요.');
      throw toUserError(error);
    }
  },
  async unfollow(eventId) {
    const user = requireUser();
    check(await sb.from('follows').delete().eq('user_id', user.id).eq('event_id', eventId));
  },
  async listProgress() {
    if (!authSession?.user) return [];
    return check(await sb.from('progress').select('song_id').eq('user_id', authSession.user.id)).map((r) => r.song_id);
  },
  async setProgress(songId, done) {
    const user = requireUser();
    if (done) {
      const { error } = await sb.from('progress').insert({ user_id: user.id, song_id: songId });
      if (error && error.code !== '23505') throw toUserError(error);
    } else {
      check(await sb.from('progress').delete().eq('user_id', user.id).eq('song_id', songId));
    }
  },

  // ---------- 내 공연 기록 ----------
  async listAttendances() {
    if (!authSession?.user) return [];
    const rows = check(await sb.from('attendances').select('*').eq('user_id', authSession.user.id).order('attended_on', { ascending: false }));
    const evs = await inQuery('events', 'id', uniq(rows.map((r) => r.event_id)), 'id, slug, cover_url');
    return rows.map((r) => shapeAttendance(r, indexBy(evs)));
  },
  async saveAttendance(input) {
    const user = requireUser();
    const row = attendanceRow(input);
    if (!row.title) throw new UserError('공연 이름을 적어 주세요.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.attended_on)) throw new UserError('날짜를 골라 주세요.');
    const { error } = input.id
      ? await sb.from('attendances').update(row).eq('id', input.id).eq('user_id', user.id)
      : await sb.from('attendances').insert({ ...row, user_id: user.id });
    if (error?.code === '23505') throw new UserError('이미 기록한 공연이에요.');
    if (error) throw toUserError(error);
  },
  async deleteAttendance(id) {
    const user = requireUser();
    check(await sb.from('attendances').delete().eq('id', id).eq('user_id', user.id));
  },

  // ---------- 취향 · 추천 · 알림 ----------
  async listArtists() {
    return check(await sb.from('artists').select('id, name, name_ko, aliases, genres').order('name')).map(shapeArtist);
  },
  async listArtistPairs() {
    return check(await sb.from('artist_pairs').select('a, b, users').order('users', { ascending: false }).limit(2000));
  },
  async getTaste() {
    if (!authSession?.user) return { favorites: [], genres: [], emailAlerts: false, weeklyDigest: false };
    const uid = authSession.user.id;
    const [fav, gen] = await Promise.all([
      sb.from('favorite_artists').select('name, created_at').eq('user_id', uid).order('created_at'),
      sb.from('user_genres').select('genre').eq('user_id', uid),
    ]);
    return {
      favorites: check(fav).map((r) => r.name),
      genres: check(gen).map((r) => r.genre),
      emailAlerts: profile?.email_alerts !== false,
      weeklyDigest: profile?.weekly_digest !== false,
    };
  },
  async addFavorite(name) {
    const user = requireUser();
    const n = String(name || '').trim().slice(0, 80);
    if (!n) throw new UserError('아티스트 이름을 적어 주세요.');
    const { error } = await sb.from('favorite_artists').insert({ user_id: user.id, name: n });
    if (error?.code === '23505') throw new UserError('이미 좋아하는 아티스트예요.');
    if (error) throw toUserError(error);
  },
  async removeFavorite(name) {
    const user = requireUser();
    const rows = check(await sb.from('favorite_artists').select('norm, name').eq('user_id', user.id));
    const hit = rows.find((r) => r.name === name);
    if (hit) check(await sb.from('favorite_artists').delete().eq('user_id', user.id).eq('norm', hit.norm));
  },
  async setGenres(list) {
    const user = requireUser();
    check(await sb.from('user_genres').delete().eq('user_id', user.id));
    if (list.length) check(await sb.from('user_genres').insert(list.map((genre) => ({ user_id: user.id, genre }))));
  },
  async setAlertPrefs({ emailAlerts, weeklyDigest }) {
    const user = requireUser();
    check(await sb.from('profiles').update({ email_alerts: !!emailAlerts, weekly_digest: !!weeklyDigest }).eq('id', user.id));
    await loadProfile();
  },
  async refreshMyNotifications() {
    if (!authSession?.user) return 0;
    const { data, error } = await sb.rpc('refresh_my_notifications');
    if (error) throw toUserError(error);
    return data || 0;
  },
  async listNotifications() {
    if (!authSession?.user) return [];
    const rows = check(await sb.from('notifications').select('id, kind, event_id, reason, created_at, read_at')
      .eq('user_id', authSession.user.id).order('created_at', { ascending: false }).limit(100));
    const evs = await inQuery('events', 'id', uniq(rows.map((r) => r.event_id)), 'id, slug, title, starts_at, venue, city, cover_url, is_visit, kind');
    return rows.map((r) => shapeNotification(r, indexBy(evs))).filter((n) => n.event);
  },
  async countUnread() {
    if (!authSession?.user) return 0;
    const { count } = await sb.from('notifications').select('id', { count: 'exact', head: true })
      .eq('user_id', authSession.user.id).is('read_at', null);
    return count || 0;
  },
  async markNotificationsRead() {
    const user = requireUser();
    check(await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', user.id).is('read_at', null));
  },
  async adminUpsertArtistInfo({ id, name, nameKo, aliases, genres }) {
    const n = String(name || '').trim();
    if (!n) throw new UserError('아티스트 이름을 적어 주세요.');
    check(await sb.from('artists').update({ name: n, name_ko: String(nameKo || '').trim() || null, aliases, genres }).eq('id', id));
  },

  // ---------- 자동 수집 (KOPIS) ----------
  async getSyncStatus() {
    const r = check(await sb.from('app_settings').select('value').eq('key', 'kopis_last_sync').maybeSingle());
    return r?.value || null;
  },
  async runKopisSync() {
    const { data, error } = await sb.functions.invoke('kopis-sync', { body: {} });
    if (error) {
      let msg = error.message;
      try { msg = (await error.context.json()).error || msg; } catch { /* 무시 */ }
      throw new UserError(msg);
    }
    return data;
  },

  // ---------- 제보 · 출시 알림 ----------
  async submitReport({ performanceId, kind, songId = null, title = '', atSec = null }) {
    const user = requireUser();
    if (!songId && !String(title).trim()) throw new UserError('곡을 고르거나 곡 이름을 적어 주세요.');
    check(await sb.from('reports').insert({
      user_id: user.id, performance_id: performanceId, kind, song_id: songId,
      title: String(title).trim().slice(0, 120) || null, at_sec: atSec,
    }));
  },
  async joinWaitlist(email, consent = true) {
    const e = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new UserError('이메일 주소를 확인해 주세요.');
    if (!consent) throw new UserError('개인정보 수집·이용에 동의해 주세요.');
    const { error } = await sb.from('waitlist').insert({ email: e, consent: true });
    if (error && error.code !== '23505') throw toUserError(error);
  },

  // ---------- 멤버십 ----------
  async membershipStatus() {
    if (!authSession?.user) return null;
    const sub = check(await sb.from('subscriptions').select('status, current_period_end').eq('user_id', authSession.user.id).maybeSingle());
    const until = profile?.membership_until || sub?.current_period_end || null;
    const active = until && new Date(until) > new Date();
    return { status: active ? (sub?.status === 'canceled' ? 'canceled' : 'active') : (sub?.status === 'past_due' ? 'past_due' : 'none'), currentPeriodEnd: until };
  },
  async invoke(name, body) {
    requireUser();
    const { data, error } = await sb.functions.invoke(name, { body });
    if (error) {
      let msg = '결제 서버 요청에 실패했어요.';
      try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch { /* 무시 */ }
      throw new UserError(msg);
    }
    if (data?.error) throw new UserError(data.error);
    return data;
  },
  async cancelMembership() {
    await this.invoke('toss-billing', { action: 'cancel' });
    await this.refreshProfile();
  },

  // ---------- 운영자 ----------
  async adminListArtists() { return check(await sb.from('artists').select('*').order('name')); },
  async adminUpsertArtist({ id, name }) {
    const n = String(name || '').trim();
    if (!n) throw new UserError('아티스트 이름을 적어 주세요.');
    if (id) { check(await sb.from('artists').update({ name: n }).eq('id', id)); return id; }
    const slug = n.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-|-$/g, '') || `artist-${Date.now()}`;
    return check(await sb.from('artists').insert({ name: n, slug }).select('id').single()).id;
  },

  async adminListSongs(artistId) {
    let q = sb.from('songs').select('*').order('title');
    if (artistId) q = q.eq('artist_id', artistId);
    const songs = check(await q);
    const segs = groupSegments(await inQuery('song_segments', 'song_id', songs.map((s) => s.id)));
    return songs.map((s) => shapeSong(s, segs[s.id] || []));
  },
  async adminUpsertSong(song) {
    const title = String(song.title || '').trim();
    if (!title || !song.artistId) throw new UserError('아티스트와 곡 제목을 적어 주세요.');
    const row = {
      artist_id: song.artistId, title, album: song.album || null, album_art_url: song.albumArtUrl || null,
      duration_sec: song.durationSec || null, spotify_id: song.spotifyId || null,
    };
    if (song.id) {
      check(await sb.from('songs').update(row).eq('id', song.id));
      check(await sb.from('setlist_items').update({ title }).eq('song_id', song.id));
      return song.id;
    }
    return check(await sb.from('songs').insert(row).select('id').single()).id;
  },
  async adminDeleteSong(id) { check(await sb.from('songs').delete().eq('id', id)); },
  async adminUpsertSegment(seg) {
    if (!(seg.endSec > seg.startSec)) throw new UserError('끝 시간이 시작 시간보다 뒤여야 해요.');
    const row = {
      song_id: seg.songId, kind: seg.kind, label: seg.label || null, start_sec: seg.startSec, end_sec: seg.endSec,
      score: seg.kind === 'chant' ? Math.max(0, Math.min(100, Number(seg.score) || 0)) : null,
    };
    if (seg.id) { check(await sb.from('song_segments').update(row).eq('id', seg.id)); return seg.id; }
    return check(await sb.from('song_segments').insert(row).select('id').single()).id;
  },
  async adminDeleteSegment(id) { check(await sb.from('song_segments').delete().eq('id', id)); },

  async adminUpsertEvent(ev) {
    if (!ev.title || !ev.slug || !ev.startsAt || !ev.endsAt) throw new UserError('제목, 주소, 시작·종료 시간을 모두 적어 주세요.');
    if (new Date(ev.endsAt) <= new Date(ev.startsAt)) throw new UserError('종료 시간이 시작 시간보다 뒤여야 해요.');
    const row = {
      slug: ev.slug, title: ev.title, kind: ev.kind, venue: ev.venue || null, city: ev.city || null,
      starts_at: ev.startsAt, ends_at: ev.endsAt, cover_url: ev.coverUrl || null, description: ev.description || null,
      published: ev.published !== false,
      is_visit: !!ev.isVisit, ticket_url: /^https?:\/\//i.test(ev.ticketUrl || '') ? ev.ticketUrl : null,
      genres: ev.genres || [], lineup: ev.lineup || null,
    };
    if (ev.id) { check(await sb.from('events').update(row).eq('id', ev.id)); return ev.id; }
    return check(await sb.from('events').insert(row).select('id').single()).id;
  },
  async adminDeleteEvent(id) { check(await sb.from('events').delete().eq('id', id)); },
  async adminUpsertPerformance(p) {
    if (!p.eventId || !p.artistId) throw new UserError('공연과 아티스트를 골라 주세요.');
    const row = { event_id: p.eventId, artist_id: p.artistId, stage: p.stage || null, starts_at: p.startsAt || null, ends_at: p.endsAt || null };
    if (p.id) { check(await sb.from('performances').update(row).eq('id', p.id)); return p.id; }
    const { count } = await sb.from('performances').select('id', { count: 'exact', head: true }).eq('event_id', p.eventId);
    return check(await sb.from('performances').insert({ ...row, sort: count || 0 }).select('id').single()).id;
  },
  async adminDeletePerformance(id) { check(await sb.from('performances').delete().eq('id', id)); },
  async adminSetPerformanceStatus(id, status) { check(await sb.from('performances').update({ status }).eq('id', id)); },
  async adminSetPredicted(performanceId, list) {
    check(await sb.from('setlist_items').delete().eq('performance_id', performanceId).eq('kind', 'predicted'));
    if (!list.length) return;
    check(await sb.from('setlist_items').insert(list.map((x, i) => ({
      performance_id: performanceId, kind: 'predicted', position: i + 1, song_id: x.songId || null, title: x.title, is_encore: !!x.isEncore,
    }))));
  },
  async adminAddActual(performanceId, { songId = null, title, isEncore = false, playedAt = null }) {
    const t = String(title || '').trim();
    if (!t) throw new UserError('곡 이름을 적어 주세요.');
    const last = check(await sb.from('setlist_items').select('position').eq('performance_id', performanceId).eq('kind', 'actual').order('position', { ascending: false }).limit(1));
    check(await sb.from('setlist_items').insert({
      performance_id: performanceId, kind: 'actual', position: (last[0]?.position || 0) + 1, song_id: songId,
      title: t, is_encore: !!isEncore, played_at: playedAt || new Date().toISOString(),
    }));
  },
  async adminDeleteSetlistItem(id) {
    const it = check(await sb.from('setlist_items').select('performance_id, kind').eq('id', id).maybeSingle());
    check(await sb.from('setlist_items').delete().eq('id', id));
    if (!it) return;
    const rest = check(await sb.from('setlist_items').select('id, position').eq('performance_id', it.performance_id).eq('kind', it.kind).order('position'));
    await Promise.all(rest.map((r, i) => (r.position === i + 1 ? null : sb.from('setlist_items').update({ position: i + 1 }).eq('id', r.id))));
  },

  async adminListReports() {
    const reports = check(await sb.from('reports').select('*').order('created_at', { ascending: false }).limit(300));
    const perfs = await inQuery('performances', 'id', uniq(reports.map((r) => r.performance_id)), 'id, event_id, artist_id, status');
    const [events, artists, songs, profiles] = await Promise.all([
      inQuery('events', 'id', uniq(perfs.map((p) => p.event_id)), 'id, title'),
      inQuery('artists', 'id', uniq(perfs.map((p) => p.artist_id)), 'id, name'),
      inQuery('songs', 'id', uniq(reports.map((r) => r.song_id)), 'id, title'),
      inQuery('profiles', 'id', uniq(reports.map((r) => r.user_id)), 'id, nickname'),
    ]);
    const P = indexBy(perfs), E = indexBy(events), A = indexBy(artists), S = indexBy(songs), U = indexBy(profiles);
    return reports.map((r) => {
      const p = P[r.performance_id];
      return {
        id: r.id, kind: r.kind, status: r.status, createdAt: r.created_at, atSec: r.at_sec,
        songId: r.song_id, title: r.song_id ? S[r.song_id]?.title || r.title : r.title,
        performanceId: r.performance_id,
        eventTitle: p ? E[p.event_id]?.title : '', artistName: p ? A[p.artist_id]?.name : '',
        performanceStatus: p?.status || '', nickname: U[r.user_id]?.nickname || '',
      };
    });
  },
  async adminResolveReport(id, status) { check(await sb.from('reports').update({ status }).eq('id', id)); },
  async adminListWaitlist() { return check(await sb.from('waitlist').select('*').order('created_at', { ascending: false })); },
  async adminDeleteWaitlist(id) { check(await sb.from('waitlist').delete().eq('id', id)); },
};
