// 상단 바 · 하단 탭 · 데모 안내 배너
import { html } from './util.js';
import { state } from './state.js';
import { isDemo } from './config.js';
import { icon } from './icons.js';

const logo = html`<svg width="30" height="30" viewBox="0 0 34 34" aria-hidden="true"><rect width="34" height="34" rx="10" fill="#FF6A1F"></rect><path d="M7 20v-6M12 24V10M17 22v-8M22 26V8M27 19v-4" stroke="#0A0C24" stroke-width="2.6" stroke-linecap="round"></path></svg>`;

function navItems() {
  const items = [
    { href: '#/', label: '공연', icon: 'ticket', match: (p) => p === '/' || p.startsWith('/e/') || p.startsWith('/recap') },
    { href: '#/me', label: '내 공연', icon: 'calendar', match: (p) => p === '/me' },
    { href: '#/log', label: '기록', icon: 'clock', match: (p) => p === '/log' },
    { href: '#/membership', label: '멤버십', icon: 'star', match: (p) => p === '/membership' },
  ];
  if (state.session?.isAdmin) items.push({ href: '#/admin', label: '운영', icon: 'settings', match: (p) => p.startsWith('/admin') });
  return items;
}

export function renderChrome(path) {
  const items = navItems();
  const s = state.session;
  document.getElementById('topbar').innerHTML = String(html`
    <div class="topbar-inner">
      <a class="brand" href="#/" aria-label="셋리뷰 홈">${logo}<span>셋리뷰</span></a>
      <nav class="topnav" aria-label="주요 메뉴">
        ${items.map((it) => html`<a href="${it.href}" class="${it.match(path) ? 'active' : ''}" ${it.match(path) ? html`aria-current="page"` : ''}>${it.label}</a>`)}
      </nav>
      <div class="topbar-right">
        <a class="btn btn-ghost btn-sm hide-sm" href="/">서비스 소개</a>
        ${s ? html`<a class="icon-btn bell ${path === '/inbox' ? 'active' : ''}" href="#/inbox" aria-label="알림함${state.unread ? ` · 새 알림 ${state.unread}개` : ''}">${icon('bell', 20)}${state.unread ? html`<span class="bell-dot">${state.unread > 99 ? '99+' : state.unread}</span>` : ''}</a>` : ''}
        ${s
          ? html`<a class="user-chip" href="#/me" aria-label="내 정보">${icon('user', 16)}<span>${s.nickname}</span></a>`
          : html`<a class="btn btn-primary btn-sm" href="#/login">로그인</a>`}
      </div>
    </div>`);

  document.getElementById('tabbar').innerHTML = String(html`
    ${items.map((it) => html`<a href="${it.href}" class="${it.match(path) ? 'active' : ''}" ${it.match(path) ? html`aria-current="page"` : ''}>${icon(it.icon, 22)}<span>${it.label}</span></a>`)}
    ${s ? '' : html`<a href="#/login" class="${path === '/login' ? 'active' : ''}">${icon('user', 22)}<span>로그인</span></a>`}`);

  const banner = document.getElementById('banner');
  if (isDemo && !sessionStorage.getItem('sr-banner-hidden')) {
    banner.innerHTML = String(html`<div class="demo-banner" role="note">
      <div class="container banner-inner">
        <span class="pill pill-accent">데모 모드</span>
        <p>이 브라우저에만 저장돼요. <a href="#/login">데모 계정</a>으로 체험해 보세요.<span class="hide-sm"> 운영자 계정으로는 라이브 셋리스트를 진행할 수 있어요.</span></p>
        <button type="button" class="icon-btn" data-action="dismiss-banner" aria-label="안내 닫기">${icon('x', 18)}</button>
      </div>
    </div>`);
  } else {
    banner.innerHTML = '';
  }
}
