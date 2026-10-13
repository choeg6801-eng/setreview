// 로그인
import { html, toast } from '../util.js';
import { config, isDemo } from '../config.js';
import { navigate } from '../router.js';

const PROVIDERS = {
  kakao: { label: '카카오로 시작하기', cls: 'btn-kakao' },
  google: { label: 'Google로 시작하기', cls: 'btn-google' },
  apple: { label: 'Apple로 시작하기', cls: 'btn-light' },
  spotify: { label: 'Spotify로 시작하기', cls: 'btn-outline' },
};

export default async function login(ctx) {
  const { api, state } = ctx;
  if (state.session) {
    return {
      title: '로그인',
      html: html`<section class="container"><div class="card auth-card">
        <h1>이미 로그인했어요</h1>
        <p class="muted">${state.session.nickname}님, 반가워요.</p>
        <a class="btn btn-primary" href="#/me">내 공연 보기</a>
      </div></section>`,
    };
  }

  const back = () => {
    const to = sessionStorage.getItem('sr-return');
    sessionStorage.removeItem('sr-return');
    location.hash = to && to !== '#/login' ? to : '#/me';
  };

  return {
    title: '로그인',
    html: html`<section class="container">
      <div class="card auth-card">
        <span class="serif-kicker">welcome to the pit</span>
        <h1>셋리뷰 시작하기</h1>
        <p class="muted">내 공연을 담고, 예습 진행률을 기록하고, 현장에서 셋리스트를 제보할 수 있어요.</p>
        ${isDemo ? html`
          <div class="notice notice-warn small">데모 모드예요. 실제 계정 대신 데모 계정으로 모든 기능을 체험해 보세요.</div>
          <button type="button" class="btn btn-primary btn-block" data-action="demo" data-kind="user">덕후 데모 계정으로 시작</button>
          <button type="button" class="btn btn-outline btn-block" data-action="demo" data-kind="admin">운영자 데모 계정으로 시작</button>
          <p class="faint small">운영자 계정으로는 공연 등록, 라이브 셋리스트 진행, 제보 승인을 해 볼 수 있어요.</p>
        ` : html`
          ${config.loginProviders.filter((p) => PROVIDERS[p]).map((p) => html`
            <button type="button" class="btn ${PROVIDERS[p].cls} btn-block" data-action="oauth" data-provider="${p}">${PROVIDERS[p].label}</button>`)}
          <p class="faint small">계속하면 <a href="#/terms">이용약관</a>과 <a href="#/privacy">개인정보처리방침</a>에 동의하는 것으로 봐요.</p>
        `}
      </div>
    </section>`,
    actions: {
      async demo(el) {
        await api.signInDemo(el.dataset.kind);
        toast(el.dataset.kind === 'admin' ? '운영자 데모 계정으로 로그인했어요.' : '데모 계정으로 로그인했어요.', 'ok');
        if (el.dataset.kind === 'admin' && !sessionStorage.getItem('sr-return')) return navigate('/admin');
        back();
      },
      async oauth(el) {
        if (!sessionStorage.getItem('sr-return')) sessionStorage.setItem('sr-return', '#/me');
        await api.signIn(el.dataset.provider);
      },
    },
  };
}
