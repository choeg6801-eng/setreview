// 셋리스트 곡의 앨범 커버·앨범명·재생 시간을 채워요.
// 애플 iTunes 검색(공개 검색 기능, 키 필요 없음)으로 "아티스트 + 곡명"을 찾아 가장 잘 맞는 곡의 커버를 써요.
// 한국 스토어는 검색 결과가 비어서 미국 → 일본 스토어 순서로 찾고, 아티스트는 영문·한글·다른 표기를 모두 시도해요.
// 30분마다 예약 실행(x-sync-secret) 또는 운영자 로그인 토큰으로 불러요.
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

const BATCH = 40;              // 한 번에 확인할 곡 수 (iTunes 검색은 분당 약 20회까지라 천천히)
const GAP_MS = 2600;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (s: string) => (s || '').toLowerCase()
  .replace(/\(.*?\)|\[.*?\]/g, ' ')          // (feat. ...), [Live] 같은 꼬리표는 빼고 비교
  .replace(/[^0-9a-z가-힣ぁ-んァ-ン一-龥]+/g, '');
const BAD_ALBUM = /karaoke|tribute|instrumental|cover|lullaby|piano version|in the style of|노래방/i;

type Hit = { artistName: string; trackName: string; collectionName: string; artworkUrl100: string; trackTimeMillis?: number; releaseDate?: string; collectionType?: string };

async function search(term: string, country: string): Promise<Hit[]> {
  const url = `https://itunes.apple.com/search?${new URLSearchParams({ term, entity: 'song', country, limit: '25' })}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (res.status === 403 || res.status === 429) { await sleep(8000); continue; }
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({ results: [] }));
    return (data.results || []) as Hit[];
  }
  return [];
}

function pick(hits: Hit[], artistKeys: string[], titleKey: string): Hit | null {
  let best: Hit | null = null, bestScore = 0;
  for (const h of hits) {
    const a = norm(h.artistName), t = norm(h.trackName);
    if (!artistKeys.some((k) => a.includes(k) || k.includes(a))) continue;
    let score = 0;
    if (t === titleKey) score = 10;
    else if (t.startsWith(titleKey) || titleKey.startsWith(t)) score = 7;
    else if (titleKey.length >= 4 && (t.includes(titleKey) || titleKey.includes(t))) score = 5;
    if (!score) continue;
    if (BAD_ALBUM.test(h.collectionName)) score -= 4;
    if (/live|라이브/i.test(h.collectionName) && !/live/i.test(h.trackName)) score -= 1;
    if (score > bestScore) { best = h; bestScore = score; }
  }
  return bestScore >= 5 ? best : null;
}

async function fill() {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  // 예상·실제 셋리스트에 들어간 곡을 먼저, 그다음 나머지 곡
  const { data: rows, error } = await db.rpc('songs_needing_art', { p_limit: BATCH, p_since: since });
  if (error) throw new Error(error.message);
  const songs = (rows || []) as { id: string; title: string; artist_name: string; artist_ko: string | null; aliases: string[] | null }[];

  let filled = 0;
  const missed: string[] = [];
  for (const s of songs) {
    const names = [s.artist_name, s.artist_ko, ...(s.aliases || [])].filter(Boolean) as string[];
    const artistKeys = [...new Set(names.map(norm).filter((k) => k.length >= 2))];
    const titleKey = norm(s.title);
    let hit: Hit | null = null;
    const latin = names.filter((n) => /[a-z]/i.test(n));
    const tries: [string, string][] = [];
    for (const n of (latin.length ? latin : names).slice(0, 2)) tries.push([`${n} ${s.title}`, 'US']);
    tries.push([`${names[0]} ${s.title}`, 'JP']);
    for (const [term, country] of tries) {
      if (!titleKey) break;
      hit = pick(await search(term, country), artistKeys, titleKey);
      await sleep(GAP_MS);
      if (hit) break;
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
    // 이미 직접 넣은 값은 덮어쓰지 않아요 (album_art_url 이 비어 있는 곡만 골랐어요)
    await db.from('songs').update(patch).eq('id', s.id).or('album_art_url.is.null,album_art_url.eq.');
  }
  return { checked: songs.length, filled, missed: missed.slice(0, 20) };
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
