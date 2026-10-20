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
const BAD = /\blive\b|라이브|cover|커버|karaoke|노래방|lyrics?\b|가사|remix|reaction|sped ?up|slowed|nightcore|instrumental|inst\b|mr\b|8d|1 ?hour|teaser|티저|직캠|fancam|piano|피아노|@|\bmnet\b|m countdown|엠카|music bank|뮤직뱅크|inkigayo|인기가요|음악중심|show!|스케치북|sketchbook|윤도현|유희열|\bkbs\b|\bmbc\b|\bsbs\b|\bebs\b|콘서트|concert|full ver|교차편집|stage mix/i;
// 공식 음원 · 뮤직비디오를 올리는 유통사 · 기획사 채널
const LABELS = /1thek|원더케이|stone ?music|genie ?music|지니뮤직|kakao ?(m|entertainment)|smtown|jyp ?entertainment|ygentertainment|hybe ?labels|ibighit|starship|amoeba ?culture|아메바컬쳐|cj ?enm|mnet ?k-?pop|ambition ?musik|aomg|hi-?lite|antenna|mystic ?story|rbw|wm ?entertainment|fnc|cube|pledis|kq ?entertainment|our ?bloom|magic ?strawberry|vibe ?music|sony ?music|universal ?music|warner ?music/i;
// 영상 제목에 곡 제목이 '한 덩어리'로 들어 있는지 (Love Love Love ≠ Love Love Loveless)
function titleHit(videoTitle: string, title: string) {
  const words = title.toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ').split(/[^0-9a-z가-힣ぁ-んァ-ン一-龥]+/).filter(Boolean);
  if (!words.length) return false;
  const esc = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^0-9a-z가-힣ぁ-んァ-ン一-龥]*');
  const isLatin = /[0-9a-z]$/.test(words[words.length - 1]);
  // 영문 제목은 뒤에 글자가 더 붙으면 다른 곡, 한글 제목은 조사 없이 붙는 경우가 드물어 앞뒤만 느슨하게
  const re = new RegExp(`(^|[^0-9a-z${isLatin ? '' : '가-힣'}])${esc}(?![0-9a-z${isLatin ? '' : '가-힣'}])`, 'i');
  return re.test(videoTitle.toLowerCase());
}
// 영상 제목에서 가수 이름 · 괄호 · 'Official MV' 같은 꾸밈말을 뺀 나머지가 곡 제목으로 시작해야 해요 (이력서 ≠ 다시 쓰는 이력서)
function coreStartsWith(videoTitle: string, title: string, artistKeys: string[]) {
  // 따옴표 안이 곡 제목이면 바로 OK (에픽하이 x 다비치 '미장센' Official M/V)
  for (const m of videoTitle.matchAll(/['"‘“「]([^'"’”」]+)['"’”」]/g)) if (norm(m[1]).startsWith(norm(title))) return true;
  let v = videoTitle.toLowerCase().replace(/\(.*?\)|\[.*?\]|【.*?】|「|」|'|"|‘|’|“|”/g, ' ');
  v = v.replace(/official|music video|m\/v|\bmv\b|audio|video|lyrics?|visualizer|공식|뮤직비디오/g, ' ');
  let n = norm(v);
  for (const k of [...artistKeys].sort((a, b) => b.length - a.length)) if (k && n.startsWith(k)) n = n.slice(k.length);
  for (const k of artistKeys) if (k && n.includes(k) && !norm(title).includes(k)) n = n.replace(k, '');
  return n.startsWith(norm(title));
}
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');

type Row = { id: string; title: string; original_artist: string | null; artist_name: string; artist_ko: string | null; keys?: string[] };
type Item = { id: { videoId?: string }; snippet: { title: string; channelTitle: string } };

function score(it: Item, r: Row, artist: string) {
  const vt = decode(it.snippet.title), ch = decode(it.snippet.channelTitle);
  const t = norm(r.title);
  // 아티스트 이름: 영문 · 한글 · 다른 표기(에픽하이 = Epik High) 모두로 채널을 알아봐요
  const names = [...new Set([artist, r.artist_ko || '', ...(r.original_artist ? [] : r.keys || [])].map(norm).filter((k) => k.length >= 2))];
  const nch = norm(ch);
  if (!t || !titleHit(vt, r.title) || !coreStartsWith(vt, r.title, names)) return -99; // 곡 제목이 영상 제목에 그대로 있어야 해요
  const chHit = names.some((k) => nch.includes(k));
  // 공식 채널만 받아요: 유튜브 뮤직 음원(Topic) > 아티스트 채널 · VEVO > 유통사 · 기획사 채널. 팬 업로드는 받지 않아요.
  let s = 0;
  if (/ - topic$/i.test(ch) && chHit) s = 10;
  else if (chHit || /vevo$/i.test(ch)) s = 6;
  else if (LABELS.test(ch)) s = 5;
  else return -99;
  if (/official (audio|video|music video|mv)|m\/v|\bmv\b|공식/i.test(vt)) s += 1;
  if (BAD.test(vt) && !BAD.test(r.title)) s -= 8;
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
  let best: Item | null = null, bs = 4; // 공식 채널(5점 이상)만
  for (const it of (data.items || []) as Item[]) {
    if (!it.id?.videoId) continue;
    const s = score(it, r, artist);
    if (s > bs) { best = it; bs = s; }
  }
  return best?.id.videoId || null;
}

async function run(limit: number, events: string[] = []) {
  const key = (Deno.env.get('YOUTUBE_API_KEY') || '').trim();
  if (!key) return { waiting: true, message: 'YOUTUBE_API_KEY 가 없어서 아직 찾지 않았어요.' };
  // 운영자가 특정 공연(events)을 고르면 그 공연 곡부터, 아니면 담아 둔 공연 · 가까운 공연 순서
  const { data, error } = events.length
    ? await db.rpc('songs_needing_youtube_for_events', { p_events: events, p_limit: limit })
    : await db.rpc('songs_needing_youtube', { p_limit: limit });
  if (error) throw new Error(error.message);
  const rows = (data || []) as Row[];
  // 아티스트의 다른 표기(aliases)를 붙여요
  const artistNames = [...new Set(rows.map((r) => r.artist_name))];
  if (artistNames.length) {
    const { data: arts } = await db.from('artists').select('name, name_ko, aliases').in('name', artistNames);
    const byName = new Map((arts || []).map((a: { name: string; name_ko: string | null; aliases: string[] | null }) => [a.name, [a.name, a.name_ko || '', ...(a.aliases || [])]]));
    for (const r of rows) r.keys = byName.get(r.artist_name) || [];
  }
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
    const events = Array.isArray(body?.events) ? body.events.filter((x: unknown) => typeof x === 'string').slice(0, 20) : [];
    return json(await run(limit, events));
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
