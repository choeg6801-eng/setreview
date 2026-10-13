// 이용약관 · 개인정보처리방침 초안 — 출시 전 반드시 법률 검토 후 실제 내용으로 바꿔 주세요.
import { html } from '../util.js';
import { config } from '../config.js';
import { backLink } from '../components.js';

export default async function legal(ctx) {
  const isPrivacy = ctx.path === '/privacy';
  const contact = config.supportEmail || '[고객센터 이메일]';
  return {
    title: isPrivacy ? '개인정보처리방침' : '이용약관',
    html: html`<section class="container narrow section stack">
      ${backLink('#/', '처음으로')}
      <h1 style="font-size:28px">${isPrivacy ? '개인정보처리방침' : '이용약관'} <span class="pill pill-muted">초안</span></h1>
      <div class="notice notice-warn small">이 문서는 출시 준비용 초안이에요. 사업자 정보와 실제 운영 방식에 맞게 고치고, 법률 검토를 받은 뒤 게시해 주세요.</div>
      ${isPrivacy ? html`
        <div class="card stack small">
          <h2>1. 수집하는 개인정보</h2>
          <p>소셜 로그인 시 제공되는 이메일·닉네임, 서비스 이용 기록(담은 공연, 예습 체크, 제보), 출시 알림 신청 이메일, 결제 시 결제대행사가 처리하는 결제 정보(카드 정보는 셋리뷰가 저장하지 않아요).</p>
          <h2>2. 이용 목적</h2>
          <p>회원 식별, 맞춤 예습 리스트 제공, 실시간 셋리스트 운영, 멤버십 결제와 정산, 출시·공연 소식 안내.</p>
          <h2>3. 보관 기간</h2>
          <p>회원 탈퇴 시 지체 없이 파기해요. 단, 전자상거래법에 따라 결제 기록은 5년간 보관해요.</p>
          <h2>4. 처리 위탁</h2>
          <p>Supabase(데이터 보관·인증), Vercel(웹 호스팅), 토스페이먼츠(결제). [실제 위탁 업체로 바꿔 주세요]</p>
          <h2>5. 문의</h2>
          <p>개인정보 보호책임자: [이름] · ${contact}</p>
        </div>` : html`
        <div class="card stack small">
          <h2>제1조 (목적)</h2>
          <p>이 약관은 [상호](이하 "회사")가 제공하는 셋리뷰 서비스의 이용 조건과 절차를 정해요.</p>
          <h2>제2조 (서비스 내용)</h2>
          <p>예상·실제 셋리스트, 하이라이트·떼창 구간 안내, 음악 앱 링크, 현장 제보 기능을 제공해요. 예상 셋리스트와 떼창 정보는 참고용이며 실제 공연과 다를 수 있어요.</p>
          <h2>제3조 (멤버십과 결제)</h2>
          <p>멤버십은 월 ${new Intl.NumberFormat('ko-KR').format(config.membershipPrice)}원이며 등록한 카드로 매월 자동 결제돼요. 언제든 해지할 수 있고, 해지해도 이미 결제한 기간까지는 이용할 수 있어요. 환불 기준: [환불 정책을 적어 주세요]</p>
          <h2>제4조 (이용자의 의무)</h2>
          <p>허위 제보, 타인의 권리를 침해하는 콘텐츠 게시를 금지해요.</p>
          <h2>제5조 (권리 귀속)</h2>
          <p>아티스트명·곡명·앨범 아트 등 음악 관련 정보의 권리는 각 권리자에게 있어요.</p>
          <h2>제6조 (문의)</h2>
          <p>${contact}</p>
        </div>`}
    </section>`,
  };
}
