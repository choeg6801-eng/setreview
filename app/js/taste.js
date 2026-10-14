// 취향 맞춤: 장르 목록 · 이름 비교 · 맞춤 공연 고르기 · 아티스트 추천
// 데모 모드와 Supabase 모드가 같이 써요. (서버의 알림 만들기 SQL 과 같은 규칙)

export const GENRES = ['팝', '록', '인디', '힙합', 'R&B', '일렉트로닉', '재즈', 'K-pop', '메탈', '포크·어쿠스틱', '발라드', 'J-pop'];

// 소문자 + 공백·기호 제거 (서버의 public.norm_name 과 같아요)
export const norm = (s) => String(s || '').toLowerCase().replace(/[^0-9a-z가-힣ぁ-んァ-ン一-龥]+/g, '');

// "A, B, C 외" 같은 출연진 문자열 → 이름 목록
const NOT_NAMES = /^(여러\s*아티스트|헤드라이너|라인업\s*미정|미정|추후\s*공개|다수|기타|게스트)$/u;

export function splitLineup(text) {
  return String(text || '')
    .replace(/\s*(외|등)\s*\d+\s*(팀|명|인)?/gu, '')   // "외 20팀", "등 5명"
    .split(/[,，、·/\n|]/)
    .map((s) => s.replace(/\s*(외|등|및)\s*$/u, '').trim())
    .filter((s) => s.length >= 2 && s.length <= 40 && !/^\d+\s*(팀|명|인)?$/u.test(s) && !NOT_NAMES.test(s));
}

// 아티스트 이름 → 같은 사람을 가리키는 모든 이름 (영어 · 한글 · 다른 이름)
export function artistIndex(artists) {
  const byKey = new Map();
  for (const a of artists) {
    const names = [a.name, a.nameKo, ...(a.aliases || [])].filter(Boolean);
    const entry = { ...a, keys: [...new Set(names.map(norm).filter((k) => k.length >= 2))] };
    for (const k of entry.keys) byKey.set(k, entry);
  }
  return byKey;
}
const keysFor = (name, idx) => {
  const k = norm(name);
  const a = idx.get(k);
  return a ? a.keys : k.length >= 2 ? [k] : [];
};
const sameArtist = (a, b, idx) => {
  const ka = keysFor(a, idx);
  return keysFor(b, idx).some((k) => ka.includes(k));
};

// 공연에 나오는 사람 이름들 (무대 아티스트 + 출연진 문자열)
export const eventPeople = (ev) => [...new Set([...(ev.artists || []), ...splitLineup(ev.lineup)])];

// 공연 장르 = 공연에 붙은 장르 + 출연 아티스트 장르
export function eventGenres(ev, idx) {
  const g = new Set(ev.genres || []);
  for (const n of eventPeople(ev)) for (const x of idx.get(norm(n))?.genres || []) g.add(x);
  return [...g];
}

const eventText = (ev) => [ev.title, ev.lineup, ...(ev.artists || [])].map(norm).join('|');
const eventWords = (ev) => [ev.title, ev.lineup, ...(ev.artists || [])].join(' ').toLowerCase().split(/[^0-9a-z가-힣ぁ-んァ-ン一-龥]+/u);
// 짧은 이름(TS, IU, 테스 등)은 다른 단어 속에 섞여 잘못 걸리지 않게 '단어 그대로'일 때만 맞춰요 (서버의 name_key_hit 과 같아요)
export const isShortKey = (k) => /^[0-9a-z]{1,4}$/.test(k) || k.length <= 2;
export function eventHasKey(ev, k) {
  return isShortKey(k) ? eventWords(ev).includes(k) : eventText(ev).includes(k);
}

// 내 기록에서 본 아티스트 · 장르
export function seenFrom(records, events, idx) {
  const artists = new Map();
  const genres = new Map();
  const evById = new Map(events.map((e) => [e.id, e]));
  for (const r of records) {
    const names = r.artist ? splitLineup(r.artist) : [];
    const ev = r.eventId ? evById.get(r.eventId) : null;
    if (ev) names.push(...(ev.artists || []));
    const seenHere = new Set();
    for (const n of names) {
      const a = idx.get(norm(n));
      const label = a?.name || n;
      const key = norm(label);
      if (!key || seenHere.has(key)) continue;
      seenHere.add(key);
      artists.set(key, { name: label, count: (artists.get(key)?.count || 0) + 1 });
      for (const g of a?.genres || []) genres.set(g, (genres.get(g) || 0) + 1);
    }
    for (const g of ev ? ev.genres || [] : []) genres.set(g, (genres.get(g) || 0) + 1);
  }
  return {
    artists: [...artists.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    genres: [...genres.entries()].map(([genre, count]) => ({ genre, count })).sort((a, b) => b.count - a.count),
  };
}

// 다가오는 공연 중 내 취향에 맞는 것 + 이유
export function matchEvents(events, { favorites = [], genres = [], seen = [] }, idx) {
  const out = [];
  for (const ev of events) {
    if (ev.status === 'ended' || ev.published === false) continue; // 운영자에게만 보이는 검토 전 초안은 빼요
    const fav = favorites.find((f) => keysFor(f, idx).some((k) => eventHasKey(ev, k)));
    const seenHit = !fav && seen.find((s) => keysFor(s, idx).some((k) => eventHasKey(ev, k)));
    const g = genres.length ? eventGenres(ev, idx).filter((x) => genres.includes(x)) : [];
    if (!fav && !seenHit && !g.length) continue;
    const reason = fav ? `♥ ${fav} 출연` : seenHit ? `본 적 있는 ${seenHit}` : `${g.join(' · ')} 취향`;
    out.push({ ev, reason, score: fav ? 3 : seenHit ? 2 : 1 });
  }
  return out.sort((a, b) => b.score - a.score || a.ev.startsAt.localeCompare(b.ev.startsAt));
}

// 아티스트 추천: 같은 무대에 선 아티스트 · 함께 좋아하는 아티스트 · 같은 장르
export function recommendArtists({ favorites = [], seen = [], genres = [], events = [], artists = [], pairs = [] }, idx, limit = 12) {
  const known = [...favorites, ...seen];
  const isKnown = (n) => known.some((k) => sameArtist(k, n, idx));
  const cands = new Map();
  const add = (name, pts, reason) => {
    const a = idx.get(norm(name));
    const label = a?.name || name;
    const key = norm(label);
    if (!key || key.length < 2 || isKnown(label)) return;
    const c = cands.get(key) || { name: label, nameKo: a?.nameKo && a.nameKo !== label ? a.nameKo : '', score: 0, reasons: [], genres: a?.genres || [] };
    c.score += pts;
    if (reason && !c.reasons.includes(reason) && c.reasons.length < 2) c.reasons.push(reason);
    cands.set(key, c);
  };

  events = events.filter((e) => e.published !== false);
  // 0) 셋리뷰가 정리한 비슷한 아티스트 (가장 강한 신호)
  for (const k of known) {
    const a = idx.get(norm(k));
    for (const s of a?.similar || []) add(s, 3, `${k} 팬이라면 좋아할 만해요`);
  }
  for (const a of artists) {
    const hit = (a.similar || []).find((s) => known.some((k) => sameArtist(k, s, idx)));
    if (hit) add(a.name, 1.5, `${known.find((k) => sameArtist(k, hit, idx)) || hit}와 비슷한 음악`);
  }
  // 1) 같은 공연 · 페스티벌에 함께 나온 아티스트
  for (const ev of events) {
    const people = eventPeople(ev);
    const mine = people.find((p) => isKnown(p));
    if (!mine) continue;
    for (const p of people) add(p, ev.kind === 'festival' ? 2 : 1.5, `${mine}와 같은 무대에 섰어요`);
  }
  // 2) 같은 아티스트를 좋아하는 사람들이 함께 좋아하는 아티스트
  for (const p of pairs) {
    const mine = known.find((k) => sameArtist(k, p.a, idx));
    if (mine) add(p.b, 1 + Math.min(p.users, 10) * 0.5, `${mine} 팬들이 많이 좋아해요`);
  }
  // 3) 좋아하는 장르 · 본 공연 장르와 같은 아티스트
  const myGenres = new Set(genres);
  for (const k of known) for (const g of idx.get(norm(k))?.genres || []) myGenres.add(g);
  for (const a of artists) {
    const overlap = (a.genres || []).filter((g) => myGenres.has(g));
    if (overlap.length) add(a.name, overlap.length * 0.8, `좋아하는 장르: ${overlap.slice(0, 2).join(' · ')}`);
  }

  // 곧 공연이 있으면 조금 더 위로
  const upcoming = events.filter((e) => e.status !== 'ended').sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const list = [...cands.values()].map((c) => {
    const keys = keysFor(c.name, idx);
    const next = upcoming.find((e) => keys.some((k) => eventHasKey(e, k)));
    return { ...c, next: next || null, score: c.score + (next ? 1 : 0) };
  });
  return list.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
}
