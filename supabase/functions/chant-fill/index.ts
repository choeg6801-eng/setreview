// 떼창 · 하이라이트 구간을 자동으로 채워요.
// LRCLIB(무료 공개 싱크 가사 DB)의 줄별 시간 정보로 '여러 번 반복되는 후렴'을 찾아 그 시간대를 구간으로 저장해요.
// 가사 본문은 저장하지 않고, 시작 · 끝 시간만 남겨요.
//  - 하이라이트: 첫 번째 후렴
//  - 떼창: 두 번째 이후 후렴(특히 마지막 후렴), 'oh-oh · la-la · 나나' 같은 따라 부르기 쉬운 구간
//  - 떼창 지수(배지)는 매기지 않아요 — 직접 넣은 값이나 현장 제보로만 매겨요
// 예약 실행(x-sync-secret) 또는 운영자 로그인 토큰으로 불러요. 이미 구간이 있는 곡(직접 넣은 것 포함)은 건드리지 않아요.
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

const UA = 'SetReview/1.0 (https://setreview.vercel.app)';
const TIME_BUDGET_MS = 110_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const normTitle = (s: string) => (s || '').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^0-9a-z가-힣ぁ-んァ-ン一-龥]+/g, '');
const normLine = (s: string) => (s || '').toLowerCase().replace(/[^0-9a-z가-힣ぁ-んァ-ン一-龥]+/g, '');
const VOCABLE = /\b(oh+|o+h|whoa+|woah+|ooh+|ah+|la+|na+|yeah+|hey+|ho+|woo+|eh+|ay+)\b|오오|워어|워|라라|나나|예예/i;

type Row = { id: string; title: string; original_artist: string | null; album: string | null; duration_sec: number | null; artist_name: string; artist_ko: string | null };
type LrcResult = { trackName: string; artistName: string; duration: number; syncedLyrics: string | null; instrumental?: boolean };
type Line = { t: number; text: string; key: string };

async function lrclib(path: string, params: Record<string, string>) {
  const res = await fetch(`https://lrclib.net/api/${path}?${new URLSearchParams(params)}`, {
    headers: { 'User-Agent': UA, 'Lrclib-Client': UA }, signal: AbortSignal.timeout(12_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LRCLIB ${res.status}`);
  return await res.json();
}

async function findLyrics(r: Row): Promise<LrcResult | null> {
  // 영문 · 한글 이름을 번갈아 시도해요 (예: Jaurim / 자우림)
  const names = [...new Set([r.original_artist || r.artist_name, ...(r.original_artist ? [] : [r.artist_ko || ''])].filter(Boolean))];
  const t = normTitle(r.title);
  const okDur = (x: LrcResult) => !r.duration_sec || Math.abs(x.duration - r.duration_sec) <= 6;
  for (const artist of names) {
    const params: Record<string, string> = { artist_name: artist, track_name: r.title };
    if (r.duration_sec) params.duration = String(r.duration_sec);
    const exact = await lrclib('get', params).catch(() => null) as LrcResult | null;
    if (exact?.syncedLyrics) return exact;
    const list = (await lrclib('search', { artist_name: artist, track_name: r.title }).catch(() => [])) as LrcResult[] | null;
    const ok = (list || []).filter((x) => x.syncedLyrics && normTitle(x.trackName).startsWith(t.slice(0, 8)) && okDur(x));
    if (ok[0]) return ok[0];
  }
  // 마지막으로 제목만으로 검색해서 가수 이름이 맞는 것
  const keys = names.map(normTitle).filter((k) => k.length >= 2);
  const list = (await lrclib('search', { q: r.title }).catch(() => [])) as LrcResult[] | null;
  const ok = (list || []).filter((x) => x.syncedLyrics && normTitle(x.trackName).startsWith(t.slice(0, 8)) && okDur(x)
    && keys.some((k) => normTitle(x.artistName).includes(k) || k.includes(normTitle(x.artistName))));
  return ok[0] || null;
}

function parse(lrc: string): Line[] {
  const out: Line[] = [];
  for (const raw of lrc.split('\n')) {
    const m = raw.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
    if (!m) continue;
    const t = Number(m[1]) * 60 + Number(m[2]);
    out.push({ t, text: m[3], key: normLine(m[3]) });
  }
  return out.sort((a, b) => a.t - b.t);
}

type Seg = { start: number; end: number; lines: Set<string>; vocal: boolean };

// 여러 번 나오는 줄이 이어진 덩어리 = 후렴 후보
function chorusBlocks(lines: Line[], songEnd: number): Seg[] {
  const freq = new Map<string, number>();
  for (const l of lines) if (l.key.length >= 2) freq.set(l.key, (freq.get(l.key) || 0) + 1);
  const rep = (l: Line) => l.key.length >= 2 && (freq.get(l.key) || 0) >= 2;
  const blocks: Seg[] = [];
  let cur: Seg | null = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const next = lines[i + 1]?.t ?? Math.min(l.t + 5, songEnd);
    if (rep(l) && (!cur || l.t - cur.end <= 6)) {
      if (!cur) cur = { start: l.t, end: next, lines: new Set(), vocal: false };
      cur.end = next; cur.lines.add(l.key); if (VOCABLE.test(l.text)) cur.vocal = true;
    } else {
      if (cur) blocks.push(cur);
      cur = rep(l) ? { start: l.t, end: next, lines: new Set([l.key]), vocal: VOCABLE.test(l.text) } : null;
    }
  }
  if (cur) blocks.push(cur);
  return blocks.filter((b) => b.lines.size >= 2 && b.end - b.start >= 8 && b.end - b.start <= 75);
}

const jaccard = (a: Set<string>, b: Set<string>) => {
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter || 1);
};

function analyse(lines: Line[], songEnd: number) {
  const blocks = chorusBlocks(lines, songEnd);
  if (!blocks.length) return [];
  // 비슷한 덩어리끼리 묶어서 가장 많이 반복되는 것 = 후렴
  const groups: Seg[][] = [];
  for (const b of blocks) {
    const g = groups.find((gr) => jaccard(gr[0].lines, b.lines) >= 0.4);
    g ? g.push(b) : groups.push([b]);
  }
  groups.sort((a, b) => b.length * b[0].lines.size - a.length * a[0].lines.size);
  const chorus = groups[0];
  if (chorus.length < 2) return [];
  const segs: { kind: string; label: string; start_sec: number; end_sec: number; score: null }[] = [];
  const r = (x: number) => Math.max(0, Math.round(x));
  segs.push({ kind: 'highlight', label: '첫 후렴', start_sec: r(chorus[0].start), end_sec: r(chorus[0].end), score: null });
  chorus.slice(1).forEach((c, i, arr) => {
    const last = i === arr.length - 1;
    segs.push({ kind: 'chant', label: last ? '마지막 후렴 · 다 같이' : '후렴 떼창', start_sec: r(c.start), end_sec: r(c.end), score: null });
  });
  // 후렴 밖의 'oh-oh' 같은 따라 부르기 구간도 따로
  for (const g of groups.slice(1)) {
    if (g.length >= 2 && g.some((c) => c.vocal)) {
      const c = g[g.length - 1];
      if (!segs.some((s) => Math.abs(s.start_sec - c.start) < 4)) {
        segs.push({ kind: 'chant', label: '따라 부르기 (oh · la)', start_sec: r(c.start), end_sec: r(c.end), score: null });
      }
      break;
    }
  }
  return segs.filter((s) => s.end_sec > s.start_sec);
}

async function run(limit: number) {
  const started = Date.now();
  const { data, error } = await db.rpc('songs_needing_chant_v2', { p_limit: limit });
  if (error) throw new Error(error.message);
  const rows = (data || []) as Row[];
  let filled = 0;
  const missed: string[] = [];
  for (const r of rows) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    let segs: ReturnType<typeof analyse> = [];
    try {
      const lr = await findLyrics(r);
      if (lr?.syncedLyrics && !lr.instrumental) {
        const songEnd = lr.duration || r.duration_sec || 600;
        segs = analyse(parse(lr.syncedLyrics), songEnd);
      }
    } catch (e) {
      missed.push(`${r.artist_name} - ${r.title}: ${(e as Error).message}`);
      await sleep(1500);
      continue; // 일시 오류는 다음에 다시
    }
    if (segs.length) {
      // 자동으로 찾은 건 '어디가 후렴인지'만 믿을 수 있어요. 떼창 지수(배지)는 직접 넣은 값이나 현장 제보로만 매겨요.
      const { error: insErr } = await db.from('song_segments').insert(segs.map((s) => ({ ...s, score: null, song_id: r.id, source: 'auto' })));
      if (insErr) missed.push(`${r.title}: ${insErr.message}`); else filled++;
    } else {
      missed.push(`${r.artist_name} - ${r.title}`);
    }
    await db.from('songs').update({ lyrics_checked_at: new Date().toISOString() }).eq('id', r.id);
    await sleep(250);
  }
  return { checked: rows.length, filled, seconds: Math.round((Date.now() - started) / 1000), missed: missed.slice(0, 15) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST 로 불러 주세요.' }, 405);
  if (!(await isAuthorized(req))) return json({ error: '권한이 없어요.' }, 401);
  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body?.limit) || 60, 1), 200);
    return json(await run(limit));
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
