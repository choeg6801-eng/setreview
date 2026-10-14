// KOPIS(공연예술통합전산망) 오픈API로 국내 페스티벌 · 해외 아티스트 내한 공연 일정을 가져와요.
// - 매일 pg_cron 이 x-sync-secret 헤더로 부르고, 운영자 화면의 "지금 가져오기" 버튼은 로그인 토큰으로 불러요.
// - 필요한 비밀값: KOPIS_API_KEY (Supabase → Edge Functions → Secrets)
import { createClient } from 'jsr:@supabase/supabase-js@2';

const KOPIS = 'https://www.kopis.or.kr/openApi/restful';
const GENRE_POP = 'CCCD';          // 대중음악
const MONTHS_AHEAD = 12;           // 오늘부터 1년 치 (티켓팅이 일찍 열리는 공연까지)
const MAX_DETAIL_CALLS = 150;      // 한 번에 새로 확인할 공연 수 (나머지는 다음 실행 때)
const CONCURRENCY = 3;

async function pool<T>(items: T[], fn: (it: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

// ---------- 아주 단순한 XML 읽기 (KOPIS 응답은 평평한 구조예요) ----------
const decode = (s: string) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
  .trim();
const blocks = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]);
const field = (xml: string, tag: string) => {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? decode(m[1]) : '';
};

async function kopis(path: string, params: Record<string, string>) {
  const key = (Deno.env.get('KOPIS_API_KEY') || '').trim().replace(/^["']|["']$/g, '');
  if (!key) throw new Error('KOPIS_API_KEY 가 설정되지 않았어요.');
  const qs = new URLSearchParams({ service: key, ...params });
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(`${KOPIS}/${path}?${qs}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SetReview/1.0; +https://setreview.vercel.app)', Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8' },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status !== 400 && res.status !== 429 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); // 잠깐 쉬었다가 다시 시도
  }
  res = res!;
  const text = await res.text();
  // 오류도 <db> 안에 <returncode>·<errmsg> 로 와요 (예: 등록되지 않은 키)
  const errmsg = field(text, 'errmsg');
  const code = field(text, 'returncode');
  if (!res.ok || errmsg || (code && code !== '00')) {
    // 키 값은 남기지 않고 길이와 형식만 알려 줘요 (KOPIS 키는 보통 영문·숫자 32자)
    const hint = ` (입력된 키: ${key.length}자${/^[0-9a-z]+$/i.test(key) ? '' : ', 영문·숫자 외 문자 포함'})`;
    throw new Error(`KOPIS ${path} 오류${res.ok ? '' : ` ${res.status}`}: ${errmsg || code || text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)}${hint}`);
  }
  return text;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
function windows() {
  // KOPIS 목록 조회는 한 번에 31일까지만 돼요
  const out: [string, string][] = [];
  const start = new Date(Date.now() - 7 * 86400000);
  for (let i = 0; i < MONTHS_AHEAD; i++) {
    const a = new Date(start.getTime() + i * 31 * 86400000);
    const b = new Date(a.getTime() + 30 * 86400000);
    out.push([ymd(a), ymd(b)]);
  }
  return out;
}

type Item = { id: string; title: string; from: string; to: string; venue: string; poster: string; area: string; genre: string };

async function listAll(path: string) {
  const items = new Map<string, Item>();
  // 31일 구간 12개를 2개씩 동시에 조회해요 (실행 시간 제한 150초 안에 끝내려고)
  let w = 0;
  const wins = windows();
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (w < wins.length) {
      const [st, ed] = wins[w++];
      for (let page = 1; page <= 30; page++) {
        const xml = await kopis(path, { stdate: st, eddate: ed, cpage: String(page), rows: '100', shcate: GENRE_POP });
        const rows = blocks(xml, 'db');
        for (const r of rows) {
          const id = field(r, 'mt20id');
          if (!id) continue;
          items.set(id, {
            id, title: field(r, 'prfnm'), from: field(r, 'prfpdfrom'), to: field(r, 'prfpdto'),
            venue: field(r, 'fcltynm'), poster: field(r, 'poster'), area: field(r, 'area'), genre: field(r, 'genrenm'),
          });
        }
        if (rows.length < 100) break;
      }
    }
  }));
  return items;
}

// ---------- 분류 ----------
const FEST_RE = /페스티벌|festival|페스타|fest\b|뮤직\s*페스|록\s*페|락\s*페|썸머\s*소닉|summer\s*sonic|워터밤|waterbomb|펜타포트|pentaport/i;
const VISIT_RE = /내한|live\s+in\s+(seoul|korea|busan|incheon)|in\s+seoul|in\s+korea|asia\s+tour|world\s+tour|\btour\b/i;
const LATIN_RE = /^[\x20-\x7E·:–—'’"“”()\[\]&!?.,\-]+$/;
const SKIP_RE = /패키지|package|숙박|호텔|투어\s*상품/i;
const dayOf = (dot: string) => Date.parse(dot.replace(/\./g, '-'));
// 패키지 상품이나 기간이 비정상적으로 긴(120일 넘는) 등록은 빼요
const isJunk = (it: Item) => SKIP_RE.test(it.title) || (it.to && dayOf(it.to) - dayOf(it.from) > 120 * 86400000);
const isCandidate = (it: Item, fest: Set<string>) =>
  !isJunk(it) && (fest.has(it.id) || FEST_RE.test(it.title) || VISIT_RE.test(it.title) || LATIN_RE.test(it.title));
const normName = (s: string) => (s || '').toLowerCase().replace(/[^0-9a-z가-힣]/g, '');

function classify(it: Item, d: Record<string, string>, fest: Set<string>) {
  const flagFest = (d.festival || '').toUpperCase() === 'Y';
  const flagVisit = (d.visit || '').toUpperCase() === 'Y';
  const hasVisitFlag = 'visit' in d && d.visit !== '';
  const festival = flagFest || fest.has(it.id) || FEST_RE.test(it.title);
  const visit = flagVisit || /내한/.test(it.title) || (!hasVisitFlag && VISIT_RE.test(it.title) && LATIN_RE.test(it.title.replace(/[가-힣]/g, '')));
  return { festival, visit };
}

// 제목으로 짐작하는 장르 (운영자 화면에서 고칠 수 있어요)
const GENRE_RULES: [string, RegExp][] = [
  ['록', /록\s*(페스|콘서트|밴드|공연|뮤직)|락\s*(페스|콘서트)|rock|펜타포트|pentaport/i],
  ['재즈', /재즈|jazz/i],
  ['힙합', /힙합|hip\s*-?hop|\brap\b|랩\s*공연/i],
  ['일렉트로닉', /\bedm\b|일렉트로닉|electronic|테크노|techno|하우스\s*뮤직|울트라|ultra\s*korea|월드\s*디제이|워터밤|waterbomb/i],
  ['인디', /인디|indie/i],
  ['K-pop', /k-?pop|케이팝|아이돌/i],
  ['메탈', /메탈|metal/i],
  ['R&B', /r&b|알앤비|소울|\bsoul\b/i],
  ['포크·어쿠스틱', /포크|folk|어쿠스틱|acoustic/i],
  ['J-pop', /j-?pop|제이팝/i],
  ['발라드', /발라드|ballad/i],
];
const guessGenres = (text: string) => GENRE_RULES.filter(([, re]) => re.test(text)).map(([g]) => g);

const CITY: Record<string, string> = {
  서울특별시: '서울', 부산광역시: '부산', 대구광역시: '대구', 인천광역시: '인천', 광주광역시: '광주', 대전광역시: '대전',
  울산광역시: '울산', 세종특별자치시: '세종', 경기도: '경기', 강원도: '강원', 강원특별자치도: '강원', 충청북도: '충북',
  충청남도: '충남', 전라북도: '전북', 전북특별자치도: '전북', 전라남도: '전남', 경상북도: '경북', 경상남도: '경남', 제주특별자치도: '제주',
};
const toIso = (dot: string, hm: string) => `${dot.replace(/\./g, '-')}T${hm}:00+09:00`;
const https = (u: string) => (u || '').replace(/^http:\/\//i, 'https://');

async function detail(id: string) {
  const xml = await kopis(`pblprfr/${id}`, {});
  const d: Record<string, string> = {};
  for (const tag of ['prfcast', 'prfruntime', 'dtguidance', 'pcseguidance', 'visit', 'festival', 'entrpsnm']) {
    if (xml.includes(`<${tag}>`) || xml.includes(`<${tag}/>`)) d[tag] = field(xml, tag);
  }
  const relates = blocks(xml, 'relate').map((r) => ({ name: field(r, 'relatenm'), url: field(r, 'relateurl') })).filter((r) => r.url);
  d.ticket = relates[0]?.url || '';
  return d;
}

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

async function sync() {
  const started = Date.now();
  // 공연 목록과 축제 목록을 함께 조회 (축제 목록은 계정에 따라 안 열려 있을 수 있어서 실패해도 계속 진행해요)
  // 한꺼번에 많이 요청하면 KOPIS 가 막아서, 공연 목록 → 축제 목록 순서로 차례차례 불러요
  const list = await listAll('pblprfr');
  const fest = await listAll('prffest').then((m) => new Set(m.keys())).catch(() => new Set<string>());

  const { data: existingRows } = await db.from('events').select('id, external_id').eq('source', 'kopis');
  const existing = new Map((existingRows || []).map((r) => [r.external_id as string, r.id as string]));
  // 소식 수집·제보·직접 등록으로 이미 있는 공연(같은 날, 같은 공연장)은 KOPIS 에서 또 넣지 않아요
  const { data: otherRows } = await db.from('events').select('starts_at, venue').neq('source', 'kopis').gte('ends_at', new Date(Date.now() - 7 * 86400000).toISOString());
  const kstDate = (iso: string) => new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(0, 10);
  // 공연장 이름은 "킨텍스" / "킨텍스 제1전시장 4·5홀"처럼 표기가 달라서, 한쪽이 다른 쪽으로 시작하면 같은 곳으로 봐요
  const others = (otherRows || []).map((r) => ({ d: kstDate(r.starts_at as string), v: normName(r.venue as string) }));
  const sameVenue = (a: string, b: string) => Math.min(a.length, b.length) >= 2 && (a.startsWith(b) || b.startsWith(a) || a.slice(0, 4) === b.slice(0, 4));
  const isDupOfOther = (it: Item) => {
    const d = it.from.replace(/\./g, '-'), v = normName(it.venue);
    return others.some((o) => o.d === d && sameVenue(o.v, v));
  };

  // 이미 확인해서 제외한 공연은 30일 동안 다시 확인하지 않아요
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: seenRows } = await db.from('kopis_seen').select('external_id').gte('checked_at', since);
  const seen = new Set((seenRows || []).map((r) => r.external_id as string));

  const candidates = [...list.values()].filter((it) => existing.has(it.id) || isCandidate(it, fest));
  const fresh = candidates.filter((it) => !existing.has(it.id) && !seen.has(it.id));
  const known = candidates.filter((it) => existing.has(it.id));

  // 이미 있는 공연: 날짜·장소·포스터만 갱신 (운영자가 고친 제목·설명·공개 여부는 그대로)
  let updated = 0;
  await pool(known, async (it) => {
    const { error } = await db.from('events').update({
      venue: it.venue || null,
      starts_at: toIso(it.from, '18:00'),
      ends_at: toIso(it.to || it.from, '23:00'),
      cover_url: https(it.poster) || null,
      updated_at: new Date().toISOString(),
    }).eq('source', 'kopis').eq('external_id', it.id);
    if (!error) updated++;
  });

  // 새 공연: 상세 정보를 확인해서 페스티벌·내한만 넣어요
  let inserted = 0, skipped = 0;
  const errors: string[] = [];
  const batch = fresh.slice(0, MAX_DETAIL_CALLS);
  const deferred = fresh.length - batch.length;
  await pool(batch, async (it) => {
    try {
      if (isDupOfOther(it)) {
        skipped++;
        await db.from('kopis_seen').upsert({ external_id: it.id, checked_at: new Date().toISOString() });
        return;
      }
      const d = await detail(it.id);
      const { festival, visit } = classify(it, d, fest);
      if (!festival && !visit) {
        skipped++;
        await db.from('kopis_seen').upsert({ external_id: it.id, checked_at: new Date().toISOString() });
        return;
      }
      const desc = [d.prfcast && `출연: ${d.prfcast}`, d.dtguidance && `공연 시간: ${d.dtguidance}`, d.pcseguidance && `가격: ${d.pcseguidance}`, '공연 정보 출처: KOPIS(공연예술통합전산망)']
        .filter(Boolean).join('\n').slice(0, 1500);
      const { error } = await db.from('events').insert({
        slug: `k-${it.id.toLowerCase()}`,
        title: it.title.slice(0, 120),
        kind: festival ? 'festival' : 'concert',
        is_visit: visit,
        venue: it.venue || null,
        city: CITY[it.area] || it.area?.slice(0, 2) || null,
        starts_at: toIso(it.from, '18:00'),
        ends_at: toIso(it.to || it.from, '23:00'),
        cover_url: https(it.poster) || null,
        ticket_url: d.ticket || null,
        description: desc,
        lineup: (d.prfcast || '').slice(0, 1000) || null,
        genres: guessGenres(`${it.title} ${d.prfcast || ''}`),
        source: 'kopis',
        external_id: it.id,
        published: true,
      });
      if (error) errors.push(`${it.id}: ${error.message}`); else inserted++;
    } catch (e) {
      errors.push(`${it.id}: ${(e as Error).message}`);
    }
  });

  const summary = {
    at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000),
    listed: list.size, candidates: candidates.length, inserted, updated, skipped, deferred, errors: errors.slice(0, 10),
  };
  await db.from('app_settings').upsert({ key: 'kopis_last_sync', value: summary });
  return summary;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST 로 불러 주세요.' }, 405);
  if (!(await isAuthorized(req))) return json({ error: '권한이 없어요.' }, 401);
  try {
    return json(await sync());
  } catch (e) {
    const msg = (e as Error).message;
    await db.from('app_settings').upsert({ key: 'kopis_last_sync', value: { at: new Date().toISOString(), error: msg } });
    return json({ error: msg }, 500);
  }
});
