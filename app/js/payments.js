// 토스페이먼츠 자동결제(빌링) — 카드 등록창을 열고, 돌아오면 Edge Function 으로 결제를 확정해요.
// 카드 정보와 빌링키는 브라우저에 남지 않아요 (빌링키는 서버의 subscriptions 테이블에만 저장).
import { config } from './config.js';
import { UserError } from './util.js';

const SDK_URL = 'https://js.tosspayments.com/v2/standard';

export const paymentsEnabled = () => !!config.tossClientKey;

function loadSdk() {
  return new Promise((resolve, reject) => {
    if (window.TossPayments) return resolve(window.TossPayments);
    const s = document.createElement('script');
    s.src = SDK_URL;
    s.onload = () => resolve(window.TossPayments);
    s.onerror = () => reject(new UserError('결제 모듈을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'));
    document.head.appendChild(s);
  });
}

export async function startBilling(api, session) {
  if (!paymentsEnabled()) throw new UserError('결제가 아직 준비되지 않았어요.');
  const { customerKey } = await api.invoke('toss-billing', { action: 'prepare' });
  const TossPayments = await loadSdk();
  const payment = TossPayments(config.tossClientKey).payment({ customerKey });
  await payment.requestBillingAuth({
    method: 'CARD',
    successUrl: `${location.origin}/app/?toss=success`,
    failUrl: `${location.origin}/app/?toss=fail`,
    customerEmail: session.email || undefined,
    customerName: session.nickname || undefined,
  });
}

// 결제창에서 돌아온 정보 (main.js 가 sessionStorage 에 담아 둬요)
export function takeTossReturn() {
  const raw = sessionStorage.getItem('sr-toss-return');
  sessionStorage.removeItem('sr-toss-return');
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export async function confirmBilling(api, ret) {
  return api.invoke('toss-billing', { action: 'confirm', authKey: ret.authKey, customerKey: ret.customerKey });
}
