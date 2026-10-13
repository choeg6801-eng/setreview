// 내 공연: 시즌 보드 · 프로필
import { html, toast, fmtDate, dday, daysUntil, UserError } from '../util.js';
import { progressBar, emptyState, statusPill } from '../components.js';
import { icon } from '../icons.js';
import { isMemberActive } from '../api/shape.js';
import { premium } from '../state.js';
import { navigate } from '../router.js';
import { footer } from './footer.js';

export default async function me(ctx) {
  const { api, state } = ctx;
  if (!state.session) {
    return {
      title: '내 공연',
      html: html`<section class="container narrow">${emptyState('로그인하고 내 공연을 담아 보세요', '갈 공연을 담으면 D-day와 예습 진행률을 한눈에 볼 수 있어요.', html`<a class="btn btn-primary" href="#/login">로그인</a>`)}</section>`,
    };
  }

  const s = state.session;
  const events = await api.listEvents();
  const mine = events.filter((e) => state.follows.has(e.id));
  // 공연마다 예상 셋리스트를 불러와 진행률 계산
  const details = await Promise.all(mine.map((e) => api.getEventBySlug(e.slug)));
  const rows = mine.map((e, i) => {
    const d = details[i];
    const ids = d ? [...new Set(d.performances.flatMap((p) => p.predicted.map((it) => it.song?.id).filter(Boolean)))] : [];
    const done = ids.filter((id) => state.progress.has(id)).length;
    const left = ids.length - done;
    const days = daysUntil(e.startsAt);
    const perDay = e.status === 'upcoming' && left > 0 ? Math.ceil(left / Math.max(1, days)) : 0;
    return { e, total: ids.length, done, left, days, perDay };
  });
  const upcoming = rows.filter((r) => r.e.status !== 'ended').sort((a, b) => a.e.startsAt.localeCompare(b.e.startsAt));
  const past = rows.filter((r) => r.e.status === 'ended').sort((a, b) => b.e.startsAt.localeCompare(a.e.startsAt));
  const member = isMemberActive(s);

  const boardRow = (r) => html`<div class="board-row">
    <span class="board-dday ${r.e.status === 'upcoming' && r.days <= 7 ? 'soon' : ''}">${r.e.status === 'live' ? statusPill(r.e) : r.e.status === 'ended' ? html`<span class="pill pill-muted">종료</span>` : dday(r.e.startsAt)}</span>
    <div style="min-width:0">
      <div class="board-title"><a href="#/e/${encodeURIComponent(r.e.slug)}">${r.e.title}</a></div>
      <div class="board-sub">${fmtDate(r.e.startsAt)} · ${r.e.city || ''}</div>
    </div>
    <div class="board-prog">
      ${progressBar(r.done, r.total, `${r.e.title} 예습 진행률`)}
      <span>${r.total ? `${r.done}/${r.total}곡 예습` : '예상 셋리스트 준비 중'}${r.perDay ? ` · 하루 ${r.perDay}곡씩` : ''}${r.e.status === 'upcoming' && r.total && !r.left ? ' · 예습 완료!' : ''}</span>
    </div>
    <div class="board-go">
      ${r.e.status === 'ended'
        ? html`<a class="btn btn-soft btn-sm" href="#/e/${encodeURIComponent(r.e.slug)}">복습하기</a>`
        : html`<a class="btn btn-outline btn-sm" href="#/e/${encodeURIComponent(r.e.slug)}">${r.e.status === 'live' ? '실시간 보기' : '예습 이어하기'}</a>`}
    </div>
  </div>`;

  return {
    title: '내 공연',
    html: html`<div class="container">
      <section class="section">
        <div class="card profile-card">
          <span class="avatar" aria-hidden="true">${(s.nickname || '덕').slice(0, 1)}</span>
          <div class="stack" style="gap:4px;flex:1;min-width:200px">
            <strong style="font-size:20px">${s.nickname}</strong>
            <span class="small muted">${s.email || (s.provider === 'demo' ? '데모 계정' : '')}${s.isAdmin ? ' · 운영자' : ''}</span>
            <span class="row" style="gap:6px">
              ${member ? html`<span class="pill pill-ok">멤버십 이용 중 · ${fmtDate(s.membershipUntil, { weekday: undefined })}까지</span>`
                : state.settings.freeBeta ? html`<span class="pill pill-soft">무료 베타 · 모든 기능 열림</span>`
                : html`<a class="pill pill-accent" href="#/membership" style="text-decoration:none">무료 이용 중 · 멤버십 보기</a>`}
            </span>
          </div>
          <form class="inline-form" data-form="nickname" style="flex:1 1 260px">
            <label class="sr-only" for="nick">닉네임</label>
            <input id="nick" class="input input-sm" name="nickname" value="${s.nickname}" maxlength="20" autocomplete="nickname">
            <button class="btn btn-outline btn-sm" type="submit">닉네임 저장</button>
          </form>
        </div>
      </section>

      <section class="section" style="padding-top:0">
        <div class="section-title">
          <div class="stack" style="gap:2px">
            <span class="serif-kicker">my season board</span>
            <h2>이번 시즌 내 공연</h2>
          </div>
          <a class="btn btn-outline btn-sm" href="#/">${icon('plus', 16)} 공연 담기</a>
        </div>
        ${upcoming.length ? html`<div class="board">${upcoming.map(boardRow)}</div>`
          : emptyState('아직 담은 공연이 없어요', '갈 공연을 담으면 D-day와 하루 예습량을 계산해 드려요.', html`<a class="btn btn-primary" href="#/">공연 둘러보기</a>`)}
        ${!premium() && mine.length >= 1 ? html`<p class="small muted" style="margin-top:10px">무료 이용자는 공연 1개까지 담을 수 있어요. <a href="#/membership">멤버십</a>이면 무제한이에요.</p>` : ''}
      </section>

      ${past.length ? html`<section class="section" style="padding-top:0">
        <div class="section-title"><h2>다녀온 공연</h2></div>
        <div class="board">${past.map(boardRow)}</div>
      </section>` : ''}

      <section class="section row">
        ${s.isAdmin ? html`<a class="btn btn-outline" href="#/admin">${icon('settings', 18)} 운영자 화면</a>` : ''}
        <button type="button" class="btn btn-ghost" data-action="logout">${icon('logout', 18)} 로그아웃</button>
      </section>
    </div>
    ${footer()}`,

    forms: {
      async nickname(fd) {
        const n = String(fd.get('nickname') || '').trim();
        if (!n) throw new UserError('닉네임을 적어 주세요.');
        await api.updateNickname(n);
        state.session = await api.getSession();
        toast('닉네임을 바꿨어요.', 'ok');
        ctx.rerender();
      },
    },
    actions: {
      async logout() {
        await api.signOut();
        toast('로그아웃했어요.');
        navigate('/');
      },
    },
  };
}
