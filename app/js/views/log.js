// 내 공연 기록: 연도별로 다녀온 콘서트·페스티벌을 모아 보고 기록해요
import { html, toast, UserError } from '../util.js';
import { emptyState, KIND_LABEL } from '../components.js';
import { icon } from '../icons.js';
import { navigate } from '../router.js';
import { footer } from './footer.js';

const MONTHS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
const kstDate = (iso) => new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(0, 10);
const todayKst = () => kstDate(new Date().toISOString());
const stars = (n) => (n ? html`<span class="stars" aria-label="별점 ${n}점">${'★'.repeat(n)}<span class="faint">${'★'.repeat(5 - n)}</span></span>` : '');
const uniqCount = (arr) => new Set(arr.map((v) => v.trim().toLowerCase()).filter(Boolean)).size;

function topOf(list, key) {
  const counts = new Map();
  for (const r of list) {
    const v = (r[key] || '').trim();
    if (v) counts.set(v, (counts.get(v) || 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 1 ? { name: best[0], n: best[1] } : null;
}

function fromEvent(ev) {
  return {
    eventId: ev.id, title: ev.title, artist: ev.artists.join(', '), date: kstDate(ev.startsAt),
    kind: ev.kind, isVisit: ev.isVisit, venue: ev.venue, city: ev.city, rating: null, memo: '',
  };
}

export default async function log(ctx) {
  const { api, state, query } = ctx;
  if (!state.session) {
    return {
      title: '내 기록',
      html: html`<section class="container narrow">${emptyState('로그인하고 공연 기록을 남겨 보세요', '다녀온 콘서트와 페스티벌을 연도별로 모아 한눈에 볼 수 있어요.', html`<a class="btn btn-primary" href="#/login" data-action="go-login">로그인</a>`)}</section>`,
      actions: { 'go-login'() { sessionStorage.setItem('sr-return', location.hash); } },
    };
  }

  const [records, events] = await Promise.all([api.listAttendances(), api.listEvents()]);
  const years = [...new Set(records.map((r) => r.date.slice(0, 4)))].sort((a, b) => b.localeCompare(a));
  const thisYear = todayKst().slice(0, 4);
  const year = query.y === 'all' ? 'all' : years.includes(query.y) ? query.y : (years[0] || thisYear);
  const scope = year === 'all' ? records : records.filter((r) => r.date.startsWith(year));

  // ---------- 기록 폼 ----------
  const editing = query.edit ? records.find((r) => r.id === query.edit) : null;
  const pickEv = query.add && query.add !== 'new' ? events.find((e) => e.slug === query.add) : null;
  const already = pickEv && records.find((r) => r.eventId === pickEv.id);
  const showForm = !!(editing || (query.add && !already));
  const f = editing || (pickEv ? fromEvent(pickEv) : { date: todayKst(), kind: 'concert', rating: null });
  const pickable = events.filter((e) => e.status !== 'upcoming').sort((a, b) => b.startsAt.localeCompare(a.startsAt)).slice(0, 300);

  // 담았던 공연 중 끝났는데 아직 기록 안 한 것
  const recorded = new Set(records.map((r) => r.eventId).filter(Boolean));
  const suggest = events.filter((e) => state.follows.has(e.id) && e.status === 'ended' && !recorded.has(e.id)).slice(0, 3);

  // ---------- 요약 ----------
  const stats = {
    total: scope.length,
    festival: scope.filter((r) => r.kind === 'festival').length,
    visit: scope.filter((r) => r.isVisit).length,
    artists: uniqCount(scope.flatMap((r) => r.artist.split(/[,·]/))),
    venues: uniqCount(scope.map((r) => r.venue)),
  };
  const topVenue = topOf(scope, 'venue');
  const topArtist = topOf(scope.flatMap((r) => r.artist.split(/[,·]/).map((a) => ({ artist: a }))), 'artist');

  // 막대: 연도 화면은 월별, 전체 화면은 연도별
  const bars = year === 'all'
    ? [...years].reverse().map((y) => ({ label: `${y}`, n: records.filter((r) => r.date.startsWith(y)).length, href: `#/log?y=${y}` }))
    : MONTHS.map((label, i) => ({ label, n: scope.filter((r) => Number(r.date.slice(5, 7)) === i + 1).length }));
  const maxBar = Math.max(1, ...bars.map((b) => b.n));

  // 목록 묶음: 연도 화면은 월별, 전체 화면은 연도별
  const groups = [];
  for (const r of scope) {
    const key = year === 'all' ? r.date.slice(0, 4) : r.date.slice(0, 7);
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push(g = { key, label: year === 'all' ? `${key}년` : `${Number(key.slice(5))}월`, items: [] });
    g.items.push(r);
  }

  const card = (r) => html`<li class="log-item">
    <div class="log-date" aria-hidden="true"><span>${r.date.slice(5, 7)}.${r.date.slice(8, 10)}</span>${year === 'all' ? html`<small>${r.date.slice(0, 4)}</small>` : ''}</div>
    <div class="log-main">
      <div class="log-title">${r.eventSlug ? html`<a href="#/e/${encodeURIComponent(r.eventSlug)}">${r.title}</a>` : r.title}</div>
      <div class="log-sub">${[r.artist, [r.city, r.venue].filter(Boolean).join(' · ')].filter(Boolean).join(' — ')}</div>
      <div class="row" style="gap:6px;margin-top:6px">
        <span class="pill ${r.kind === 'festival' ? 'pill-accent' : 'pill-soft'}">${KIND_LABEL[r.kind]}</span>
        ${r.isVisit ? html`<span class="pill pill-visit">내한</span>` : ''}
        ${stars(r.rating)}
      </div>
      ${r.memo ? html`<p class="log-memo">“${r.memo}”</p>` : ''}
    </div>
    <div class="log-actions">
      <a class="icon-btn" href="#/log?${new URLSearchParams({ y: year, edit: r.id })}" aria-label="${r.title} 기록 고치기">${icon('edit', 18)}</a>
      <button type="button" class="icon-btn" data-action="delete" data-id="${r.id}" aria-label="${r.title} 기록 지우기">${icon('trash', 18)}</button>
    </div>
  </li>`;

  const form = html`<div class="card log-form" id="log-form">
    <div class="row between"><h2>${editing ? '기록 고치기' : '공연 기록하기'}</h2><a class="icon-btn" href="#/log?y=${year}" aria-label="닫기">${icon('x', 18)}</a></div>
    ${!editing ? html`<div class="field">
      <label for="log-pick">셋리뷰에 있는 공연에서 고르기</label>
      <select id="log-pick" class="select" data-change="pick">
        <option value="new" ${!pickEv ? 'selected' : ''}>직접 입력할게요</option>
        ${pickable.map((e) => html`<option value="${e.slug}" ${pickEv?.id === e.id ? 'selected' : ''}>${kstDate(e.startsAt)} · ${e.title}</option>`)}
      </select>
    </div>` : ''}
    <form class="log-grid" data-form="save" novalidate>
      <input type="hidden" name="id" value="${editing?.id || ''}">
      <input type="hidden" name="eventId" value="${f.eventId || ''}">
      <div class="field span-2"><label for="lf-title">공연 이름</label>
        <input id="lf-title" class="input" name="title" value="${f.title || ''}" maxlength="120" required placeholder="예: 여름 록 페스티벌 2026"></div>
      <div class="field"><label for="lf-date">다녀온 날</label>
        <input id="lf-date" class="input" type="date" name="date" value="${f.date || ''}" max="${todayKst()}" required></div>
      <div class="field"><label for="lf-kind">종류</label>
        <select id="lf-kind" class="select" name="kind">
          <option value="concert" ${f.kind !== 'festival' ? 'selected' : ''}>단독 공연</option>
          <option value="festival" ${f.kind === 'festival' ? 'selected' : ''}>페스티벌</option>
        </select></div>
      <div class="field span-2"><label for="lf-artist">아티스트</label>
        <input id="lf-artist" class="input" name="artist" value="${f.artist || ''}" maxlength="120" placeholder="여러 팀이면 쉼표로 나눠 주세요"></div>
      <div class="field"><label for="lf-venue">공연장</label>
        <input id="lf-venue" class="input" name="venue" value="${f.venue || ''}" maxlength="80"></div>
      <div class="field"><label for="lf-city">도시</label>
        <input id="lf-city" class="input" name="city" value="${f.city || ''}" maxlength="40"></div>
      <div class="field"><label for="lf-rating">별점</label>
        <select id="lf-rating" class="select" name="rating">
          <option value="">선택 안 함</option>
          ${[5, 4, 3, 2, 1].map((n) => html`<option value="${n}" ${Number(f.rating) === n ? 'selected' : ''}>${'★'.repeat(n)} (${n}점)</option>`)}
        </select></div>
      <label class="check field-check"><input type="checkbox" name="isVisit" ${f.isVisit ? 'checked' : ''}> 해외 아티스트 내한 공연</label>
      <div class="field span-2"><label for="lf-memo">한 줄 메모</label>
        <textarea id="lf-memo" class="textarea" name="memo" maxlength="500" rows="2" placeholder="그날 가장 기억에 남는 순간">${f.memo || ''}</textarea></div>
      <div class="row span-2"><button class="btn btn-primary" type="submit">${editing ? '고친 내용 저장' : '기록 저장'}</button>
        <a class="btn btn-ghost" href="#/log?y=${year}">취소</a></div>
    </form>
  </div>`;

  return {
    title: '내 기록',
    html: html`<div class="container">
      <section class="section log-head">
        <div class="stack" style="gap:2px">
          <span class="serif-kicker">my live archive</span>
          <h1>내 공연 기록</h1>
          <p class="muted">다녀온 콘서트와 페스티벌을 연도별로 모아 봐요.</p>
        </div>
        ${!showForm ? html`<a class="btn btn-primary" href="#/log?${new URLSearchParams({ y: year, add: 'new' })}">${icon('plus', 18)} 기록 추가</a>` : ''}
      </section>

      ${showForm ? form : ''}

      ${suggest.length && !showForm ? html`<div class="card suggest">
        <strong>다녀오셨나요?</strong>
        <span class="muted small">담아 둔 공연이 끝났어요. 눌러서 바로 기록해 보세요.</span>
        <div class="row" style="gap:8px">${suggest.map((e) => html`<button type="button" class="btn btn-soft btn-sm" data-action="quick-add" data-slug="${e.slug}">${icon('check', 16)} ${e.title}</button>`)}</div>
      </div>` : ''}

      ${records.length ? html`
        <nav class="year-tabs" aria-label="연도">
          ${years.map((y) => html`<a class="year-tab ${year === y ? 'active' : ''}" href="#/log?y=${y}" ${year === y ? html`aria-current="page"` : ''}>${y}<span>${records.filter((r) => r.date.startsWith(y)).length}</span></a>`)}
          ${years.length > 1 ? html`<a class="year-tab ${year === 'all' ? 'active' : ''}" href="#/log?y=all" ${year === 'all' ? html`aria-current="page"` : ''}>전체<span>${records.length}</span></a>` : ''}
        </nav>

        <section class="log-stats" aria-label="${year === 'all' ? '전체' : `${year}년`} 요약">
          <div class="lstat lstat-big"><span class="lstat-n">${stats.total}</span><span class="lstat-l">${year === 'all' ? '지금까지 다녀온 공연' : `${year}년에 다녀온 공연`}</span></div>
          <div class="lstat"><span class="lstat-n">${stats.festival}</span><span class="lstat-l">페스티벌</span></div>
          <div class="lstat"><span class="lstat-n">${stats.visit}</span><span class="lstat-l">내한 공연</span></div>
          <div class="lstat"><span class="lstat-n">${stats.artists}</span><span class="lstat-l">만난 아티스트</span></div>
          <div class="lstat"><span class="lstat-n">${stats.venues}</span><span class="lstat-l">공연장</span></div>
        </section>
        ${topArtist || topVenue ? html`<p class="small muted log-top">
          ${topArtist ? html`가장 많이 본 아티스트 <strong class="accent">${topArtist.name}</strong> (${topArtist.n}번)` : ''}
          ${topArtist && topVenue ? ' · ' : ''}
          ${topVenue ? html`가장 자주 간 곳 <strong class="accent">${topVenue.name}</strong> (${topVenue.n}번)` : ''}
        </p>` : ''}

        <section class="card bars-card" aria-label="${year === 'all' ? '연도별' : '월별'} 공연 수">
          <div class="bars ${year === 'all' ? 'bars-years' : ''}">
            ${bars.map((b) => {
              const inner = html`<span class="bar-n">${b.n || ''}</span><span class="bar-track"><span class="bar" style="height:${b.n ? Math.max(10, Math.round((b.n / maxBar) * 100)) : 3}%"></span></span><span class="bar-l">${b.label}</span>`;
              return b.href ? html`<a class="bar-col" href="${b.href}" aria-label="${b.label}년 ${b.n}회">${inner}</a>` : html`<div class="bar-col ${b.n ? '' : 'is-empty'}" aria-label="${b.label} ${b.n}회">${inner}</div>`;
            })}
          </div>
        </section>

        ${groups.map((g) => html`<section class="log-group">
          <h2 class="log-group-title">${g.label} <span class="faint small">${g.items.length}회</span></h2>
          <ol class="log-list">${g.items.map(card)}</ol>
        </section>`)}
        ${!scope.length ? html`<div class="card"><p class="muted">${year}년 기록이 아직 없어요.</p></div>` : ''}
      ` : !showForm ? emptyState('아직 기록한 공연이 없어요', '다녀온 콘서트와 페스티벌을 남겨 두면 연도별로 한눈에 모아 볼 수 있어요.', html`<a class="btn btn-primary" href="#/log?add=new">${icon('plus', 18)} 첫 기록 남기기</a>`) : ''}
    </div>
    ${footer()}`,

    mount(root) {
      if (showForm) root.querySelector('#log-form')?.scrollIntoView({ block: 'start' });
      if (already) {
        toast('이미 기록한 공연이에요. 고칠 수 있게 열어 드릴게요.');
        navigate('/log', { y: already.date.slice(0, 4), edit: already.id }, { replace: true });
      }
    },

    changes: {
      pick(el) { navigate('/log', { y: year, add: el.value }, { replace: true }); },
    },

    forms: {
      async save(fd) {
        const input = Object.fromEntries(fd);
        input.isVisit = fd.get('isVisit') === 'on';
        if (!String(input.title || '').trim()) throw new UserError('공연 이름을 적어 주세요.');
        if (!input.date) throw new UserError('다녀온 날을 골라 주세요.');
        if (input.date > todayKst()) throw new UserError('앞으로 갈 공연은 "내 공연"에 담아 주세요.');
        await api.saveAttendance(input);
        toast(input.id ? '기록을 고쳤어요.' : '기록했어요.', 'ok');
        navigate('/log', { y: input.date.slice(0, 4) });
      },
    },

    actions: {
      async 'quick-add'(el) {
        const ev = events.find((e) => e.slug === el.dataset.slug);
        if (!ev) return;
        await api.saveAttendance(fromEvent(ev));
        toast('기록했어요. 별점과 메모는 연필 버튼으로 남길 수 있어요.', 'ok');
        navigate('/log', { y: kstDate(ev.startsAt).slice(0, 4) });
      },
      async delete(el) {
        const r = records.find((x) => x.id === el.dataset.id);
        if (!r || !confirm(`'${r.title}' 기록을 지울까요?`)) return;
        await api.deleteAttendance(r.id);
        toast('기록을 지웠어요.');
        ctx.rerender();
      },
    },
  };
}
