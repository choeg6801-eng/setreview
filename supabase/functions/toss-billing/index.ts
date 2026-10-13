// 멤버십 시작·해지 (로그인한 사용자가 웹앱에서 호출)
//   action: 'prepare' → 카드 등록창에 쓸 customerKey 발급
//   action: 'confirm' → 카드 등록 후 빌링키 발급 + 첫 달 결제
//   action: 'cancel'  → 다음 결제부터 자동결제 중단
import { adminClient, json, cors, issueBillingKey, chargeBilling, newOrderId, addMonth, recordPaid } from '../_shared/billing.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST 만 지원해요.' }, 405);

  const db = adminClient();
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return json({ error: '로그인이 필요해요.' }, 401);

  let body: { action?: string; authKey?: string; customerKey?: string } = {};
  try { body = await req.json(); } catch { /* 빈 요청 */ }

  const { data: sub } = await db.from('subscriptions').select('*').eq('user_id', user.id).maybeSingle();
  const { data: profile } = await db.from('profiles').select('nickname').eq('id', user.id).maybeSingle();
  const customer = { email: user.email ?? undefined, name: profile?.nickname ?? undefined };

  try {
    if (body.action === 'prepare') {
      if (sub) return json({ customerKey: sub.customer_key });
      const customerKey = `sr_${crypto.randomUUID()}`;
      const { error } = await db.from('subscriptions').insert({ user_id: user.id, customer_key: customerKey, status: 'pending' });
      if (error) throw error;
      return json({ customerKey });
    }

    if (body.action === 'confirm') {
      if (!body.authKey || !body.customerKey) return json({ error: '결제 정보가 없어요.' }, 400);
      if (!sub || sub.customer_key !== body.customerKey) return json({ error: '결제 정보가 일치하지 않아요.' }, 403);

      const issued = await issueBillingKey(body.authKey, body.customerKey);
      await db.from('subscriptions').update({ billing_key: issued.billingKey, updated_at: new Date().toISOString() }).eq('user_id', user.id);

      // 아직 남은 이용 기간이 있으면 그 뒤로 이어 붙여요
      const now = new Date();
      const base = sub.current_period_end && new Date(sub.current_period_end) > now ? new Date(sub.current_period_end) : now;
      const orderId = newOrderId();
      try {
        const paid = await chargeBilling(issued.billingKey, body.customerKey, orderId, customer);
        const end = addMonth(base);
        await recordPaid(db, user.id, orderId, paid, end);
        return json({ ok: true, membershipUntil: end.toISOString() });
      } catch (e) {
        await db.from('payments').insert({ user_id: user.id, order_id: orderId, amount: 0, status: 'failed', raw: (e as { raw?: unknown }).raw ?? { message: String(e) } });
        return json({ error: `결제에 실패했어요: ${(e as Error).message}` }, 402);
      }
    }

    if (body.action === 'cancel') {
      if (!sub) return json({ error: '이용 중인 멤버십이 없어요.' }, 404);
      await db.from('subscriptions').update({ status: 'canceled', updated_at: new Date().toISOString() }).eq('user_id', user.id);
      return json({ ok: true });
    }

    return json({ error: '알 수 없는 요청이에요.' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message || '서버 오류가 났어요.' }, 500);
  }
});
