// 로그인
import { html, toast, UserError } from '../util.js';
import { config, isDemo } from '../config.js';
import { navigate } from '../router.js';

const PROVIDERS = {
  kakao: { label: '카카오로 시작하기', cls: 'btn-kakao' },
  google: { label: 'Google로 시작하기', cls: 'btn-google' },
  apple: { label: 'Apple로 시작하기', cls: 'btn-light' },
  spotify: { label: 'Spotify로 시작하기', cls: 'btn-outline' },
};

const EMAIL_KEY = 'sr-login-email';
const getPending = () => { try { return sessionStorage.getItem(EMAIL_KEY) || ''; } catch { return ''; } };
const setPending = (v) => { try { v ? sessionStorage.setItem(EMAIL_KEY, v) : sessionStorage.removeItem(EMAIL_KEY); } catch { /* 저장 불가 */ } };

export default async function login(ctx) {
  const { api, state } = ctx;
  if (state.session) {
    setPending('');
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

  const useEmail = config.loginProviders.includes('email');
  const oauth = config.loginProviders.filter((p) => PROVIDERS[p]);
  const pending = useEmail ? getPending() : '';
  const remember = () => { if (!sessionStorage.getItem('sr-return')) sessionStorage.setItem('sr-return', '#/me'); };

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
          ${useEmail ? (pending ? html`
            <div class="notice small" role="status"><strong>${pending}</strong>(으)로 로그인 메일을 보냈어요. 메일의 <strong>로그인 버튼</strong>을 누르거나, 메일에 있는 <strong>6자리 코드</strong>를 아래에 넣어 주세요.</div>
            <form class="auth-form" data-form="code" novalidate>
              <div class="field">
                <label for="login-code">인증 코드</label>
                <input class="input code-input" id="login-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="10" placeholder="123456" required>
              </div>
              <button type="submit" class="btn btn-primary btn-block">로그인</button>
            </form>
            <p class="faint small">메일이 안 보이면 스팸함도 확인해 주세요. <button type="button" class="link-btn" data-action="resend">다시 보내기</button> · <button type="button" class="link-btn" data-action="change-email">다른 주소로</button></p>
          ` : html`
            <form class="auth-form" data-form="email" novalidate>
              <div class="field">
                <label for="login-email">이메일</label>
                <input class="input" id="login-email" name="email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required>
                <span class="hint">비밀번호 없이, 메일로 받은 링크나 코드로 로그인해요. 처음이면 바로 가입돼요.</span>
              </div>
              <button type="submit" class="btn btn-primary btn-block">로그인 메일 받기</button>
            </form>
          `) : ''}
          ${oauth.length && useEmail && !pending ? html`<div class="or-divider"><span>또는</span></div>` : ''}
          ${pending ? '' : oauth.map((p) => html`
            <button type="button" class="btn ${PROVIDERS[p].cls} btn-block" data-action="oauth" data-provider="${p}">${PROVIDERS[p].label}</button>`)}
          <p class="faint small">계속하면 <a href="#/terms">이용약관</a>과 <a href="#/privacy">개인정보처리방침</a>에 동의하는 것으로 봐요.</p>
        `}
      </div>
    </section>`,
    forms: {
      async email(fd) {
        const email = String(fd.get('email') || '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError('이메일 주소를 확인해 주세요.');
        remember();
        await api.sendEmailLogin(email);
        setPending(email);
        toast('로그인 메일을 보냈어요.', 'ok');
        ctx.rerender();
        setTimeout(() => document.getElementById('login-code')?.focus(), 50);
      },
      async code(fd) {
        const code = String(fd.get('code') || '').replace(/\D/g, '');
        if (code.length < 6) throw new UserError('메일에 있는 6자리 코드를 넣어 주세요.');
        await api.verifyEmailCode(pending, code);
        setPending('');
        toast('로그인했어요.', 'ok');
        state.session = await api.getSession();
        back();
      },
    },
    actions: {
      async resend() {
        await api.sendEmailLogin(pending);
        toast('메일을 다시 보냈어요.', 'ok');
      },
      'change-email'() {
        setPending('');
        ctx.rerender();
      },
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
