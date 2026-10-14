// 맞춤 공연 이메일 알림
// - mode "instant": 좋아하는 아티스트 공연이 새로 생기면 (매일 오전 6시)
// - mode "digest" : 이번 주 취향 공연 모아 보기 (매주 월요일 오전 9시)
// - mode "ticket" : 티켓 오픈 하루 전 · 1시간 전 (매시간)
// 필요한 비밀값: RESEND_API_KEY, MAIL_FROM (예: 셋리뷰 <alert@내도메인>), SITE_URL (예: https://setreview.vercel.app)
// 비밀값이 없으면 메일을 보내지 않고 기다려요 (알림은 앱 안 알림함에는 그대로 쌓여요).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const SITE = (Deno.env.get('SITE_URL') || 'https://setreview.vercel.app').replace(/\/$/, '');
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const kdate = (iso: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(iso));

type Row = { id: string; user_id: string; kind: string; reason: string | null; events: { slug: string; title: string; starts_at: string; venue: string | null; city: string | null; cover_url: string | null } };

function mail(nickname: string, heading: string, intro: string, rows: Row[]) {
  const items = rows.map((r) => {
    const e = r.events;
    const url = `${SITE}/app/#/e/${encodeURIComponent(e.slug)}`;
    return `<tr><td style="padding:12px 0;border-bottom:1px solid #262B66">
      <div style="font-size:12px;color:#FF8A3D;margin-bottom:4px">${esc(r.reason || '')}</div>
      <a href="${url}" style="color:#EEEDFB;font-size:16px;font-weight:700;text-decoration:none">${esc(e.title)}</a>
      <div style="color:#B9B8E0;font-size:13px;margin-top:4px">${esc(kdate(e.starts_at))} · ${esc([e.city, e.venue].filter(Boolean).join(' '))}</div>
    </td></tr>`;
  }).join('');
  return `<div style="background:#0A0C24;padding:28px 14px;font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#12163C;border-radius:16px;padding:26px;color:#EEEDFB">
    <p style="margin:0 0 6px;color:#FF8A3D;font-style:italic">for ${esc(nickname)}</p>
    <h1 style="margin:0 0 10px;font-size:21px">${esc(heading)}</h1>
    <p style="margin:0 0 14px;color:#B9B8E0;line-height:1.6">${esc(intro)}</p>
    <table role="presentation" width="100%" style="border-collapse:collapse">${items}</table>
    <p style="margin:22px 0 0"><a href="${SITE}/app/#/inbox" style="display:inline-block;background:#FF6A1F;color:#0A0C24;font-weight:700;text-decoration:none;padding:11px 20px;border-radius:999px">알림함에서 모두 보기</a></p>
    <p style="margin:22px 0 0;color:#8C8BC4;font-size:12px;line-height:1.6">셋리뷰에서 취향을 등록해서 받는 알림이에요. 받고 싶지 않으면 <a href="${SITE}/app/#/taste" style="color:#B9B8E0">내 취향 → 알림 설정</a>에서 끌 수 있어요.</p>
  </div></div>`;
}

async function send(to: string, subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: Deno.env.get('MAIL_FROM'), to: [to], subject, html }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`메일 발송 실패 (${res.status}): ${(await res.text()).slice(0, 200)}`);
}

async function run(mode: 'instant' | 'digest' | 'ticket') {
  if (!Deno.env.get('RESEND_API_KEY') || !Deno.env.get('MAIL_FROM')) {
    return { mode, waiting: true, message: 'RESEND_API_KEY · MAIL_FROM 이 없어서 메일은 보내지 않았어요. 알림함에는 쌓여 있어요.' };
  }
  const since = new Date(Date.now() - (mode === 'instant' ? 2 : 7) * 86400000).toISOString();
  let q = db.from('notifications')
    .select('id, user_id, kind, reason, events!inner(slug, title, starts_at, venue, city, cover_url, published)')
    .gte('created_at', since)
    .eq('events.published', true)
    .gt('events.starts_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(2000);
  // 주간 모음에는 이미 바로 메일로 받은 소식과 티켓 알림은 빼요
  q = mode === 'instant' ? q.eq('kind', 'artist').is('emailed_at', null)
    : mode === 'ticket' ? q.in('kind', ['ticket_d1', 'ticket_h1']).is('emailed_at', null)
    : q.in('kind', ['artist', 'genre']).is('digested_at', null).is('emailed_at', null);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data || []) as unknown as Row[];

  const byUser = new Map<string, Row[]>();
  for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) || []), r]);

  let sent = 0;
  const errors: string[] = [];
  for (const [userId, list] of byUser) {
    try {
      const { data: prof } = await db.from('profiles').select('nickname, email_alerts, weekly_digest').eq('id', userId).maybeSingle();
      const wants = mode === 'digest' ? prof?.weekly_digest : prof?.email_alerts;
      const col = mode === 'digest' ? 'digested_at' : 'emailed_at';
      const ids = list.map((r) => r.id);
      if (wants) {
        const { data: u } = await db.auth.admin.getUserById(userId);
        const to = u?.user?.email;
        if (to) {
          const nick = prof?.nickname || '덕후';
          const top = list.slice(0, 12);
          const subject = mode === 'instant'
            ? `[셋리뷰] ${top[0].reason?.replace(/ 출연$/, '') || '좋아하는 아티스트'} 공연 소식${list.length > 1 ? ` 외 ${list.length - 1}건` : ''}`
            : mode === 'ticket'
            ? `[셋리뷰] ${top[0].kind === 'ticket_h1' ? '곧 티켓 오픈' : '티켓 오픈 예정'} · ${top[0].events.title}${list.length > 1 ? ` 외 ${list.length - 1}건` : ''}`
            : `[셋리뷰] 이번 주 내 취향 공연 ${list.length}건`;
          const html = mode === 'instant'
            ? mail(nick, '좋아하는 아티스트의 공연이 올라왔어요', '티켓팅 일정은 예매처에서 꼭 확인해 주세요.', top)
            : mode === 'ticket'
            ? mail(nick, '곧 티켓이 열려요', '예매처에 미리 로그인해 두고, 결제 수단도 확인해 두세요. 정확한 오픈 시간은 예매처 공지를 꼭 다시 확인해 주세요.', top)
            : mail(nick, '이번 주 내 취향 공연', '좋아하는 아티스트와 장르에 맞는 새 공연을 모았어요.', top);
          await send(to, subject, html);
          sent++;
        }
      }
      // 보낸 것은 다시 보내지 않도록 표시. 바로 알림을 끈 사람은 주간 모음으로 넘겨요
      if (wants || mode !== 'instant') await db.from('notifications').update({ [col]: new Date().toISOString() }).in('id', ids);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { mode, users: byUser.size, sent, errors: errors.slice(0, 5) };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST 로 불러 주세요.' }, 405);
  const secret = req.headers.get('x-sync-secret') || '';
  const { data: ok } = await db.rpc('verify_sync_secret', { p: secret });
  if (ok !== true) return json({ error: '권한이 없어요.' }, 401);
  const body = await req.json().catch(() => ({}));
  const mode = body?.mode === 'digest' ? 'digest' : body?.mode === 'ticket' ? 'ticket' : 'instant';
  try {
    return json(await run(mode));
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
