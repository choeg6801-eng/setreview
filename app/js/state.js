// 앱 전체에서 함께 쓰는 상태 (로그인 정보, 내 공연, 예습 체크, 설정)
import { canPremium } from './api/shape.js';

export const state = {
  api: null,
  session: null,
  settings: { freeBeta: false },
  follows: new Set(),
  progress: new Set(),
};

export async function refreshUser() {
  const api = state.api;
  state.session = await api.getSession();
  state.settings = await api.getSettings().catch(() => state.settings);
  if (state.session) {
    const [f, p] = await Promise.all([api.listFollows(), api.listProgress()]);
    state.follows = new Set(f);
    state.progress = new Set(p);
  } else {
    state.follows = new Set();
    state.progress = new Set();
  }
}

export const premium = () => canPremium(state.session, state.settings);
export const loggedIn = () => !!state.session;
