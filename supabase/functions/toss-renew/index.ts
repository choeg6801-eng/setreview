// 매일 한 번 실행: 이용 기간이 끝나 가는 구독을 자동 결제해요.
// pg_cron 이 x-cron-secret 헤더를 붙여 호출해요 (docs/SETUP.md 참고).
// 배포: supabase functions deploy toss-renew --no-verify-jwt
import { adminClient, json, cors, chargeBilling, newOrderId, addMonth, recordPaid } from '../_shared/billing.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return json({ error: 'forbidden' }, 403);

  const db = adminClient();
  const soon = new Date(Date.now() + 6 * 3600_000).toISOString();
  const { data: due, error } = await db
    .from('subscriptions')
    .select('user_id, customer_key, billing_key, current_period_end')
    .eq('status', 'active')
    .not('billing_key', 'is', null)
    .lte('current_period_end', soon);
  if (error) return json({ error: error.message }, 500);

  const results: { userId: string; ok: boolean; message?: string }[] = [];
  for (const sub of due ?? []) {
    const { data: u } = await db.auth.admin.getUserById(sub.user_id);
    const { data: profile } = await db.from('profiles').select('nickname').eq('id', sub.user_id).maybeSingle();
    const orderId = newOrderId();
    try {
      const paid = await chargeBilling(sub.billing_key, sub.customer_key, orderId, { email: u?.user?.email ?? undefined, name: profile?.nickname ?? undefined });
      await recordPaid(db, sub.user_id, orderId, paid, addMonth(new Date(sub.current_period_end)));
      results.push({ userId: sub.user_id, ok: true });
    } catch (e) {
      await db.from('payments').insert({ user_id: sub.user_id, order_id: orderId, amount: 0, status: 'failed', raw: (e as { raw?: unknown }).raw ?? { message: String(e) } });
      await db.from('subscriptions').update({ status: 'past_due', updated_at: new Date().toISOString() }).eq('user_id', sub.user_id);
      results.push({ userId: sub.user_id, ok: false, message: (e as Error).message });
    }
  }
  return json({ charged: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
});
