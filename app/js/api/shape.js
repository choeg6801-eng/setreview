// 데이터베이스 행(row)을 화면에서 쓰기 좋은 모양으로 바꿔요.
// 데모 모드와 Supabase 모드가 모두 이 함수들을 써서, 화면 코드는 백엔드를 신경 쓰지 않아요.

export function shapeSong(s, segs = []) {
  if (!s) return null;
  return {
    id: s.id,
    artistId: s.artist_id,
    title: s.title,
    album: s.album || '',
    albumArtUrl: s.album_art_url || '',
    durationSec: s.duration_sec || null,
    spotifyId: s.spotify_id || null,
    segments: segs
      .map((g) => ({ id: g.id, kind: g.kind, label: g.label || '', startSec: g.start_sec, endSec: g.end_sec, score: g.score }))
      .sort((a, b) => a.startSec - b.startSec),
  };
}

// 가장 높은 떼창 지수
export function chantScore(song) {
  if (!song) return null;
  const scores = song.segments.filter((g) => g.kind === 'chant' && g.score != null).map((g) => g.score);
  return scores.length ? Math.max(...scores) : null;
}

export function eventStatus(ev, perfs, now = Date.now()) {
  if (perfs.some((p) => p.status === 'live')) return 'live';
  const start = new Date(ev.starts_at).getTime();
  const end = new Date(ev.ends_at).getTime();
  if (now > end || (perfs.length && perfs.every((p) => p.status === 'ended'))) return 'ended';
  if (now >= start) return 'live';
  return 'upcoming';
}

export function shapeEventSummary(ev, perfs, artistsById, now = Date.now()) {
  const sorted = [...perfs].sort((a, b) => a.sort - b.sort);
  return {
    id: ev.id,
    slug: ev.slug,
    title: ev.title,
    kind: ev.kind,
    venue: ev.venue || '',
    city: ev.city || '',
    startsAt: ev.starts_at,
    endsAt: ev.ends_at,
    coverUrl: ev.cover_url || '',
    description: ev.description || '',
    published: ev.published !== false,
    isVisit: !!ev.is_visit,
    lineup: ev.lineup || '',
    ticketOpenAt: ev.ticket_open_at || null,
    sourceUrl: /^https?:\/\//i.test(ev.source_url || '') ? ev.source_url : '',
    reviewNote: ev.review_note || '',
    genres: ev.genres || [],
    source: ev.source || 'manual',
    ticketUrl: /^https?:\/\//i.test(ev.ticket_url || '') ? ev.ticket_url : '',
    status: eventStatus(ev, perfs, now),
    artists: sorted.map((p) => artistsById[p.artist_id]?.name).filter(Boolean),
  };
}

function shapeItem(it, songsById, segsBySong) {
  const song = it.song_id && songsById[it.song_id] ? shapeSong(songsById[it.song_id], segsBySong[it.song_id] || []) : null;
  return {
    id: it.id,
    position: it.position,
    title: it.title || song?.title || '',
    isEncore: !!it.is_encore,
    note: it.note || '',
    playedAt: it.played_at || null,
    song,
  };
}

export function shapeEventDetail(ev, perfs, artistsById, items, songsById, segsBySong, now = Date.now()) {
  const summary = shapeEventSummary(ev, perfs, artistsById, now);
  const performances = [...perfs]
    .sort((a, b) => a.sort - b.sort)
    .map((p) => {
      const mine = items.filter((it) => it.performance_id === p.id);
      const byPos = (a, b) => a.position - b.position || String(a.played_at || '').localeCompare(String(b.played_at || ''));
      return {
        id: p.id,
        stage: p.stage || '',
        startsAt: p.starts_at,
        endsAt: p.ends_at,
        status: p.status,
        sort: p.sort,
        artist: { id: p.artist_id, name: artistsById[p.artist_id]?.name || '' },
        predicted: mine.filter((it) => it.kind === 'predicted').sort(byPos).map((it) => shapeItem(it, songsById, segsBySong)),
        actual: mine.filter((it) => it.kind === 'actual').sort(byPos).map((it) => shapeItem(it, songsById, segsBySong)),
      };
    });
  return { ...summary, performances };
}

export function shapeSession(profile, extra = {}) {
  if (!profile) return null;
  return {
    id: profile.id,
    nickname: profile.nickname || '덕후',
    role: profile.role || 'user',
    isAdmin: profile.role === 'admin',
    membershipUntil: profile.membership_until || null,
    email: extra.email || '',
    provider: extra.provider || '',
  };
}

export function isMemberActive(session, now = Date.now()) {
  return !!(session && session.membershipUntil && new Date(session.membershipUntil).getTime() > now);
}

export function canPremium(session, settings) {
  return !!(settings?.freeBeta || session?.isAdmin || isMemberActive(session));
}

export const indexBy = (arr, key = 'id') => Object.fromEntries(arr.map((x) => [x[key], x]));
export function groupSegments(segs) {
  const out = {};
  for (const g of segs) (out[g.song_id] ||= []).push(g);
  return out;
}

// 내 공연 기록 한 줄
export function shapeAttendance(a, eventsById = {}) {
  const ev = a.event_id ? eventsById[a.event_id] : null;
  return {
    id: a.id,
    eventId: a.event_id || null,
    eventSlug: ev?.slug || null,
    coverUrl: ev?.cover_url || '',
    title: a.title,
    artist: a.artist || '',
    kind: a.kind || 'concert',
    isVisit: !!a.is_visit,
    venue: a.venue || '',
    city: a.city || '',
    date: String(a.attended_on).slice(0, 10),
    rating: a.rating || null,
    memo: a.memo || '',
  };
}

// 화면에서 받은 값 → 저장할 행
export function attendanceRow(input) {
  const t = (v, n) => (v == null ? '' : String(v).trim().slice(0, n));
  const row = {
    event_id: input.eventId || null,
    title: t(input.title, 120),
    artist: t(input.artist, 120) || null,
    kind: input.kind === 'festival' ? 'festival' : 'concert',
    is_visit: !!input.isVisit,
    venue: t(input.venue, 80) || null,
    city: t(input.city, 40) || null,
    attended_on: t(input.date, 10),
    rating: input.rating ? Math.min(5, Math.max(1, Number(input.rating))) : null,
    memo: t(input.memo, 500) || null,
  };
  return row;
}

export function shapeArtist(a) {
  return { id: a.id, name: a.name, nameKo: a.name_ko || '', aliases: a.aliases || [], genres: a.genres || [] };
}

export function shapeNotification(n, eventsById = {}) {
  const ev = eventsById[n.event_id];
  return {
    id: n.id, kind: n.kind, reason: n.reason || '', createdAt: n.created_at, read: !!n.read_at,
    event: ev ? { id: ev.id, slug: ev.slug, title: ev.title, startsAt: ev.starts_at, venue: ev.venue || '', city: ev.city || '', coverUrl: ev.cover_url || '', isVisit: !!ev.is_visit, kind: ev.kind } : null,
  };
}

export function shapeSubmission(r) {
  return {
    id: r.id, title: r.title, artist: r.artist || '', kind: r.kind, isVisit: !!r.is_visit, startsOn: r.starts_on || '',
    venue: r.venue || '', city: r.city || '', ticketOpenAt: r.ticket_open_at || null,
    ticketUrl: /^https?:\/\//i.test(r.ticket_url || '') ? r.ticket_url : '', sourceUrl: r.source_url, memo: r.memo || '',
    status: r.status, eventId: r.event_id || null, createdAt: r.created_at, userId: r.user_id,
  };
}

const url = (v) => { const t = String(v || '').trim(); return /^https?:\/\/\S+$/i.test(t) ? t.slice(0, 500) : null; };
export function submissionRow(input) {
  const t = (v, n) => String(v ?? '').trim().slice(0, n);
  return {
    title: t(input.title, 120), artist: t(input.artist, 200) || null,
    kind: input.kind === 'festival' ? 'festival' : 'concert', is_visit: !!input.isVisit,
    starts_on: /^\d{4}-\d{2}-\d{2}$/.test(input.startsOn || '') ? input.startsOn : null,
    venue: t(input.venue, 80) || null, city: t(input.city, 40) || null,
    ticket_open_at: input.ticketOpenAt || null, ticket_url: url(input.ticketUrl), source_url: url(input.sourceUrl), memo: t(input.memo, 500) || null,
  };
}

// 승인한 제보 → 공연 행
export function eventFromSubmission(s, slug) {
  const day = s.starts_on || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  return {
    slug, title: s.title, kind: s.kind, is_visit: !!s.is_visit, venue: s.venue, city: s.city,
    starts_at: `${day}T18:00:00+09:00`, ends_at: `${day}T23:00:00+09:00`,
    lineup: s.artist, ticket_open_at: s.ticket_open_at, ticket_url: s.ticket_url, source: 'report', source_url: s.source_url,
    description: s.memo ? `제보 메모: ${s.memo}` : null, published: true, genres: [],
  };
}
