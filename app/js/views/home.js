// 공연 찾기 (홈)
import { html, toast } from '../util.js';
import { eventCard, emptyState, ticketInfo } from '../components.js';
import { fmtDate, fmtTime } from '../util.js';
import { icon } from '../icons.js';
import { navigate } from '../router.js';
import { footer } from './footer.js';
import { artistIndex, matchEvents, seenFrom, norm, eventHasKey } from '../taste.js';

const TABS = [
  { id: 'all', label: '전체' },
  { id: 'live', label: 'LIVE' },
  { id: 'upcoming', label: '다가오는 공연' },
  { id: 'ended', label: '지난 공연' },
];

const KINDS = [
  { id: 'all', label: '전체' },
  { id: 'festival', label: '페스티벌' },
  { id: 'visit', label: '내한 공연' },
];

// 날짜순 목록을 월별로 묶어요 (진행 중 · 다가오는 공연만, 지난 공연은 한 묶음)
function monthGroups(list) {
  const out = [];
  for (const e of list) {
    const key = e.status === 'ended' ? 'ended' : e.status === 'live' ? 'live' : new Date(Date.parse(e.startsAt) + 9 * 3600000).toISOString().slice(0, 7);
    let g = out[out.length - 1];
    if (!g || g.key !== key) {
      const label = key === 'ended' ? '지난 공연' : key === 'live' ? '지금 진행 중' : `${key.slice(0, 4)}년 ${Number(key.slice(5))}월`;
      out.push(g = { key, label, items: [] });
    }
    g.items.push(e);
  }
  return out;
}

export default async function home(ctx) {
  const { api, state, query } = ctx;
  const events = await api.listEvents();
  const q = (query.q || '').trim().toLowerCase();
  const tab = TABS.some((t) => t.id === query.tab) ? query.tab : 'all';

  const kind = KINDS.some((k) => k.id === query.kind) ? query.kind : 'all';
  // 검색: 띄어쓰기·대소문자 무시, 아티스트 한글/영문 이름과 다른 표기까지 함께 찾아요 ("마룬 파이브" → Maroon 5)
  let qKeys = [];
  if (q) {
    const nq = norm(q);
    qKeys = nq ? [nq] : [];
    const catalog = nq.length >= 2 ? await api.listArtists().catch(() => []) : [];
    for (const a of catalog) {
      const keys = [a.name, a.nameKo, ...(a.aliases || [])].map(norm).filter((k) => k.length >= 2);
      if (keys.some((k) => k === nq || (nq.length >= 3 && (k.includes(nq) || nq.includes(k))))) qKeys.push(...keys);
    }
    qKeys = [...new Set(qKeys)];
  }
  const matches = (e) => {
    if (!q) return true;
    const hay = norm([e.title, e.venue, e.city, e.lineup, ...e.artists].join(' '));
    // 직접 친 검색어는 그대로 찾고, 아티스트 다른 이름으로 넓힌 짧은 이름(TS 등)은 단어 단위로만 맞춰요
    return hay.includes(qKeys[0] || '\u0000') || qKeys.slice(1).some((k) => eventHasKey(e, k)) || [e.title, e.venue, e.city].join(' ').toLowerCase().includes(q);
  };
  const kindOk = (k) => (e) => (k === 'festival' ? e.kind === 'festival' : k === 'visit' ? e.isVisit : true);
  const searched = events.filter(matches);
  const filtered = searched.filter(kindOk(kind));
  const qs = (extra) => new URLSearchParams(Object.entries({ q: query.q, tab: query.tab, kind: query.kind, ...extra }).filter(([, v]) => v && v !== 'all')).toString();
  const byTab = {
    all: filtered,
    live: filtered.filter((e) => e.status === 'live'),
    upcoming: filtered.filter((e) => e.status === 'upcoming'),
    ended: filtered.filter((e) => e.status === 'ended'),
  };
  const order = { live: 0, upcoming: 1, ended: 2 };
  const list = [...byTab[tab]].sort((a, b) =>
    order[a.status] - order[b.status] ||
    (a.status === 'ended' ? b.startsAt.localeCompare(a.startsAt) : a.startsAt.localeCompare(b.startsAt)));
  const live = events.filter((e) => e.status === 'live');

  // 곧 티켓이 열리는 공연 (30일 안)
  const soonTickets = q ? [] : events
    .filter((e) => e.ticketOpenAt && e.status !== 'ended' && Date.parse(e.ticketOpenAt) > Date.now() && Date.parse(e.ticketOpenAt) < Date.now() + 30 * 86400000)
    .sort((a, b) => a.ticketOpenAt.localeCompare(b.ticketOpenAt)).slice(0, 6);

  // 내 취향 공연 (로그인했을 때)
  let picks = null;
  if (state.session && !q) {
    const [t, artists, records] = await Promise.all([api.getTaste(), api.listArtists(), api.listAttendances()]).catch(() => [null, [], []]);
    if (t) {
      const idx = artistIndex(artists);
      const seen = seenFrom(records, events, idx).artists.map((a) => a.name);
      picks = { hasTaste: t.favorites.length + t.genres.length > 0, list: matchEvents(events, { favorites: t.favorites, genres: t.genres, seen }, idx).slice(0, 6) };
    }
  }
  const name = state.session?.nickname;

  return {
    title: '공연 찾기',
    html: html`
      <section class="home-hero">
        <img class="bg" src="/assets/img/hero.jpg" alt="" fetchpriority="high">
        <div class="container">
          <span class="serif-kicker">${name ? `hi, ${name}` : 'tonight, every song is yours.'}</span>
          <h1>내가 갈 공연의<br><em>셋리스트</em>를 먼저 만나요</h1>
          <form class="search" role="search" data-form="search">
            <label class="sr-only" for="q">공연·아티스트 검색</label>
            <input id="q" name="q" class="input" type="search" placeholder="공연·아티스트·도시 검색" value="${query.q || ''}" autocomplete="off">
            <button class="btn btn-primary" type="submit">${icon('search', 18)}<span class="hide-sm">검색</span></button>
          </form>
        </div>
      </section>

      <div class="container">
        ${live.length && tab !== 'live' ? html`<div class="section" style="padding-bottom:0">
          ${live.map((e) => html`<a class="live-strip" href="#/e/${encodeURIComponent(e.slug)}">
            <span class="pill pill-live"><span class="dot" aria-hidden="true"></span>LIVE</span>
            <span class="grow"><strong>${e.title}</strong><span class="muted small">지금 무대에서 부르는 곡을 실시간으로 확인하세요</span></span>
            ${icon('chevron', 20)}
          </a>`)}
        </div>` : ''}

        ${soonTickets.length ? html`<section class="section" style="padding-bottom:0">
          <div class="section-title"><div class="stack" style="gap:2px"><span class="serif-kicker">ticket alarm</span><h2>곧 티켓 오픈</h2></div></div>
          <ol class="ticket-list">${soonTickets.map((e) => { const t = ticketInfo(e); return html`<li><a class="ticket-row ${t.soon ? 'soon' : ''}" href="#/e/${encodeURIComponent(e.slug)}">
            <span class="ticket-when"><strong>${new Date(Date.parse(e.ticketOpenAt) + 9 * 3600000).toISOString().slice(5, 10).replace('-', '.')}</strong><span>${fmtDate(e.ticketOpenAt, { month: undefined, day: undefined })} ${fmtTime(e.ticketOpenAt)}</span></span>
            <span class="ticket-main"><strong>${e.title}</strong><span class="small muted">${fmtDate(e.startsAt)} 공연 · ${[e.city, e.venue].filter(Boolean).join(' ')}</span></span>
            <span class="pill ${t.soon ? 'pill-accent' : 'pill-soft'}">${t.label}</span>
          </a></li>`; })}</ol>
        </section>` : ''}

        ${picks ? html`<section class="section" style="padding-bottom:0">
          <div class="section-title">
            <div class="stack" style="gap:2px"><span class="serif-kicker">picked for you</span><h2>내 취향 공연</h2></div>
            <a class="btn btn-outline btn-sm" href="#/taste">${icon('star', 16)} 취향 설정</a>
          </div>
          ${picks.list.length ? html`<div class="grid">${picks.list.map((m) => eventCard(m.ev, { followed: state.follows.has(m.ev.id), note: m.reason }))}</div>`
            : html`<div class="card taste-cta"><div class="stack" style="gap:4px">
                <strong>${picks.hasTaste ? '지금은 취향에 맞는 다가오는 공연이 없어요' : '좋아하는 아티스트와 장르를 알려 주세요'}</strong>
                <span class="muted small">${picks.hasTaste ? '새 공연이 올라오면 알림함으로 알려 드릴게요.' : '맞는 공연과 페스티벌을 골라 보여 주고, 새로 올라오면 알려 드려요.'}</span></div>
                <a class="btn btn-primary btn-sm" href="#/taste">${picks.hasTaste ? '취향 더 등록하기' : '취향 등록하기'}</a></div>`}
        </section>` : ''}

        <section class="section">
          <div class="section-title">
            <h2>${q ? `‘${query.q}’ 검색 결과` : '공연 둘러보기'}</h2>
            <div class="tabs" role="tablist" aria-label="공연 상태">
              ${TABS.map((t) => html`<a class="tab ${tab === t.id ? 'active' : ''}" role="tab" aria-selected="${tab === t.id ? 'true' : 'false'}"
                  href="#/?${qs({ tab: t.id })}">
                ${t.label}<span class="count">${byTab[t.id].length}</span></a>`)}
            </div>
          </div>
          <div class="chips" role="group" aria-label="공연 종류">
            ${KINDS.map((k) => html`<a class="chip ${kind === k.id ? 'active' : ''}" href="#/?${qs({ kind: k.id })}" ${kind === k.id ? html`aria-current="true"` : ''}>
              ${k.label}<span class="count">${searched.filter(kindOk(k.id)).length}</span></a>`)}
          </div>
          ${list.length
            ? monthGroups(list).map((g) => html`<div class="month-block">
                ${g.label ? html`<h3 class="month-head">${g.label} <span class="faint small">${g.items.length}개</span></h3>` : ''}
                <div class="grid">${g.items.map((e) => eventCard(e, { followed: state.follows.has(e.id) }))}</div>
              </div>`)
            : emptyState(q ? '찾는 공연이 없어요' : '아직 등록된 공연이 없어요', q ? '다른 이름이나 도시로 검색해 보세요. 새로 발표된 공연이면 제보해 주세요.' : '곧 새로운 공연이 올라올 거예요.', html`${q ? html`<a class="btn btn-outline" href="#/">전체 공연 보기</a> ` : ''}<a class="btn btn-primary" href="#/submit">공연 제보하기</a>`)}
          <div class="card submit-cta">
            <span><strong>발표됐는데 아직 없는 공연이 있나요?</strong> <span class="muted small">공지 링크와 함께 알려 주시면 확인하고 바로 올려 드려요.</span></span>
            <a class="btn btn-outline btn-sm" href="#/submit">${icon('plus', 16)} 공연 제보하기</a>
          </div>
        </section>
      </div>
      ${footer()}`,

    forms: {
      search(fd) {
        const v = String(fd.get('q') || '').trim();
        navigate('/', { q: v, tab: query.tab, kind: query.kind });
      },
    },

    actions: {
      async 'toggle-follow'(el) {
        if (!state.session) {
          sessionStorage.setItem('sr-return', location.hash || '#/');
          toast('로그인하면 내 공연에 담을 수 있어요.');
          return navigate('/login');
        }
        const id = el.dataset.id;
        if (state.follows.has(id)) {
          await api.unfollow(id);
          state.follows.delete(id);
          toast('내 공연에서 뺐어요.');
        } else {
          await api.follow(id);
          state.follows.add(id);
          toast('내 공연에 담았어요.', 'ok');
        }
        ctx.rerender();
      },
    },
  };
}
