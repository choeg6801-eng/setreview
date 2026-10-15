// 토스페이먼츠 자동결제 공통 코드 (Supabase Edge Function, Deno)
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export const PRICE = Number(Deno.env.get('MEMBERSHIP_PRICE') ?? '4900');
export const ORDER_NAME = '셋리뷰 멤버십 1개월';
const TOSS_API = 'https://api.tosspayments.com/v1';

export const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
}

function tossAuth() {
  const secret = Deno.env.get('TOSS_SECRET_KEY');
  if (!secret) throw new Error('TOSS_SECRET_KEY 가 설정되지 않았어요.');
  return 'Basic ' + btoa(secret + ':');
}

async function toss(path: string, body: unknown) {
  const res = await fetch(`${TOSS_API}${path}`, {
    method: 'POST',
    headers: { Authorization: tossAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(65_000), // 자동결제 승인은 최대 60초 걸릴 수 있어요
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.message || `토스페이먼츠 요청 실패 (${res.status})`);
    (err as Error & { code?: string; raw?: unknown }).code = data?.code;
    (err as Error & { code?: string; raw?: unknown }).raw = data;
    throw err;
  }
  return data;
}

export function issueBillingKey(authKey: string, customerKey: string) {
  return toss('/billing/authorizations/issue', { authKey, customerKey });
}

export function newOrderId() {
  return `sr-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

export function chargeBilling(billingKey: string, customerKey: string, orderId: string, customer: { email?: string; name?: string }) {
  return toss(`/billing/${encodeURIComponent(billingKey)}`, {
    customerKey,
    amount: PRICE,
    orderId,
    orderName: ORDER_NAME,
    customerEmail: customer.email || undefined,
    customerName: customer.name || undefined,
  });
}

export function addMonth(from: Date) {
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + 1);
  if (d.getUTCDate() < day) d.setUTCDate(0); // 1월 31일 → 2월 말일
  return d;
}

// 결제 성공 기록 + 이용 기간 연장
export async function recordPaid(db: SupabaseClient, userId: string, orderId: string, raw: unknown, periodEnd: Date) {
  await db.from('payments').insert({ user_id: userId, order_id: orderId, amount: PRICE, status: 'paid', raw });
  await db.from('subscriptions').update({ status: 'active', current_period_end: periodEnd.toISOString(), updated_at: new Date().toISOString() }).eq('user_id', userId);
  await db.from('profiles').update({ membership_until: periodEnd.toISOString() }).eq('id', userId);
}
