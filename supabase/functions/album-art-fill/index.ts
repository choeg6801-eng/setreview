// 셋리스트 곡의 앨범 커버·앨범명·재생 시간을 채워요.
// 애플 iTunes 공개 검색(키 필요 없음)을 써요.
//  1) 아티스트마다 애플 아티스트 번호를 찾아 두고(artists.apple_artist_id),
//  2) 그 번호로 한국·미국(일본 곡이면 일본) 스토어의 곡 목록을 한 번에 불러와 제목을 맞춰요.
//     한국 스토어 목록에는 한글 제목이 그대로 있어서 국내 가수 곡도 찾을 수 있어요.
//  3) 그래도 못 찾은 곡만 "아티스트 + 곡명" 검색으로 한 번 더 찾아요.
// 20분마다 예약 실행(x-sync-secret) 또는 운영자 로그인 토큰으로 불러요.
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

const BATCH = 120;             // 한 번에 살펴볼 곡 수 (같은 아티스트 곡은 한꺼번에 처리)
const TIME_BUDGET_MS = 110_000; // 함수 실행 제한(150초) 안에 끝내요
const GAP_MS = 2500;            // iTunes 는 분당 약 20회까지라 천천히
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (s: string) => (s || '').toLowerCase()
  .replace(/\(.*?\)|\[.*?\]/g, ' ')          // (feat. ...), [Live] 같은 꼬리표는 빼고 비교
  .replace(/[^0-9a-z가-힣ぁ-んァ-ン一-龥]+/g, '');
const BAD_ALBUM = /karaoke|tribute|instrumental|lullaby|piano version|in the style of|노래방/i;

type Hit = { wrapperType?: string; artistId?: number; artistName: string; trackName: string; collectionName: string; artworkUrl100: string; trackTimeMillis?: number };
type Row = { id: string; title: string; artist_id: string; artist_name: string; artist_ko: string | null; aliases: string[] | null; apple_artist_id: number | null; apple_checked_at: string | null };

let lastCall = 0;
async function itunes(path: string, params: Record<string, string>): Promise<Hit[]> {
  const wait = lastCall + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  const url = `https://itunes.apple.com/${path}?${new URLSearchParams(params)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({ results: [] }));
    return (data.results || []) as Hit[];
  } catch { return []; }
}

const keysOf = (r: Row) => [...new Set([r.artist_name, r.artist_ko, ...(r.aliases || [])].filter(Boolean).map((n) => norm(n as string)).filter((k) => k.length >= 2))];
const artistOk = (h: Hit, keys: string[]) => { const a = norm(h.artistName); return keys.some((k) => a.includes(k) || k.includes(a)); };

function titleScore(h: Hit, titleKey: string) {
  const t = norm(h.trackName);
  let score = 0;
  if (t === titleKey) score = 10;
  else if (t.startsWith(titleKey) || titleKey.startsWith(t)) score = 7;
  else if (titleKey.length >= 4 && (t.includes(titleKey) || titleKey.includes(t))) score = 5;
  if (!score) return 0;
  if (BAD_ALBUM.test(h.collectionName)) score -= 4;
  if (/live|라이브|콘서트/i.test(h.collectionName) && !/live/i.test(h.trackName)) score -= 1;
  return score;
}
function best(hits: Hit[], titleKey: string, keys: string[] | null) {
  let b: Hit | null = null, bs = 0;
  for (const h of hits) {
    if (!h.trackName || (keys && !artistOk(h, keys))) continue;
    const s = titleScore(h, titleKey);
    if (s > bs) { b = h; bs = s; }
  }
  return bs >= 5 ? b : null;
}

// 애플 아티스트 번호 찾기 (영문 이름 → 한글 이름 순서, 미국·일본 스토어)
async function resolveArtist(r: Row, keys: string[]): Promise<number | null> {
  const names = [r.artist_name, ...(r.aliases || []), r.artist_ko].filter(Boolean) as string[];
  const latin = names.filter((n) => /[a-z]/i.test(n)).slice(0, 2);
  const tries: [string, string][] = [...latin.map((n) => [n, 'US'] as [string, string]), [names[0], 'JP']];
  for (const [term, country] of tries) {
    const hits = await itunes('search', { term, entity: 'musicArtist', country, limit: '5' });
    const h = hits.find((x) => artistOk(x, keys) && norm(x.artistName).length >= 2);
    if (h?.artistId) return h.artistId;
  }
  return null;
}

async function fill() {
  const started = Date.now();
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const { data, error } = await db.rpc('songs_needing_art_v2', { p_limit: BATCH, p_since: since });
  if (error) throw new Error(error.message);
  const rows = (data || []) as Row[];

  // 아티스트별로 묶어요
  const groups = new Map<string, Row[]>();
  for (const r of rows) groups.set(r.artist_id, [...(groups.get(r.artist_id) || []), r]);

  let filled = 0, checked = 0;
  const missed: string[] = [];
  for (const [artistId, songs] of groups) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    const first = songs[0];
    const keys = keysOf(first);

    // 1) 아티스트 번호
    let aid = first.apple_artist_id;
    if (!aid && (!first.apple_checked_at || Date.parse(first.apple_checked_at) < Date.parse(since))) {
      aid = await resolveArtist(first, keys);
      await db.from('artists').update({ apple_artist_id: aid, apple_checked_at: new Date().toISOString() }).eq('id', artistId);
    }

    // 2) 아티스트 곡 목록 (한국 → 미국, 일본어 제목이 있으면 일본도)
    let catalog: Hit[] = [];
    if (aid) {
      const stores = ['KR', 'US'];
      if (songs.some((s) => /[ぁ-んァ-ン]/.test(s.title))) stores.push('JP');
      for (const c of stores) {
        const list = await itunes('lookup', { id: String(aid), entity: 'song', limit: '200', country: c });
        catalog = catalog.concat(list.filter((h) => h.wrapperType === 'track'));
      }
    }

    for (const s of songs) {
      if (Date.now() - started > TIME_BUDGET_MS) break;
      const titleKey = norm(s.title);
      let hit = titleKey ? best(catalog, titleKey, null) : null;
      // 3) 목록에 없으면 곡 검색 한 번 더 (다른 가수 곡·피처링 곡 등)
      if (!hit && titleKey) {
        const latin = [s.artist_name, ...(s.aliases || [])].find((n) => /[a-z]/i.test(n || '')) || s.artist_name;
        hit = best(await itunes('search', { term: `${latin} ${s.title}`, entity: 'song', country: /[ぁ-んァ-ン]/.test(s.title) ? 'JP' : 'US', limit: '25' }), titleKey, keys);
      }
      const patch: Record<string, unknown> = { art_checked_at: new Date().toISOString() };
      if (hit) {
        patch.album_art_url = hit.artworkUrl100.replace(/\/\d+x\d+bb\./, '/600x600bb.');
        patch.album = hit.collectionName?.slice(0, 200) || null;
        if (hit.trackTimeMillis) patch.duration_sec = Math.round(hit.trackTimeMillis / 1000);
        filled++;
      } else {
        missed.push(`${s.artist_name} - ${s.title}`);
      }
      checked++;
      // 이미 직접 넣은 값은 덮어쓰지 않아요
      await db.from('songs').update(patch).eq('id', s.id).or('album_art_url.is.null,album_art_url.eq.');
    }
  }
  return { checked, filled, artists: groups.size, seconds: Math.round((Date.now() - started) / 1000), missed: missed.slice(0, 20) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST 로 불러 주세요.' }, 405);
  if (!(await isAuthorized(req))) return json({ error: '권한이 없어요.' }, 401);
  try {
    return json(await fill());
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
