// 멤버십 (월 4,900원 · 가격은 app/config.js 의 membershipPrice)
import { html, toast, fmtDate, won } from '../util.js';
import { icon } from '../icons.js';
import { config, isDemo } from '../config.js';
import { isMemberActive } from '../api/shape.js';
import { navigate } from '../router.js';
import { paymentsEnabled, startBilling, takeTossReturn, confirmBilling } from '../payments.js';
import { footer } from './footer.js';

const FEATURES = [
  ['예상 셋리스트 전곡 · 앙코르 순서', '무료는 앞 5곡'],
  ['곡마다 하이라이트·떼창 구간과 떼창 지수', ''],
  ['예습 플리 한 번에 듣기 (유튜브 · 다른 음악 앱으로 옮기기 · Spotify)', ''],
  ['내 공연 무제한 담기', '무료는 1개'],
  ['공연 중 실시간 셋리스트 · 복습 카드', '무료도 볼 수 있어요'],
];

export default async function membership(ctx) {
  const { api, state } = ctx;
  const s = state.session;
  const status = s ? await api.membershipStatus() : null;
  const active = isMemberActive(s);
  const price = config.membershipPrice;
  const free = state.settings.freeBeta;

  let cta;
  if (!s) {
    cta = html`<a class="btn btn-primary btn-block" href="#/login" data-action="login">로그인하고 시작하기</a>`;
  } else if (active) {
    cta = html`<div class="stack" style="gap:8px">
      <div class="notice">멤버십 이용 중이에요 · ${fmtDate(s.membershipUntil, { weekday: undefined, year: 'numeric' })}까지${status?.status === 'canceled' ? ' (해지 예약됨)' : ' · 다음 결제일에 자동 연장'}</div>
      ${status?.status !== 'canceled' ? html`<button type="button" class="btn btn-ghost btn-block" data-action="cancel">멤버십 해지 예약</button>` : ''}
    </div>`;
  } else if (isDemo) {
    cta = html`<button type="button" class="btn btn-primary btn-block" data-action="demo-start">데모 결제로 시작하기 (실제 결제 없음)</button>`;
  } else if (paymentsEnabled()) {
    cta = html`<button type="button" class="btn btn-primary btn-block" data-action="start">카드 등록하고 시작하기</button>
      <p class="faint small">토스페이먼츠로 안전하게 결제돼요. 매월 같은 날 ${won(price)}이 자동 결제되고, 언제든 해지할 수 있어요.</p>`;
  } else {
    cta = html`<div class="notice notice-warn">결제는 정식 출시 때 열려요. 지금은 출시 알림을 신청해 주세요.</div>`;
  }

  return {
    title: '멤버십',
    html: html`<div class="container narrow">
      <section class="section stack" style="gap:20px">
        <div class="stack" style="gap:6px">
          <span class="serif-kicker">one simple plan</span>
          <h1 style="font-size:clamp(28px,4vw,40px);font-weight:900">한 시즌의 모든 공연,<br>하나의 요금제로.</h1>
        </div>
        ${free ? html`<div class="notice">지금은 <strong>무료 베타 기간</strong>이라 모든 멤버십 기능이 열려 있어요.</div>` : ''}
        <div class="plan">
          <div class="row between">
            <strong style="font-size:20px">셋리뷰 멤버십</strong>
            <div class="plan-price"><strong>${new Intl.NumberFormat('ko-KR').format(price)}</strong><span class="muted">원 / 월</span></div>
          </div>
          <ul class="feature-list">
            ${FEATURES.map(([f, note]) => html`<li>${icon('check', 18)}<span>${f}${note ? html` <span class="faint small">· ${note}</span>` : ''}</span></li>`)}
          </ul>
          ${cta}
        </div>
        <div class="table-wrap">
          <table class="compare">
            <thead><tr><th scope="col">기능</th><th scope="col">무료</th><th scope="col">멤버십</th></tr></thead>
            <tbody>
              <tr><td>예상 셋리스트</td><td>앞 5곡</td><td>전곡</td></tr>
              <tr><td>실시간 셋리스트 · 현장 제보</td><td>${icon('check', 18, '가능')}</td><td>${icon('check', 18, '가능')}</td></tr>
              <tr><td>내 공연 담기</td><td>1개</td><td>무제한</td></tr>
              <tr><td>하이라이트 · 떼창 구간과 지수</td><td>${icon('lock', 16, '잠김')}</td><td>${icon('check', 18, '가능')}</td></tr>
              <tr><td>예습 플리 한 번에 듣기</td><td>${icon('lock', 16, '잠김')}</td><td>${icon('check', 18, '가능')}</td></tr>
            </tbody>
          </table>
        </div>
        <p class="faint small">곡 재생은 각 음악 앱에서 이뤄지며 음악 앱 이용 조건은 별도예요. 자세한 내용은 <a href="#/terms">이용약관</a>을 확인해 주세요.</p>
      </section>
    </div>
    ${footer()}`,

    actions: {
      login() {
        sessionStorage.setItem('sr-return', '#/membership');
        navigate('/login');
      },
      async 'demo-start'() {
        await api.demoStartMembership();
        state.session = await api.getSession();
        toast('데모 멤버십이 시작됐어요. 모든 기능이 열렸어요!', 'ok');
        ctx.rerender();
      },
      async start() {
        await startBilling(api, s);
      },
      async cancel() {
        if (!confirm('멤버십을 해지할까요? 이미 결제한 기간까지는 계속 쓸 수 있어요.')) return;
        await api.cancelMembership();
        state.session = await api.getSession();
        toast('해지를 예약했어요. 이용 기간이 끝나면 자동 결제가 멈춰요.');
        ctx.rerender();
      },
    },

    mount() {
      const ret = takeTossReturn();
      if (!ret) return;
      if (ret.toss === 'success' && ret.authKey && ret.customerKey) {
        toast('결제를 확인하고 있어요…');
        confirmBilling(api, ret)
          .then(async () => {
            await api.refreshProfile?.();
            state.session = await api.getSession();
            toast('멤버십이 시작됐어요. 고마워요!', 'ok');
            ctx.rerender();
          })
          .catch((e) => toast(e.userMessage || '결제 확인에 실패했어요. 고객센터로 문의해 주세요.', 'error'));
      } else {
        toast(ret.message || '카드 등록이 취소됐어요.', 'error');
      }
    },
  };
}
