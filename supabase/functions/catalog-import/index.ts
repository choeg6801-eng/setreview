// 아티스트별 곡 목록(곡명·앨범·커버·길이)을 애플 iTunes 공개 검색에서 미리 가져와 쌓아 둬요.
// 예상 셋리스트에 어떤 곡이 들어와도 곡 정보와 앨범 커버가 바로 붙도록 하는 용도예요.
//  - 한 번에 아티스트 몇 명씩 처리 (예약 실행 10분마다)
//  - 한국 스토어(한글 제목) + 미국 스토어(영문 제목)에서 각각 최대 200곡
//  - 같은 곡이 여러 앨범에 있으면 가수 본인 정규 앨범 · 먼저 나온 버전을 남기고, 리믹스·라이브·MR·모음집은 빼요
//  - 이미 있는 곡은 건드리지 않고(커버가 비어 있으면 채움), 새 곡만 넣어요
import { createClient } from 'jsr:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function isAuthorized(req: Request) {
  const secret = req.headers.get('x-sync-secret');
  if (secret) {
    const { data } = await db.rpc('verify_sync_secret', { p: secret });
    return data === true;
  }
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const { data: u } = await db.auth.getUser(token);
  if (!u?.user) return false;
  const { data: p } = await db.from('profiles').select('role').eq('id', u.user.id).maybeSingle();
  return p?.role === 'admin';
}

const ARTISTS_PER_RUN = 12;
const TIME_BUDGET_MS = 115_000;
const GAP_MS = 2500;
const RESYNC_DAYS = 30;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (s: string) => (s || '').toLowerCase()
  .replace(/\(.*?\)|\[.*?\]/g, ' ')
  .replace(/[^0-9a-z가-힣ぁ-んァ-ン一-龥]+/g, '');
// 곡명 정리: "(feat. X)", "(with X)", " - Remastered 2015" 같은 꼬리표는 떼고 저장해요
const cleanTitle = (s: string) => s
  .replace(/\s*[\(\[](feat\.?|ft\.?|with|prod\.?|from)\b[^\)\]]*[\)\]]/gi, '')
  .replace(/\s+-\s+(\d{4}\s+)?remaster(ed)?(\s+\d{4})?.*$/i, '')
  .replace(/\s*[\(\[](\d{4}\s+)?remaster(ed)?(\s+\d{4})?[\)\]]/gi, '')
  .trim();
const SKIP_TRACK = /remix|\blive\b|라이브|acoustic|instrumental|\binst\b|\bmr\b|반주|backing track|karaoke|sped up|slowed|nightcore|demo\b|a ?cappella|acapella|extended\)|version\)|ver\.\)|\bmix\)|\bmixed\b|edit\)|intro\b|interlude|skit|commentary|voice memo|\s\/\s/i;
const SKIP_ALBUM = /karaoke|tribute|instrumental|lullaby|in the style of|노래방|remix|\blive\b|라이브|콘서트|greatest hits|best of|best album|베스트|the hits|collection|anthology|essentials|playlist|now that|dj mix|\bmixed\b|리메이크|remake/i;

type Hit = { primaryGenreName?: string; wrapperType?: string; kind?: string; trackId?: number; artistId?: number; artistName: string; collectionArtistName?: string; trackName: string; collectionName: string; artworkUrl100: string; trackTimeMillis?: number; releaseDate?: string; collectionType?: string };

let lastCall = 0;
async function itunes(path: string, params: Record<string, string>): Promise<Hit[]> {
  const wait = lastCall + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  try {
    const res = await fetch(`https://itunes.apple.com/${path}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({ results: [] }));
    return (data.results || []) as Hit[];
  } catch { return []; }
}

type Artist = { id: string; name: string; name_ko: string | null; aliases: string[] | null; apple_artist_id: number | null };
const keysOf = (a: Artist) => [...new Set([a.name, a.name_ko, ...(a.aliases || [])].filter(Boolean).map((n) => norm(n as string)).filter((k) => k.length >= 2))];
const artistOk = (h: Hit, keys: string[]) => { const n = norm(h.artistName); return keys.some((k) => n === k || n.includes(k) || k.includes(n)); };

const HANGUL = /[가-힣]/;
// 한국 가수(이름이 한글)는 동명이인 해외 가수가 잡히기 쉬워서, 한국 스토어 결과로 한 번 더 확인해요
const isKoreanAct = (a: Artist) => HANGUL.test(a.name);
async function resolveArtist(a: Artist, keys: string[]) {
  const names = [a.name, ...(a.aliases || []), a.name_ko].filter(Boolean) as string[];
  const latin = names.filter((n) => /[a-z]/i.test(n)).slice(0, 2);
  // 일본 가수는 일본어 이름(浜野はるき 등)으로 일본 스토어에서도 찾아요
  const jp = names.filter((n) => /[ぁ-んァ-ン一-龥]/.test(n)).slice(0, 2);
  const tries: [string, string][] = [...latin.map((n) => [n, 'US'] as [string, string]), ...jp.map((n) => [n, 'JP'] as [string, string]), [names[0], 'JP']];
  if (isKoreanAct(a)) tries.unshift([a.name, 'US']);
  for (const [term, country] of tries) {
    const hits = await itunes('search', { term, entity: 'musicArtist', country, limit: '5' });
    // 이름이 정확히 같은 결과를 먼저, 없으면 포함하는 결과
    const exact = hits.find((x) => x.artistId && keys.includes(norm(x.artistName)));
    const loose = hits.find((x) => x.artistId && artistOk(x, keys));
    const h = exact || loose;
    if (h?.artistId) return h.artistId;
  }
  return null;
}

// 같은 곡 후보 중 가장 "원곡다운" 것 고르기
function rank(h: Hit) {
  let s = 0;
  if (h.collectionArtistName && norm(h.collectionArtistName) !== norm(h.artistName)) s -= 3; // 여러 가수 모음집
  if (/deluxe|expanded|anniversary|edition|special/i.test(h.collectionName)) s -= 1;
  if (/ - single$/i.test(h.collectionName)) s -= 0.5;
  return s;
}

async function importArtist(a: Artist) {
  const keys = keysOf(a);
  let aid = a.apple_artist_id;
  if (!aid) aid = await resolveArtist(a, keys);
  if (!aid) {
    await db.from('artists').update({ apple_checked_at: new Date().toISOString(), catalog_synced_at: new Date().toISOString(), catalog_song_count: 0 }).eq('id', a.id);
    return { artist: a.name, added: 0, note: '애플 뮤직에서 찾지 못함' };
  }

  // 한국 스토어 → 미국 스토어 순서 (한국 목록의 한글 제목을 우선)
  const all: (Hit & { store: string })[] = [];
  // 일본어 이름이 있는 가수는 일본 스토어도 봐요 (한국·미국 스토어에 없는 곡이 많아요)
  const isJp = [a.name, a.name_ko, ...(a.aliases || [])].some((n) => /[ぁ-んァ-ン]/.test(n || ''));
  for (const c of isJp ? ['KR', 'JP', 'US'] : ['KR', 'US']) {
    const list = await itunes('lookup', { id: String(aid), entity: 'song', limit: '200', country: c });
    for (const h of list) if (h.wrapperType === 'track' && h.kind === 'song') all.push({ ...h, store: c });
  }
  // 같은 곡은 스토어가 달라도 트랙 번호가 같아요. 한국 스토어에서 이미 본 곡은 미국 스토어 쪽(영문 제목)을 버려요
  // (먼저 본 스토어 쪽만 남겨요: 한국 → 일본 → 미국)
  const seenIds = new Set<number>();
  for (let i = 0; i < all.length; i++) {
    const id = all[i].trackId;
    if (!id) continue;
    if (seenIds.has(id)) { all.splice(i, 1); i--; } else seenIds.add(id);
  }

  // 한국 가수인데 한국 스토어 결과가 한글 이름도, 한글 제목도 거의 없으면 동명이인으로 보고 건너뛰어요
  if (isKoreanAct(a)) {
    const kr = all.filter((h) => h.store === 'KR');
    const hangulName = kr.some((h) => HANGUL.test(h.artistName));
    const share = kr.length ? kr.filter((h) => HANGUL.test(h.trackName)).length / kr.length : 0;
    // 영어 제목이 많은 K-POP 그룹은 장르(K-Pop·가요)로 확인해요
    const kGenre = kr.some((h) => /k-?pop|korean|가요|케이팝/i.test(h.primaryGenreName || ''));
    if (!hangulName && share < 0.15 && !kGenre) {
      await db.from('artists').update({ apple_artist_id: null, apple_checked_at: new Date().toISOString(), catalog_synced_at: new Date().toISOString(), catalog_song_count: 0 }).eq('id', a.id);
      return { artist: a.name, added: 0, note: '동명이인으로 보여 건너뜀' };
    }
  }

  // 곡별로 묶어서 대표 버전 하나씩
  const byKey = new Map<string, (Hit & { store: string })>();
  for (const h of all) {
    if (!h.trackName || !artistOk(h, keys)) continue;            // 이 가수가 부른 곡만 (피처링 참여곡 일부 포함)
    if (SKIP_TRACK.test(h.trackName) || SKIP_ALBUM.test(h.collectionName)) continue;
    const title = cleanTitle(h.trackName);
    const k = norm(title);
    if (k.length < 1) continue;
    const prev = byKey.get(k);
    if (!prev) { byKey.set(k, h); continue; }
    const better = rank(h) > rank(prev) || (rank(h) === rank(prev) && (h.releaseDate || '9') < (prev.releaseDate || '9'));
    // 한국 스토어 제목(한글)을 지켜요: 같은 곡이면 KR 쪽 제목 유지
    if (better) byKey.set(k, { ...h, trackName: prev.store !== 'US' && h.store === 'US' ? prev.trackName : h.trackName, store: prev.store !== 'US' && h.store === 'US' ? prev.store : h.store });
  }

  // 이미 있는 곡
  const { data: existing } = await db.from('songs').select('id, title, album_art_url, hidden').eq('artist_id', a.id);
  const have = new Map((existing || []).map((s) => [norm(s.title), s]));
  let restored = 0;

  const inserts: Record<string, unknown>[] = [];
  let artFilled = 0;
  for (const [k, h] of byKey) {
    const art = h.artworkUrl100?.replace(/\/\d+x\d+bb\./, '/600x600bb.') || null;
    const row = {
      title: cleanTitle(h.trackName).slice(0, 200),
      album: h.collectionName?.slice(0, 200) || null,
      album_art_url: art,
      duration_sec: h.trackTimeMillis ? Math.round(h.trackTimeMillis / 1000) : null,
      apple_track_id: h.trackId || null,
      art_checked_at: new Date().toISOString(),
    };
    const old = have.get(k);
    if (old) {
      // 예전에 숨긴 곡이 이번 기준을 통과하면 새 정보로 다시 보이게 해요
      if (old.hidden) {
        await db.from('songs').update({ ...row, hidden: false }).eq('id', old.id);
        restored++;
        continue;
      }
      if (!old.album_art_url) {
        await db.from('songs').update({ album: row.album, album_art_url: row.album_art_url, duration_sec: row.duration_sec, apple_track_id: row.apple_track_id, art_checked_at: row.art_checked_at })
          .eq('id', old.id).or('album_art_url.is.null,album_art_url.eq.');
        artFilled++;
      }
      continue;
    }
    inserts.push({ artist_id: a.id, ...row });
  }
  for (let i = 0; i < inserts.length; i += 200) {
    const { error } = await db.from('songs').insert(inserts.slice(i, i + 200));
    if (error) throw new Error(`${a.name}: ${error.message}`);
  }
  await db.from('artists').update({
    apple_artist_id: aid, apple_checked_at: new Date().toISOString(),
    catalog_synced_at: new Date().toISOString(), catalog_song_count: byKey.size,
  }).eq('id', a.id);
  return { artist: a.name, added: inserts.length, restored, artFilled, total: byKey.size };
}

async function run(body: { artistIds?: string[] }) {
  const started = Date.now();
  let q = db.from('artists').select('id, name, name_ko, aliases, apple_artist_id');
  if (body.artistIds?.length) q = q.in('id', body.artistIds);
  else {
    const since = new Date(Date.now() - RESYNC_DAYS * 86400000).toISOString();
    q = q.or(`catalog_synced_at.is.null,catalog_synced_at.lt.${since}`).order('catalog_synced_at', { ascending: true, nullsFirst: true });
  }
  const { data: artists, error } = await q.limit(ARTISTS_PER_RUN);
  if (error) throw new Error(error.message);
  const results = [];
  for (const a of (artists || []) as Artist[]) {
    if (Date.now() - started > TIME_BUDGET_MS - 12_000) break;   // 아티스트 하나는 약 8초
    try { results.push(await importArtist(a)); } catch (e) { results.push({ artist: a.name, error: (e as Error).message }); }
  }
  const { count } = await db.from('songs').select('id', { count: 'exact', head: true });
  return { seconds: Math.round((Date.now() - started) / 1000), done: results.length, totalSongs: count, results };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST 로 불러 주세요.' }, 405);
  if (!(await isAuthorized(req))) return json({ error: '권한이 없어요.' }, 401);
  try {
    const body = await req.json().catch(() => ({}));
    return json(await run(body || {}));
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
