// 이미 연결된 유튜브 영상을 다시 점검하고, 문제가 있으면 더 나은 공식 영상으로 바꿔요.
//  - 점검: 한국에서 재생 가능한지(삭제 · 비공개 · 지역 제한 · 연령 제한 · 퍼가기 막힘), 제목이 맞는지,
//    같은 곡의 공식 음원 중 '진짜' 음원인지(조회수가 다른 후보보다 지나치게 적은 가짜 앨범 음원은 걸러요)
//  - 후보: 아티스트 공식 음원 채널(Topic) 곡 목록(싸요) → 없으면 검색(비싸서 예산 안에서만)
//  - videos.list 로 50개씩 한 번에 확인해서 할당량이 거의 안 들어요.
//  body: { fix?: boolean, budget?: number, ids?: string[] (곡 id), debug?: boolean }
import { createClient } from 'jsr:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function isAuthorized(req: Request) {
  const secret = req.headers.get('x-sync-secret');
  if (secret) { const { data } = await db.rpc('verify_sync_secret', { p: secret }); return data === true; }
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const { data: u } = await db.auth.getUser(token);
  if (!u?.user) return false;
  const { data: p } = await db.from('profiles').select('role').eq('id', u.user.id).maybeSingle();
  return p?.role === 'admin';
}

const norm = (s: string) => (s || '').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^0-9a-z가-힣ぁ-んァ-ン一-龥]+/g, '');
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
const BAD = /\blive\b|라이브|cover|커버|karaoke|노래방|lyrics?\b|가사|remix|reaction|sped ?up|slowed|nightcore|instrumental|inst\b|\bmr\b|8d|1 ?hour|teaser|티저|직캠|fancam|piano|피아노|콘서트|concert|festival|페스티벌|stage\b|무대|session|세션|acoustic|어쿠스틱|demo\b|alternate|karaoke|tribute|performance|퍼포먼스|special\)|showcase|쇼케이스|victoria|made famous|in the style of|originally performed/i;
const LABELS = /1thek|원더케이|stone ?music|genie ?music|지니뮤직|kakao ?(m|entertainment)|smtown|jyp ?entertainment|ygentertainment|hybe ?labels|ibighit|starship|amoeba ?culture|아메바컬쳐|cj ?enm|ambition ?musik|aomg|antenna|mystic ?story|our ?bloom|magic ?strawberry|peponi|sony ?music|universal ?music|warner ?music|atlantic ?records|interscope|republic ?records|columbia ?records|rca ?records|capitol ?records|def ?jam/i;
const titleVariants = (v: string) => [v, ...[...v.matchAll(/[(\[]([^)\]]+)[)\]]/g)].map((m) => m[1])].map(norm).filter(Boolean);
const CHO = ['g','kk','n','d','tt','r','m','b','pp','s','ss','','j','jj','ch','k','t','p','h'];
const JUNG = ['a','ae','ya','yae','eo','e','yeo','ye','o','wa','wae','oe','yo','u','wo','we','wi','yu','eu','ui','i'];
const JONG = ['','k','k','k','n','n','n','t','l','k','m','l','l','l','p','l','m','p','p','t','t','ng','t','t','k','t','p','t'];
const LINK: Record<number, string> = { 1: 'g', 4: 'n', 8: 'r', 16: 'm', 17: 'b', 19: 's', 21: 'ng', 22: 'j' };
function romanize(s: string) {
  let out = '';
  const chars = [...s];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i].codePointAt(0)!;
    if (c < 0xac00 || c > 0xd7a3) { out += chars[i]; continue; }
    const n = c - 0xac00, jong = n % 28;
    out += CHO[Math.floor(n / 588)] + JUNG[Math.floor((n % 588) / 28)];
    const nx = chars[i + 1]?.codePointAt(0) ?? 0;
    const nextVowel = nx >= 0xac00 && nx <= 0xd7a3 && Math.floor((nx - 0xac00) / 588) === 11;
    if (jong) out += nextVowel ? (LINK[jong] ?? JONG[jong]) : JONG[jong];
  }
  return norm(out);
}

let units = 0;
async function yt(path: string, params: Record<string, string>, key: string, cost: number) {
  units += cost;
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams({ ...params, key })}`, { signal: AbortSignal.timeout(15_000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `YouTube ${res.status}`);
  return data;
}

// body.all 이 아니면 최근 7일 안에 점검한 곡은 건너뛰어요 (할당량 아끼기)
type Song = { id: string; title: string; alt_title: string | null; original_artist: string | null; artist_name: string; artist_ko: string | null; aliases: string[] | null; youtube_id: string; youtube_verified_at: string | null };
type Info = { id: string; title: string; channel: string; views: number; seconds: number; problems: string[] };

const dur = (iso: string) => { const m = (iso || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); return m ? (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0)) : 0; };

// 영상 정보를 50개씩 한 번에 (1점)
const infoCache = new Map<string, Info | null>();
async function details(ids: string[], key: string) {
  const need = [...new Set(ids)].filter((x) => !infoCache.has(x));
  for (let i = 0; i < need.length; i += 50) {
    const chunk = need.slice(i, i + 50);
    const data = await yt('videos', { part: 'snippet,status,contentDetails,statistics', id: chunk.join(','), maxResults: '50' }, key, 1);
    const got = new Set<string>();
    for (const v of data.items || []) {
      got.add(v.id);
      const problems: string[] = [];
      if (v.status?.privacyStatus !== 'public' && v.status?.privacyStatus !== 'unlisted') problems.push('비공개');
      if (v.status?.uploadStatus && v.status.uploadStatus !== 'processed') problems.push('업로드 안 됨');
      if (v.status?.embeddable === false) problems.push('퍼가기 막힘');
      const rr = v.contentDetails?.regionRestriction;
      if (rr?.blocked?.includes('KR') || (rr?.allowed && !rr.allowed.includes('KR'))) problems.push('한국 재생 막힘');
      if (v.contentDetails?.contentRating?.ytRating === 'ytAgeRestricted') problems.push('연령 제한');
      infoCache.set(v.id, {
        id: v.id, title: decode(v.snippet?.title || ''), channel: decode(v.snippet?.channelTitle || ''),
        views: Number(v.statistics?.viewCount || 0), seconds: dur(v.contentDetails?.duration || ''), problems,
      });
    }
    for (const x of chunk) if (!got.has(x)) infoCache.set(x, null); // 삭제된 영상
  }
}

const artistKeys = (s: Song) => [...new Set((s.original_artist ? [s.original_artist] : [s.artist_name, s.artist_ko || '', ...(s.aliases || [])]).map(norm).filter((k) => k.length >= 2))];

// 영상 제목이 이 곡인지: 꾸밈말 · 가수 이름을 빼고 곡 제목(또는 다른 제목 · 로마자)으로 시작
function titleOk(videoTitle: string, s: Song) {
  const wants = [norm(s.title), s.alt_title ? norm(s.alt_title) : '', /[가-힣]/.test(s.title) ? romanize(s.title) : ''].filter((x) => x.length >= 1);
  const keys = artistKeys(s);
  for (const m of videoTitle.matchAll(/['"‘“「]([^'"’”」]+)['"’”」]/g)) if (wants.includes(norm(m[1]))) return true;
  if (titleVariants(videoTitle).some((v) => wants.includes(v))) return true;
  let v = videoTitle.toLowerCase().replace(/\(.*?\)|\[.*?\]|【.*?】/g, ' ');
  v = v.replace(/official|music video|m\/v|\bmv\b|audio|video|visualizer|공식|뮤직비디오/g, ' ');
  let n = norm(v);
  for (const k of [...keys].sort((a, b) => b.length - a.length)) if (n.startsWith(k)) n = n.slice(k.length);
  for (const k of keys) if (n.includes(k) && !wants.some((w) => w.includes(k))) n = n.replace(k, '');
  // 뒤에 붙어도 되는 건 피처링 · 프로듀서 · 리마스터 표기뿐 (Love Love Love ≠ Love Love Loveless)
  return wants.some((w) => w && (n === w || (n.startsWith(w) && /^(feat|ft|featuring|with|prod|remaster|x[a-z가-힣])/.test(n.slice(w.length)))));
}
function channelTier(ch: string, s: Song) {
  const nch = norm(ch);
  const hit = artistKeys(s).some((k) => nch.includes(k));
  if (/ - topic$/i.test(ch) && hit) return 3;
  if (hit || /vevo$/i.test(ch)) return 2;
  if (LABELS.test(ch)) return 1;
  return 0;
}
const playable = (i: Info | null | undefined): i is Info => !!i && i.problems.length === 0;

// 후보 중 가장 믿을 만한 것: 재생 가능 + 제목 맞음 + 공식 채널 + 일반 곡 길이.
// 공식 음원(Topic)을 먼저 고르되, 같은 곡의 다른 공식 영상보다 조회수가 지나치게 적으면(가짜 앨범 · 잘못 올라간 음원) 건너뛰어요.
function pickBest(ids: string[], s: Song) {
  const ok = [...new Set(ids)].map((x) => infoCache.get(x)).filter(playable)
    .filter((i) => titleOk(i.title, s) && channelTier(i.channel, s) > 0 && !(BAD.test(i.title) && !BAD.test(s.title)) && (i.seconds === 0 || (i.seconds >= 60 && i.seconds <= 900)));
  if (!ok.length) return null;
  const top = Math.max(...ok.map((i) => i.views));
  const topic = ok.filter((i) => channelTier(i.channel, s) === 3).sort((a, b) => b.views - a.views)[0];
  if (topic && (topic.views >= top * 0.03 || topic.views >= 200_000)) return topic;
  // 조회수가 지나치게 적은 음원뿐이면 공식 뮤직비디오(아티스트 채널 · VEVO · 기획사)를 써요
  const others = ok.filter((i) => channelTier(i.channel, s) < 3).sort((a, b) => channelTier(b.channel, s) - channelTier(a.channel, s) || b.views - a.views);
  return others[0] || topic;
}

const uploadsCache = new Map<string, { videoId: string; title: string }[]>();
async function topicUploads(channelId: string, key: string) {
  if (uploadsCache.has(channelId)) return uploadsCache.get(channelId)!;
  const out: { videoId: string; title: string }[] = [];
  let page = '';
  for (let i = 0; i < 20; i++) {
    const params: Record<string, string> = { part: 'snippet', playlistId: 'UU' + channelId.slice(2), maxResults: '50' };
    if (page) params.pageToken = page;
    let data;
    try { data = await yt('playlistItems', params, key, 1); } catch (e) { if (/quota/i.test((e as Error).message)) throw e; break; }
    for (const it of data.items || []) { const vid = it.snippet?.resourceId?.videoId; if (vid) out.push({ videoId: vid, title: decode(it.snippet.title || '') }); }
    page = data.nextPageToken || '';
    if (!page) break;
  }
  uploadsCache.set(channelId, out);
  return out;
}

async function run(body: { fix?: boolean; budget?: number; ids?: string[]; debug?: boolean; all?: boolean }) {
  units = 0;
  const key = (Deno.env.get('YOUTUBE_API_KEY') || '').trim();
  if (!key) return { error: 'YOUTUBE_API_KEY 가 없어요.' };
  const fix = body.fix === true;
  const budget = Math.min(Math.max(Number(body.budget) || 1500, 50), 9000);
  const { data, error } = await db.rpc('songs_with_youtube_upcoming_v2');
  if (error) throw new Error(error.message);
  let songs = (data || []) as Song[];
  if (body.ids?.length) songs = songs.filter((s) => body.ids!.includes(s.id));
  // 운영자가 직접 골라 고정한 영상(youtube_locked)은 건드리지 않아요 (예: 음원이 아직 없어 공식 라이브 클립을 쓴 곡)
  const { data: locked } = await db.from('songs').select('id').eq('youtube_locked', true);
  const lockedIds = new Set((locked || []).map((x: { id: string }) => x.id));
  songs = songs.filter((s) => !lockedIds.has(s.id));
  if (!body.ids?.length && !body.all) songs = songs.filter((s) => !s.youtube_verified_at || Date.parse(s.youtube_verified_at) < Date.now() - 7 * 86400000);
  await details(songs.map((s) => s.youtube_id), key);

  const { data: arts } = await db.from('artists').select('name, youtube_topic_id').not('youtube_topic_id', 'is', null);
  const topicByName = new Map((arts || []).map((a: { name: string; youtube_topic_id: string }) => [a.name, a.youtube_topic_id]));

  const report: unknown[] = [];
  let replaced = 0, cleared = 0, okCount = 0, searches = 0;
  try {
    for (const s of songs) {
      const cur = infoCache.get(s.youtube_id);
      // 꼭 바꿔야 하는 문제(재생 안 됨 · 다른 버전)와 사람이 확인하면 되는 것(제목 표기가 다름 등)을 나눠요
      const fatal = cur === null ? ['삭제됨'] : cur ? [...cur.problems] : [];
      if (cur && BAD.test(cur.title) && !BAD.test(s.title)) fatal.push('다른 버전(라이브 · 어쿠스틱 등)');
      const soft: string[] = [];
      if (cur && !titleOk(cur.title, s)) soft.push('제목 표기 다름');
      if (cur && channelTier(cur.channel, s) === 0) soft.push('비공식 채널');

      // 공식 음원 채널(Topic)의 같은 제목 후보들과 비교 (가짜 앨범 음원 · 한국에서 막힌 음원 걸러내기)
      const cands = [s.youtube_id];
      const topic = !s.original_artist ? topicByName.get(s.artist_name) : undefined;
      if (topic) {
        const ups = await topicUploads(topic, key);
        cands.push(...ups.filter((u) => titleOk(u.title, s)).map((u) => u.videoId));
      }
      await details(cands, key);
      let best = pickBest(cands, s);
      let how = 'topic';
      // 대신할 게 없거나 조회수가 적은 음원뿐이면 검색으로 공식 뮤직비디오 등도 후보에 넣어요 (문제 있는 곡만, 예산 안에서)
      const weak = !best || best.views < 200_000;
      if (fix && (fatal.length || (soft.length && !best)) && weak && units + 100 <= budget) {
        const q = `${s.original_artist || s.artist_name} ${s.alt_title || s.title}`;
        const res = await yt('search', { part: 'snippet', type: 'video', maxResults: '10', regionCode: 'KR', q }, key, 100);
        searches++;
        const ids = (res.items || []).map((it: { id: { videoId?: string } }) => it.id?.videoId).filter(Boolean) as string[];
        await details(ids, key);
        best = pickBest([...cands, ...ids], s); how = 'search';
      }
      const curGood = fatal.length === 0;
      // 바꿀지: 재생이 안 되거나, 제목 · 채널이 의심스러운데 확실한 공식 음원이 있거나, 같은 곡의 훨씬 믿을 만한 공식 음원이 따로 있을 때
      const swap = !!best && best.id !== s.youtube_id && (!curGood || soft.length > 0 || (!!cur && best.views > cur.views * 20 && channelTier(best.channel, s) >= channelTier(cur.channel, s)));
      if (curGood && !swap) {
        okCount++;
        if (fix) await db.from('songs').update({ youtube_verified_at: new Date().toISOString() }).eq('id', s.id);
        if (soft.length || body.debug) report.push({ song: `${s.artist_name} - ${s.title}`, keep: `${cur?.title} · ${cur?.channel}`, note: soft });
        continue;
      }
      const entry: Record<string, unknown> = {
        song: `${s.original_artist || s.artist_name} - ${s.title}`,
        was: cur ? `${cur.title} · ${cur.channel} · ${cur.views}회` : s.youtube_id,
        problems: [...fatal, ...soft].length ? [...fatal, ...soft] : ['더 맞는 공식 음원 있음'],
        now: best ? `${best.title} · ${best.channel} · ${best.views}회 (${how})` : null,
      };
      if (fix) {
        if (best) { await db.from('songs').update({ youtube_id: best.id, youtube_checked_at: new Date().toISOString(), youtube_verified_at: new Date().toISOString() }).eq('id', s.id); replaced++; entry.newId = best.id; }
        else if (!curGood) {
          // 재생이 안 되는 영상은 빼 둬요 (30일 뒤 다시 찾아요) — 플리에 '사용할 수 없는 동영상'으로 숨지 않게
          await db.from('songs').update({ youtube_id: null, youtube_checked_at: new Date().toISOString() }).eq('id', s.id); cleared++;
        }
      }
      report.push(entry);
    }
  } catch (e) {
    if (!/quota/i.test((e as Error).message)) throw e;
    return { stopped: 'quota', units, replaced, cleared, okCount, report };
  }
  return { checked: songs.length, ok: okCount, replaced, cleared, searches, units, report };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST 로 불러 주세요.' }, 405);
  if (!(await isAuthorized(req))) return json({ error: '권한이 없어요.' }, 401);
  try {
    return json(await run(await req.json().catch(() => ({}))));
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
