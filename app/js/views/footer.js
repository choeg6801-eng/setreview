import { html } from '../util.js';
import { config } from '../config.js';

export function footer() {
  return html`<footer class="footer">
    <div class="container stack" style="gap:10px">
      <div class="row">
        <a href="/">서비스 소개</a>
        <a href="#/terms">이용약관</a>
        <a href="#/privacy">개인정보처리방침</a>
        ${config.supportEmail ? html`<a href="mailto:${config.supportEmail}">문의 ${config.supportEmail}</a>` : ''}
      </div>
      <p>© ${new Date().getFullYear()} 셋리뷰 SetReview · 아티스트명·곡명·앨범 아트의 권리는 각 권리자에게 있어요. 셋리뷰는 Spotify 또는 아티스트와 제휴 관계가 아니에요.</p>
    </div>
  </footer>`;
}
