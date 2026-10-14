// 내 취향: 좋아하는 아티스트 · 장르, 본 아티스트 · 장르, 추천 아티스트, 알림 설정
import { html, toast, fmtDate, UserError } from '../util.js';
import { emptyState } from '../components.js';
import { icon } from '../icons.js';
import { GENRES, artistIndex, seenFrom, recommendArtists, eventPeople, norm, matchEvents } from '../taste.js';
import { footer } from './footer.js';

export default async function taste(ctx) {
  const { api, state } = ctx;
  if (!state.session) {
    return {
      title: '내 취향',
      html: html`<section class="container narrow">${emptyState('로그인하고 취향을 등록해 보세요', '좋아하는 아티스트와 장르를 알려 주면 맞는 공연과 페스티벌을 골라 알려 드려요.', html`<a class="btn btn-primary" href="#/login" data-action="go-login">로그인</a>`)}</section>`,
      actions: { 'go-login'() { sessionStorage.setItem('sr-return', '#/taste'); } },
    };
  }

  const [t, artists, pairs, events, records] = await Promise.all([
    api.getTaste(), api.listArtists(), api.listArtistPairs().catch(() => []), api.listEvents(), api.listAttendances(),
  ]);
  const idx = artistIndex(artists);
  const seen = seenFrom(records, events, idx);
  const favKeys = new Set(t.favorites.map(norm));
  const isFav = (n) => favKeys.has(norm(n)) || (idx.get(norm(n))?.keys || []).some((k) => favKeys.has(k));
  const upcoming = events.filter((e) => e.status !== 'ended');
  const matched = matchEvents(events, { favorites: t.favorites, genres: t.genres, seen: seen.artists.map((a) => a.name) }, idx);
  const hasTaste = t.favorites.length + t.genres.length > 0;
  const recs = recommendArtists({
    favorites: t.favorites, seen: seen.artists.map((a) => a.name), genres: t.genres, events, artists, pairs,
  }, idx, 9);
  // 입력 자동완성: 등록된 아티스트 + 공연 출연진
  const suggestions = [...new Set([...artists.flatMap((a) => [a.name, a.nameKo].filter(Boolean)), ...events.flatMap(eventPeople)])].sort().slice(0, 600);

  async function afterChange(msg) {
    await api.refreshMyNotifications().catch(() => 0);
    state.unread = await api.countUnread().catch(() => state.unread);
    if (msg) toast(msg, 'ok');
    ctx.rerender();
  }

  const favChip = (n) => html`<span class="tchip on">${n}<button type="button" class="tchip-x" data-action="unfav" data-name="${n}" aria-label="${n} 빼기">${icon('x', 14)}</button></span>`;

  return {
    title: '내 취향',
    html: html`<div class="container">
      <section class="section log-head">
        <div class="stack" style="gap:2px">
          <span class="serif-kicker">my taste</span>
          <h1>내 취향</h1>
          <p class="muted">좋아하는 아티스트와 장르를 알려 주면 맞는 공연을 골라 알림함${t.emailAlerts ? '과 메일' : ''}로 알려 드려요.</p>
        </div>
        <a class="btn btn-outline" href="#/inbox">${icon('bell', 18)} 알림함${state.unread ? html` <span class="pill pill-accent">${state.unread}</span>` : ''}</a>
      </section>

      ${hasTaste ? html`<div class="card taste-status" role="status">
        <span>${icon('search', 18)}<span>지금 다가오는 공연 <strong>${upcoming.length}개</strong>와 비교해서 <strong class="accent">${matched.length}개</strong>가 내 취향에 맞아요.</span></span>
        ${matched.length ? html`<a class="btn btn-soft btn-sm" href="#/">홈에서 보기</a>` : html`<span class="faint small">새 공연이 올라오면 바로 비교해서 알림함으로 알려 드려요.</span>`}
      </div>` : ''}

      <div class="taste-grid">
        <section class="card stack">
          <h2>좋아하는 아티스트 <span class="faint small">${t.favorites.length}</span></h2>
          <form class="inline-form" data-form="fav">
            <label class="sr-only" for="fav-name">아티스트 이름</label>
            <input id="fav-name" class="input" name="name" list="artist-suggest" placeholder="예: Bruno Mars, 브루노 마스" autocomplete="off" maxlength="80">
            <datalist id="artist-suggest">${suggestions.map((n) => html`<option value="${n}"></option>`)}</datalist>
            <button class="btn btn-primary" type="submit">${icon('plus', 16)} 추가</button>
          </form>
          ${t.favorites.length ? html`<div class="tchips">${t.favorites.map(favChip)}</div>`
            : html`<p class="muted small">한글·영어 어느 쪽으로 적어도 돼요. 공연 제목이나 출연진에 이 이름이 나오면 알려 드려요.</p>`}
        </section>

        <section class="card stack">
          <h2>좋아하는 장르</h2>
          <div class="tchips" role="group" aria-label="좋아하는 장르">
            ${GENRES.map((g) => html`<button type="button" class="tchip ${t.genres.includes(g) ? 'on' : ''}" data-action="genre" data-genre="${g}" aria-pressed="${t.genres.includes(g) ? 'true' : 'false'}">${t.genres.includes(g) ? icon('check', 14) : ''}${g}</button>`)}
          </div>
          <p class="faint small">새로 올라온 공연 중 고른 장르와 맞는 공연을 알려 드려요.</p>
        </section>

        <section class="card stack">
          <h2>내가 본 아티스트</h2>
          ${seen.artists.length ? html`<div class="tchips">${seen.artists.slice(0, 24).map((a) => html`<span class="tchip seen">${a.name}${a.count > 1 ? html` <span class="faint">×${a.count}</span>` : ''}
              ${isFav(a.name) ? html`<span class="tchip-heart" aria-label="좋아하는 아티스트">♥</span>` : html`<button type="button" class="tchip-x" data-action="fav-quick" data-name="${a.name}" aria-label="${a.name} 좋아하는 아티스트에 추가">${icon('plus', 14)}</button>`}</span>`)}</div>`
            : html`<p class="muted small">다녀온 공연을 <a href="#/log">기록</a>하면 자동으로 모여요.</p>`}
          ${seen.genres.length ? html`<div class="stack" style="gap:6px"><span class="label">내가 본 장르</span>
            <div class="tchips">${seen.genres.map((g) => html`<span class="tchip seen">${g.genre} <span class="faint">${g.count}</span></span>`)}</div></div>` : ''}
        </section>

        <section class="card stack">
          <h2>알림 설정</h2>
          <label class="check"><input type="checkbox" data-change="alerts" name="emailAlerts" ${t.emailAlerts ? 'checked' : ''}> 좋아하는 아티스트 공연이 올라오면 바로 메일 받기</label>
          <label class="check"><input type="checkbox" data-change="alerts" name="weeklyDigest" ${t.weeklyDigest ? 'checked' : ''}> 매주 월요일 취향 공연 모아 받기</label>
          <p class="faint small">${state.session.email ? `${state.session.email}(으)로 보내요. ` : ''}알림함에는 항상 쌓여요.</p>
        </section>
      </div>

      <section class="section">
        <div class="section-title"><div class="stack" style="gap:2px"><span class="serif-kicker">you might like</span><h2>추천 아티스트</h2></div></div>
        ${recs.length ? html`<div class="rec-grid">${recs.map((r) => html`<article class="card rec">
            <div class="row between" style="flex-wrap:nowrap;gap:10px">
              <h3>${r.name}</h3>
              <button type="button" class="btn btn-soft btn-sm" data-action="fav-quick" data-name="${r.name}">${icon('plus', 14)} 좋아요</button>
            </div>
            ${r.reasons.map((x) => html`<p class="small muted">${x}</p>`)}
            ${r.genres.length ? html`<div class="row" style="gap:6px">${r.genres.map((g) => html`<span class="pill pill-soft">${g}</span>`)}</div>` : ''}
            ${r.next ? html`<a class="rec-next" href="#/e/${encodeURIComponent(r.next.slug)}">${icon('calendar', 15)} ${fmtDate(r.next.startsAt)} · ${r.next.title}</a>` : ''}
          </article>`)}</div>`
          : html`<div class="card"><p class="muted">${hasTaste
            ? '아직 비교할 아티스트 정보가 적어서 추천할 아티스트가 없어요. 공연 일정이 쌓이면 같은 무대에 선 아티스트와 같은 장르 아티스트를 추천해 드려요.'
            : '좋아하는 아티스트나 장르를 고르면 비슷한 아티스트를 추천해 드려요.'}</p></div>`}
      </section>
    </div>
    ${footer()}`,

    forms: {
      async fav(fd, form) {
        const name = String(fd.get('name') || '').trim();
        if (!name) throw new UserError('아티스트 이름을 적어 주세요.');
        await api.addFavorite(name);
        form.reset();
        await afterChange(`${name}을(를) 좋아하는 아티스트에 담았어요.`);
      },
    },
    actions: {
      async unfav(el) {
        await api.removeFavorite(el.dataset.name);
        await afterChange();
      },
      async 'fav-quick'(el) {
        await api.addFavorite(el.dataset.name);
        await afterChange(`${el.dataset.name}을(를) 좋아하는 아티스트에 담았어요.`);
      },
      async genre(el) {
        const g = el.dataset.genre;
        const next = t.genres.includes(g) ? t.genres.filter((x) => x !== g) : [...t.genres, g];
        await api.setGenres(next);
        await afterChange();
      },
    },
    changes: {
      async alerts(el) {
        const root = el.closest('.card');
        await api.setAlertPrefs({
          emailAlerts: root.querySelector('[name=emailAlerts]').checked,
          weeklyDigest: root.querySelector('[name=weeklyDigest]').checked,
        });
        toast('알림 설정을 저장했어요.', 'ok');
      },
    },
  };
}
