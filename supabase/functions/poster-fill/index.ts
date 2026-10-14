// 포스터가 없는 공연에 대표 이미지를 채워요.
// 예매 페이지 → 출처(공지·기사) 페이지 순서로 열어서 og:image / twitter:image 를 찾아 cover_url 에 넣어요.
// 매일 예약 실행(x-sync-secret) 또는 운영자 화면 버튼(로그인 토큰)으로 불러요.
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

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

// <meta property="og:image" content="..."> (속성 순서가 바뀌어 있어도 찾아요)
function findImage(html: string, base: string): string | null {
  const metas = html.match(/<meta\b[^>]*>/gi) || [];
  const wanted = ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src'];
  for (const key of wanted) {
    for (const m of metas) {
      const name = (m.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i) || [])[1]?.toLowerCase();
      if (name !== key) continue;
      const content = (m.match(/\bcontent\s*=\s*["']([^"']+)["']/i) || [])[1];
      if (!content) continue;
      try {
        const url = new URL(decode(content), base);
        if (url.protocol === 'http:') url.protocol = 'https:';
        if (!/\.(svg|ico)(\?|$)/i.test(url.pathname) && !/logo|favicon|default|og_default|share_default/i.test(url.pathname)) return url.toString();
      } catch { /* 잘못된 주소는 건너뛰어요 */ }
    }
  }
  return null;
}

async function imageFor(pageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(pageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SetReviewBot/1.0; +https://setreview.vercel.app)', 'Accept-Language': 'ko,en;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 400_000);
    return findImage(html, res.url || pageUrl);
  } catch {
    return null;
  }
}

async function run(limit: number) {
  const { data: rows, error } = await db.from('events')
    .select('id, title, ticket_url, source_url')
    .is('cover_url', null)
    .gt('ends_at', new Date(Date.now() - 400 * 86400000).toISOString())
    .order('starts_at')
    .limit(limit);
  if (error) throw error;
  const filled: string[] = [];
  const missed: string[] = [];
  let i = 0;
  const list = rows || [];
  await Promise.all(Array.from({ length: Math.min(4, list.length) }, async () => {
    while (i < list.length) {
      const ev = list[i++];
      let img: string | null = null;
      for (const u of [ev.ticket_url, ev.source_url]) {
        if (!img && u && /^https?:\/\//i.test(u)) img = await imageFor(u);
      }
      if (img) {
        await db.from('events').update({ cover_url: img }).eq('id', ev.id).is('cover_url', null);
        filled.push(ev.title);
      } else missed.push(ev.title);
    }
  }));
  return { checked: list.length, filled: filled.length, filledTitles: filled.slice(0, 20), missed: missed.slice(0, 20) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST 로 불러 주세요.' }, 405);
  if (!(await isAuthorized(req))) return json({ error: '권한이 없어요.' }, 401);
  const body = await req.json().catch(() => ({}));
  try {
    return json(await run(Math.min(Number(body?.limit) || 60, 150)));
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
