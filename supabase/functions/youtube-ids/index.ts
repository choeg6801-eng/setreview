// 셋리스트 곡마다 유튜브 영상 번호(공식 음원)를 찾아 둬요.
// 이 번호로 공연 화면에서 '유튜브 · 유튜브 뮤직에서 전곡 재생' 재생목록을 한 번에 만들어요.
//  - 필요한 비밀값: YOUTUBE_API_KEY (Google Cloud → YouTube Data API v3, 무료 할당량 하루 10,000 = 검색 100번)
//  - 매시간 예약 실행(x-sync-secret)으로 4곡씩 → 하루 약 96곡. 담아 둔 공연 · 가까운 공연 곡부터.
//  - 운영자 로그인 토큰으로 부르면 { limit } 만큼 바로 찾아요.
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

const norm = (s: string) => (s || '').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^0-9a-z가-힣ぁ-んァ-ン一-龥]+/g, '');
const BAD = /\blive\b|라이브|cover|커버|karaoke|노래방|lyrics?\b|가사|remix|reaction|sped ?up|slowed|nightcore|instrumental|inst\b|mr\b|8d|1 ?hour|teaser|티저|직캠|fancam|piano|피아노/i;
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');

type Row = { id: string; title: string; original_artist: string | null; artist_name: string; artist_ko: string | null };
type Item = { id: { videoId?: string }; snippet: { title: string; channelTitle: string } };

function score(it: Item, r: Row, artist: string) {
  const vt = decode(it.snippet.title), ch = decode(it.snippet.channelTitle);
  const t = norm(r.title), a = norm(artist), ako = norm(r.artist_ko || '');
  const nvt = norm(vt), nch = norm(ch);
  if (!t || !nvt.includes(t.slice(0, Math.max(4, Math.min(t.length, 12))))) return -99; // 곡 제목이 영상 제목에 있어야 해요
  let s = 0;
  if (/ - topic$/i.test(ch) && (nch.includes(a) || (ako && nch.includes(ako)))) s += 6; // 유튜브 뮤직 공식 음원
  else if (nch.includes(a) || (ako && nch.includes(ako)) || /vevo$/i.test(ch)) s += 4;  // 아티스트 공식 채널
  if (/official (audio|video|music video|mv)|m\/v|\bmv\b|공식/i.test(vt)) s += 2;
  if (BAD.test(vt) && !BAD.test(r.title)) s -= 6;
  return s;
}

async function search(r: Row, key: string) {
  const artist = r.original_artist || r.artist_name;
  const q = `${artist} ${r.title}`;
  const url = `https://www.googleapis.com/youtube/v3/search?${new URLSearchParams({
    part: 'snippet', type: 'video', videoCategoryId: '10', maxResults: '8', regionCode: 'KR', q, key,
  })}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `YouTube ${res.status}`);
  let best: Item | null = null, bs = 1; // 공식 채널이거나 공식 영상 표시가 있는 것만
  for (const it of (data.items || []) as Item[]) {
    if (!it.id?.videoId) continue;
    const s = score(it, r, artist);
    if (s > bs) { best = it; bs = s; }
  }
  return best?.id.videoId || null;
}

async function run(limit: number) {
  const key = (Deno.env.get('YOUTUBE_API_KEY') || '').trim();
  if (!key) return { waiting: true, message: 'YOUTUBE_API_KEY 가 없어서 아직 찾지 않았어요.' };
  const { data, error } = await db.rpc('songs_needing_youtube', { p_limit: limit });
  if (error) throw new Error(error.message);
  const rows = (data || []) as Row[];
  let found = 0;
  const missed: string[] = [];
  for (const r of rows) {
    let vid: string | null = null;
    try { vid = await search(r, key); } catch (e) {
      // 할당량을 다 쓰면 오늘은 여기까지
      if (/quota/i.test((e as Error).message)) return { found, checked: found + missed.length, stopped: 'quota', missed };
      throw e;
    }
    await db.from('songs').update({ youtube_id: vid, youtube_checked_at: new Date().toISOString() }).eq('id', r.id);
    if (vid) found++; else missed.push(`${r.artist_name} - ${r.title}`);
  }
  return { checked: rows.length, found, missed };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST 로 불러 주세요.' }, 405);
  if (!(await isAuthorized(req))) return json({ error: '권한이 없어요.' }, 401);
  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body?.limit) || 4, 1), 50);
    return json(await run(limit));
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
