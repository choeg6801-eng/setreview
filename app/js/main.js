import { getApi } from './api/index.js';
import { state, refreshUser } from './state.js';
import { route, parseHash, match, navigate } from './router.js';
import { html, toast, errorMessage } from './util.js';
import { isDemo } from './config.js';
import { renderChrome } from './chrome.js';
import * as bgm from './bgm.js';

// ---------- 결제창에서 돌아온 경우: 주소의 결제 정보를 먼저 챙겨 두고 주소를 정리해요 ----------
{
  const sp = new URLSearchParams(location.search);
  if (sp.has('toss')) {
    sessionStorage.setItem('sr-toss-return', JSON.stringify(Object.fromEntries(sp)));
    history.replaceState(null, '', `${location.pathname}#/membership`);
  }
}

// ---------- 화면 목록 ----------
route('/', () => import('./views/home.js'));
route('/e/:slug', () => import('./views/event.js'));
route('/me', () => import('./views/me.js'));
route('/log', () => import('./views/log.js'));
route('/taste', () => import('./views/taste.js'));
route('/inbox', () => import('./views/inbox.js'));
route('/submit', () => import('./views/submit.js'));
route('/login', () => import('./views/login.js'));
route('/membership', () => import('./views/membership.js'));
route('/recap/:slug/:perf', () => import('./views/recap.js'));
route('/admin', () => import('./views/admin.js'));
route('/admin/:tab', () => import('./views/admin.js'));
route('/admin/:tab/:id', () => import('./views/admin.js'));
route('/terms', () => import('./views/legal.js'));
route('/privacy', () => import('./views/legal.js'));

const main = document.getElementById('main');
let current = null;
let cleanup = null;
let seq = 0;
let lastPath = null;

function errorView(e) {
  return {
    title: '오류',
    html: html`<section class="container narrow">
      <div class="empty">
        <h1>화면을 불러오지 못했어요</h1>
        <p>${errorMessage(e)}</p>
        <a class="btn btn-primary" href="#/">처음으로</a>
      </div>
    </section>`,
  };
}

async function render({ keepScroll = false } = {}) {
  const { path, query } = parseHash();
  const m = match(path);
  const my = ++seq;
  const y = window.scrollY;
  let view;
  const slow = setTimeout(() => { if (my === seq) document.body.classList.add('is-loading'); }, 150);
  try {
    if (!m) {
      view = {
        title: '페이지 없음',
        html: html`<section class="container narrow"><div class="empty"><h1>페이지를 찾을 수 없어요</h1><a class="btn btn-primary" href="#/">공연 보러 가기</a></div></section>`,
      };
    } else {
      const mod = await m.load();
      view = await mod.default({ params: m.params, query, path, api: state.api, state, rerender, navigate });
    }
  } catch (e) {
    console.error(e);
    view = errorView(e);
  }
  clearTimeout(slow);
  if (my !== seq) return; // 더 최신 화면 요청이 있으면 버려요
  document.body.classList.remove('is-loading');

  try { cleanup?.(); } catch { /* 무시 */ }
  cleanup = null;
  current = view;
  main.innerHTML = String(view.html);
  document.title = view.title ? `${view.title} · 셋리뷰` : '셋리뷰 — 셋리스트 예습·떼창·복습';
  renderChrome(path);

  const samePage = path === lastPath;
  lastPath = path;
  if (keepScroll || samePage) window.scrollTo(0, y);
  else {
    window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
  }
  if (view.mount) {
    try { cleanup = view.mount(main) || null; } catch (e) { console.error(e); }
  }
}

let rerenderTimer = null;
export function rerender() {
  clearTimeout(rerenderTimer);
  return new Promise((resolve) => {
    rerenderTimer = setTimeout(() => render({ keepScroll: true }).then(resolve), 30);
  });
}

// ---------- 이벤트 위임: data-action / data-form / data-change ----------
async function run(el, fn) {
  if (el?.dataset.busy) return;
  if (el) { el.dataset.busy = '1'; el.setAttribute('aria-busy', 'true'); }
  try {
    await fn();
  } catch (e) {
    if (!e?.userMessage) console.error(e); // 안내용 메시지는 콘솔 오류로 남기지 않아요
    toast(errorMessage(e), 'error');
  } finally {
    if (el) { delete el.dataset.busy; el.removeAttribute('aria-busy'); }
  }
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const name = el.dataset.action;
  const fn = current?.actions?.[name] || globalActions[name];
  if (!fn) return;
  e.preventDefault();
  run(el, () => fn(el, e));
});

main.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const fn = current?.forms?.[form.dataset.form];
  if (!fn) return;
  const btn = form.querySelector('[type="submit"]');
  run(btn || form, () => fn(new FormData(form), form, e));
});

main.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (!el) return;
  const fn = current?.changes?.[el.dataset.change];
  if (fn) run(null, () => fn(el, e));
});

// 상단·하단 메뉴처럼 화면 밖에 있는 버튼
const globalActions = {
  async 'toggle-bgm'() {
    await bgm.toggle();
  },
  async 'dismiss-banner'() {
    sessionStorage.setItem('sr-banner-hidden', '1');
    document.getElementById('banner').innerHTML = '';
  },
};

// ---------- 시작 ----------
async function start() {
  bgm.onChange(() => renderChrome(parseHash().path));
  bgm.checkAvailable().then((ok) => ok && bgm.resumeIfSaved());
  try {
    state.api = await getApi();
    await refreshUser();
  } catch (e) {
    console.error(e);
    main.innerHTML = String(html`<section class="container narrow"><div class="empty">
      <h1>서버에 연결하지 못했어요</h1>
      <p>${errorMessage(e)}</p>
      <p class="muted">app/config.js 의 Supabase 주소와 키를 확인해 주세요.</p>
    </div></section>`);
    return;
  }

  // 로그인하고 돌아왔으면 원래 보던 화면으로
  const back = sessionStorage.getItem('sr-return');
  if (back && state.session && new URLSearchParams(location.search).size === 0) {
    sessionStorage.removeItem('sr-return');
    if (!location.hash || location.hash === '#/' || location.hash === '#/login') location.hash = back;
  }
  if (location.search && !isDemo) history.replaceState(null, '', `${location.pathname}${location.hash}`);

  state.api.onAuth(async () => {
    await refreshUser();
    render({ keepScroll: true });
  });
  window.addEventListener('hashchange', () => render());
  await render();
}

start();
