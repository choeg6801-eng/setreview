// 알림함: 취향에 맞는 새 공연 소식
import { html, fmtDate, timeAgo, dday } from '../util.js';
import { emptyState, KIND_LABEL } from '../components.js';
import { icon } from '../icons.js';
import { renderChrome } from '../chrome.js';
import { footer } from './footer.js';

export default async function inbox(ctx) {
  const { api, state } = ctx;
  if (!state.session) {
    return {
      title: '알림함',
      html: html`<section class="container narrow">${emptyState('로그인하면 알림을 받을 수 있어요', '좋아하는 아티스트와 장르를 등록하면 맞는 공연을 알려 드려요.', html`<a class="btn btn-primary" href="#/login">로그인</a>`)}</section>`,
    };
  }
  await api.refreshMyNotifications().catch(() => 0);
  const list = await api.listNotifications();
  const unread = list.filter((n) => !n.read).length;

  return {
    title: '알림함',
    html: html`<div class="container narrow">
      <section class="section log-head">
        <div class="stack" style="gap:2px">
          <span class="serif-kicker">for you</span>
          <h1>알림함</h1>
          <p class="muted">${unread ? `새 소식 ${unread}개가 있어요.` : '취향에 맞는 공연 소식이 여기에 모여요.'}</p>
        </div>
        <a class="btn btn-outline" href="#/taste">${icon('star', 18)} 내 취향 설정</a>
      </section>
      ${list.length ? html`<ol class="inbox">
        ${list.map((n) => html`<li class="inbox-item ${n.read ? '' : 'unread'}">
          <a href="#/e/${encodeURIComponent(n.event.slug)}">
            ${n.event.coverUrl ? html`<img src="${n.event.coverUrl}" alt="" loading="lazy" referrerpolicy="no-referrer">` : html`<span class="inbox-art" aria-hidden="true">${icon('music', 22)}</span>`}
            <span class="inbox-main">
              <span class="inbox-reason">${n.kind === 'artist' ? '♥ ' : ''}${n.reason}${n.read ? '' : html` <span class="pill pill-accent">NEW</span>`}</span>
              <strong>${n.event.title}</strong>
              <span class="small muted">${fmtDate(n.event.startsAt)} · ${[n.event.city, n.event.venue].filter(Boolean).join(' ')} · ${dday(n.event.startsAt)}</span>
              <span class="row" style="gap:6px"><span class="pill pill-soft">${KIND_LABEL[n.event.kind] || ''}</span>${n.event.isVisit ? html`<span class="pill pill-visit">내한</span>` : ''}<span class="faint small">${timeAgo(n.createdAt)}</span></span>
            </span>
          </a>
        </li>`)}
      </ol>` : emptyState('아직 알림이 없어요', '좋아하는 아티스트와 장르를 등록하면, 맞는 공연이 올라올 때 여기에 알려 드려요.', html`<a class="btn btn-primary" href="#/taste">취향 등록하기</a>`)}
    </div>
    ${footer()}`,
    mount() {
      if (!unread) return;
      // 열어 본 알림은 읽음으로 표시 (화면의 NEW 표시는 이번에는 그대로 둬요)
      api.markNotificationsRead().then(() => {
        state.unread = 0;
        renderChrome('/inbox');
      }).catch(() => {});
    },
  };
}
