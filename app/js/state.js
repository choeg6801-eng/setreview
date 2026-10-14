// 앱 전체에서 함께 쓰는 상태 (로그인 정보, 내 공연, 예습 체크, 설정)
import { canPremium } from './api/shape.js';

export const state = {
  api: null,
  session: null,
  settings: { freeBeta: false },
  follows: new Set(),
  progress: new Set(),
  unread: 0,
};

export async function refreshUser() {
  const api = state.api;
  state.session = await api.getSession();
  state.settings = await api.getSettings().catch(() => state.settings);
  if (state.session) {
    // 취향 알림을 먼저 새로 만들어 두고 (새로 올라온 공연 반영) 안 읽은 수를 세요
    await api.refreshMyNotifications().catch(() => 0);
    const [f, p, n] = await Promise.all([api.listFollows(), api.listProgress(), api.countUnread().catch(() => 0)]);
    state.follows = new Set(f);
    state.progress = new Set(p);
    state.unread = n;
  } else {
    state.follows = new Set();
    state.progress = new Set();
    state.unread = 0;
  }
}

export const premium = () => canPremium(state.session, state.settings);
export const loggedIn = () => !!state.session;
