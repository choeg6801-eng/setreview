// 공연 찾기 (홈)
import { html, toast } from '../util.js';
import { eventCard, emptyState } from '../components.js';
import { icon } from '../icons.js';
import { navigate } from '../router.js';
import { footer } from './footer.js';

const TABS = [
  { id: 'all', label: '전체' },
  { id: 'live', label: 'LIVE' },
  { id: 'upcoming', label: '다가오는 공연' },
  { id: 'ended', label: '지난 공연' },
];

export default async function home(ctx) {
  const { api, state, query } = ctx;
  const events = await api.listEvents();
  const q = (query.q || '').trim().toLowerCase();
  const tab = TABS.some((t) => t.id === query.tab) ? query.tab : 'all';

  const matches = (e) => !q || [e.title, e.venue, e.city, ...e.artists].join(' ').toLowerCase().includes(q);
  const filtered = events.filter(matches);
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

        <section class="section">
          <div class="section-title">
            <h2>${q ? `‘${query.q}’ 검색 결과` : '공연 둘러보기'}</h2>
            <div class="tabs" role="tablist" aria-label="공연 상태">
              ${TABS.map((t) => html`<a class="tab ${tab === t.id ? 'active' : ''}" role="tab" aria-selected="${tab === t.id ? 'true' : 'false'}"
                  href="#/?${new URLSearchParams({ ...(query.q ? { q: query.q } : {}), ...(t.id !== 'all' ? { tab: t.id } : {}) })}">
                ${t.label}<span class="count">${byTab[t.id].length}</span></a>`)}
            </div>
          </div>
          ${list.length
            ? html`<div class="grid">${list.map((e) => eventCard(e, { followed: state.follows.has(e.id) }))}</div>`
            : emptyState(q ? '찾는 공연이 없어요' : '아직 등록된 공연이 없어요', q ? '다른 이름이나 도시로 검색해 보세요.' : '곧 새로운 공연이 올라올 거예요.', q ? html`<a class="btn btn-outline" href="#/">전체 공연 보기</a>` : '')}
        </section>
      </div>
      ${footer()}`,

    forms: {
      search(fd) {
        const v = String(fd.get('q') || '').trim();
        navigate('/', { q: v, tab: query.tab });
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
