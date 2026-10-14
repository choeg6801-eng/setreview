// 공연 제보: 발표됐지만 아직 셋리뷰에 없는 공연을 알려 주기
import { html, toast, fmtDate, fmtDateTime, fromLocalInput, UserError } from '../util.js';
import { emptyState, KIND_LABEL } from '../components.js';
import { icon } from '../icons.js';
import { footer } from './footer.js';

const STATUS = { pending: ['확인 중', 'pill-soft'], approved: ['등록 완료', 'pill-ok'], rejected: ['반려', 'pill-muted'] };

export default async function submit(ctx) {
  const { api, state } = ctx;
  if (!state.session) {
    return {
      title: '공연 제보',
      html: html`<section class="container narrow">${emptyState('로그인하고 공연을 제보해 주세요', '발표됐는데 셋리뷰에 아직 없는 내한 공연이나 페스티벌을 알려 주시면, 확인한 뒤 바로 올려 드려요.', html`<a class="btn btn-primary" href="#/login" data-action="go-login">로그인</a>`)}</section>`,
      actions: { 'go-login'() { sessionStorage.setItem('sr-return', '#/submit'); } },
    };
  }
  const mine = await api.listMySubmissions();

  return {
    title: '공연 제보',
    html: html`<div class="container narrow">
      <section class="section log-head">
        <div class="stack" style="gap:2px">
          <span class="serif-kicker">tip us off</span>
          <h1>공연 제보</h1>
          <p class="muted">발표됐는데 아직 셋리뷰에 없는 내한 공연 · 페스티벌을 알려 주세요. 운영자가 공지를 확인하고 올리면, 좋아하는 사람들에게 티켓 오픈 알림이 가요.</p>
        </div>
      </section>

      <form class="card log-grid" data-form="submit" novalidate>
        <div class="field span-2"><label for="sb-title">공연 이름 <span class="accent">*</span></label>
          <input id="sb-title" class="input" name="title" required maxlength="120" placeholder="예: Maroon 5 Asia 2027 in Seoul"></div>
        <div class="field span-2"><label for="sb-source">공지 · 기사 링크 <span class="accent">*</span></label>
          <input id="sb-source" class="input" name="sourceUrl" type="url" required placeholder="https://… (기획사 공지, 예매처 페이지, 기사)">
          <span class="hint">확인할 때 꼭 필요해요. 공식 공지나 예매처 링크가 가장 좋아요.</span></div>
        <div class="field span-2"><label for="sb-artist">아티스트 · 라인업</label>
          <input id="sb-artist" class="input" name="artist" maxlength="200" placeholder="여러 팀이면 쉼표로 나눠 주세요"></div>
        <div class="field"><label for="sb-kind">종류</label>
          <select id="sb-kind" class="select" name="kind"><option value="concert">단독 공연</option><option value="festival">페스티벌</option></select></div>
        <label class="check field-check"><input type="checkbox" name="isVisit" checked> 해외 아티스트 내한 공연</label>
        <div class="field"><label for="sb-date">공연 날짜</label><input id="sb-date" class="input" type="date" name="startsOn"></div>
        <div class="field"><label for="sb-open">티켓 오픈 (한국 시간)</label><input id="sb-open" class="input" type="datetime-local" name="ticketOpen"></div>
        <div class="field"><label for="sb-venue">공연장</label><input id="sb-venue" class="input" name="venue" maxlength="80"></div>
        <div class="field"><label for="sb-city">도시</label><input id="sb-city" class="input" name="city" maxlength="40"></div>
        <div class="field span-2"><label for="sb-ticket">예매 페이지 링크</label><input id="sb-ticket" class="input" name="ticketUrl" type="url" placeholder="https://…"></div>
        <div class="field span-2"><label for="sb-memo">메모</label><textarea id="sb-memo" class="textarea" name="memo" rows="2" maxlength="500" placeholder="선예매 일정, 가격 등 알고 있는 정보"></textarea></div>
        <div class="row span-2"><button class="btn btn-primary" type="submit">${icon('plus', 16)} 제보하기</button></div>
      </form>

      ${mine.length ? html`<section class="section">
        <h2 class="log-group-title">내가 제보한 공연</h2>
        <ol class="log-list">${mine.map((m) => html`<li class="log-item sub-item">
          <div class="log-main">
            <div class="log-title">${m.title}</div>
            <div class="log-sub">${[m.startsOn && fmtDate(m.startsOn), [m.city, m.venue].filter(Boolean).join(' '), m.ticketOpenAt && `티켓 오픈 ${fmtDateTime(m.ticketOpenAt)}`].filter(Boolean).join(' · ')}</div>
            <div class="row" style="gap:6px;margin-top:6px"><span class="pill ${STATUS[m.status][1]}">${STATUS[m.status][0]}</span><span class="pill pill-soft">${KIND_LABEL[m.kind]}</span>${m.isVisit ? html`<span class="pill pill-visit">내한</span>` : ''}</div>
          </div>
        </li>`)}</ol>
      </section>` : ''}
    </div>
    ${footer()}`,

    forms: {
      async submit(fd, form) {
        const input = Object.fromEntries(fd);
        input.isVisit = fd.get('isVisit') === 'on';
        input.ticketOpenAt = fd.get('ticketOpen') ? fromLocalInput(fd.get('ticketOpen')) : null;
        if (!String(input.title || '').trim()) throw new UserError('공연 이름을 적어 주세요.');
        await api.submitEvent(input);
        form.reset();
        toast('제보해 주셔서 고마워요! 확인하고 올려 드릴게요.', 'ok');
        ctx.rerender();
      },
    },
  };
}
