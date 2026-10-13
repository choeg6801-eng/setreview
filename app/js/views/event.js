// 공연 상세: 예상 셋리스트 · 하이라이트/떼창 구간 · 실시간 싱크 · 제보
import { html, toast, fmtDate, fmtTime, dday, parseMmss, timeAgo, UserError } from '../util.js';
import { songRow, statusPill, progressBar, art, backLink, emptyState, KIND_LABEL, linksRow } from '../components.js';
import { icon } from '../icons.js';
import { premium } from '../state.js';
import { navigate } from '../router.js';
import { spotifyEnabled, getToken, connectSpotify, takePending, savePlaylist } from '../spotify.js';
import { footer } from './footer.js';

const openSongs = new Set();
const savedLinks = new Map(); // performanceId:which → Spotify 주소

const norm = (s) => String(s || '').trim().toLowerCase();

function requireLogin(msg = '로그인이 필요해요.') {
  sessionStorage.setItem('sr-return', location.hash || '#/');
  toast(msg);
  navigate('/login');
}

export default async function eventView(ctx) {
  const { api, state, params } = ctx;
  const ev = await api.getEventBySlug(params.slug);
  if (!ev) {
    return {
      title: '공연 없음',
      html: html`<section class="container narrow">${emptyState('공연을 찾을 수 없어요', '주소가 바뀌었거나 비공개로 바뀐 공연이에요.', html`<a class="btn btn-primary" href="#/">공연 목록으로</a>`)}</section>`,
    };
  }

  const prem = premium();
  const loggedIn = !!state.session;
  const followed = state.follows.has(ev.id);
  const allPredicted = [...new Set(ev.performances.flatMap((p) => p.predicted.map((i) => i.song?.id).filter(Boolean)))];
  const done = allPredicted.filter((id) => state.progress.has(id)).length;

  function perfBlock(p) {
    const predictedIds = new Set(p.predicted.map((i) => i.song?.id).filter(Boolean));
    const predictedTitles = new Set(p.predicted.map((i) => norm(i.title)));
    const playedIds = new Set(p.actual.map((i) => i.song?.id).filter(Boolean));
    const playedTitles = new Set(p.actual.map((i) => norm(i.title)));
    const isLive = p.status === 'live';
    const hasActual = p.actual.length > 0;
    const now = isLive && hasActual ? p.actual[p.actual.length - 1] : null;
    const wasPlayed = (it) => (it.song ? playedIds.has(it.song.id) : playedTitles.has(norm(it.title)));
    const isSurprise = (it) => !(it.song ? predictedIds.has(it.song.id) : predictedTitles.has(norm(it.title)));
    const rowOpts = (it, no, extra = {}) => ({
      no, open: openSongs.has(it.id), premium: prem, progress: state.progress, canCheck: loggedIn,
      loggedIn, artistName: p.artist.name, performanceId: p.id, allowChantReport: true, ...extra,
    });

    const predictedState = (it) => {
      if (now && (it.song ? it.song.id === now.song?.id : norm(it.title) === norm(now.title))) return 'now';
      if (isLive || p.status === 'ended') return wasPlayed(it) ? 'played' : (p.status === 'ended' ? 'skipped' : '');
      return '';
    };
    const remaining = p.predicted.filter((it) => !wasPlayed(it));
    const savedKey = (w) => savedLinks.get(`${p.id}:${w}`);

    return html`<section class="perf" aria-labelledby="perf-${p.id}">
      <div class="perf-head">
        <h2 id="perf-${p.id}">${p.artist.name}</h2>
        ${isLive ? html`<span class="pill pill-live"><span class="dot" aria-hidden="true"></span>LIVE</span>` : p.status === 'ended' ? html`<span class="pill pill-muted">공연 끝</span>` : ''}
        <span class="meta">${[p.stage, p.startsAt ? `${fmtTime(p.startsAt)}${p.endsAt ? '–' + fmtTime(p.endsAt) : ''}` : ''].filter(Boolean).join(' · ')}</span>
        <div class="perf-actions">
          ${(p.status === 'ended' || (hasActual && !isLive)) ? html`<a class="btn btn-soft btn-sm" href="#/recap/${encodeURIComponent(ev.slug)}/${encodeURIComponent(p.id)}">${icon('share', 16)} 복습 카드 만들기</a>` : ''}
          <button type="button" class="btn btn-outline btn-sm" data-action="spotify-save" data-perf="${p.id}" data-which="${hasActual && !isLive ? 'actual' : 'predicted'}">
            ${icon('music', 16)} Spotify에 저장 <span class="pill pill-soft">베타</span>
          </button>
        </div>
      </div>

      ${savedKey(hasActual && !isLive ? 'actual' : 'predicted') ? html`<div class="notice" style="margin-bottom:14px">
        Spotify 플레이리스트를 만들었어요. <a href="${savedKey(hasActual && !isLive ? 'actual' : 'predicted')}" target="_blank" rel="noopener">Spotify에서 열기 ${icon('external', 13)}</a>
      </div>` : ''}

      ${isLive ? html`<div class="live-panel" aria-live="polite">
        ${now ? html`<div class="now-card">
          ${art(now.song?.albumArtUrl, '', 84)}
          <div class="stack" style="gap:4px;min-width:0">
            <span class="now-label"><span class="dot" aria-hidden="true"></span>NOW PLAYING · ${now.position}번째 곡</span>
            <span class="now-title">${now.title}</span>
            <span class="live-meta">${timeAgo(now.playedAt)} 시작 · 지금까지 ${p.actual.length}곡</span>
          </div>
        </div>` : html`<p class="muted">곧 공연이 시작돼요. 첫 곡이 확인되면 바로 알려드릴게요.</p>`}
        ${remaining.length ? html`<p class="small muted">다음 예상 곡: <strong class="accent">${remaining[0].title}</strong>${remaining[1] ? html` → ${remaining[1].title}` : ''}</p>` : ''}
        <div class="report-box">
          <strong class="small">현장에 계신가요? 지금 부르는 곡을 알려 주세요</strong>
          ${loggedIn ? html`<form class="inline-form" data-form="now-report">
            <input type="hidden" name="performanceId" value="${p.id}">
            <label class="sr-only" for="now-${p.id}">지금 부르는 곡</label>
            <select id="now-${p.id}" name="songId" class="select input-sm" style="flex:1 1 200px;width:auto">
              ${remaining.filter((it) => it.song).map((it) => html`<option value="${it.song.id}">${it.title}</option>`)}
              <option value="">목록에 없는 곡 (직접 입력)</option>
            </select>
            <label class="sr-only" for="now-title-${p.id}">곡 이름 직접 입력</label>
            <input id="now-title-${p.id}" name="title" class="input input-sm" placeholder="직접 입력 (목록에 없을 때)" autocomplete="off">
            <button class="btn btn-primary btn-sm" type="submit">${icon('live', 16)} 제보하기</button>
          </form>` : html`<a class="btn btn-outline btn-sm" href="#/login" data-action="go-login">로그인하고 제보하기</a>`}
        </div>
      </div>` : ''}

      ${hasActual ? html`<div class="setlist-card" style="margin-bottom:16px">
        <div class="setlist-head">
          <h3>${isLive ? '지금까지 부른 곡' : '실제 셋리스트'} <span class="muted small">· ${p.actual.length}곡</span></h3>
          <span class="legend"><span><span class="badge badge-surprise">깜짝 곡</span> 예상에 없던 곡</span></span>
        </div>
        <ol class="songs">
          ${p.actual.map((it, i) => songRow(it, rowOpts(it, i + 1, {
            state: now && it.id === now.id ? 'now' : '',
            surprise: isSurprise(it),
            time: it.playedAt ? fmtTime(it.playedAt) : '',
          })))}
        </ol>
      </div>` : ''}

      ${p.predicted.length ? html`<div class="setlist-card">
        <div class="setlist-head">
          <h3>${hasActual ? '예상했던 셋리스트' : '예상 셋리스트'} <span class="muted small">· ${p.predicted.length}곡</span></h3>
          ${prem ? html`<span class="legend">
            <span><span class="seg-dot highlight" aria-hidden="true"></span>하이라이트</span>
            <span><span class="seg-dot chant" aria-hidden="true"></span>떼창 구간</span>
          </span>` : html`<a class="small" href="#/membership">${icon('lock', 14)} 떼창 지수 보기</a>`}
        </div>
        <ol class="songs">
          ${p.predicted.map((it, i) => songRow(it, rowOpts(it, i + 1, { state: predictedState(it) })))}
        </ol>
      </div>` : (!hasActual ? html`<div class="card"><p class="muted">예상 셋리스트를 준비하고 있어요.</p></div>` : '')}
    </section>`;
  }

  return {
    title: ev.title,
    html: html`
      <section class="ev-hero">
        ${ev.coverUrl ? html`<img class="bg" src="${ev.coverUrl}" alt="">` : ''}
        <div class="container">
          ${backLink('#/', '공연 목록')}
          <div class="row">${statusPill(ev)}<span class="pill pill-glass">${KIND_LABEL[ev.kind] || ''}</span></div>
          <h1>${ev.title}</h1>
          <div class="ev-facts">
            <span>${icon('calendar', 16)} ${fmtDate(ev.startsAt)} ${fmtTime(ev.startsAt)}${ev.status === 'upcoming' ? ` · ${dday(ev.startsAt)}` : ''}</span>
            <span>${icon('pin', 16)} ${[ev.city, ev.venue].filter(Boolean).join(' · ') || '장소 미정'}</span>
          </div>
          ${ev.description ? html`<p class="muted" style="max-width:680px">${ev.description}</p>` : ''}
          <div class="row">
            <button type="button" class="btn ${followed ? 'btn-soft' : 'btn-primary'}" data-action="toggle-follow" aria-pressed="${followed ? 'true' : 'false'}">
              ${followed ? html`${icon('check', 18)} 내 공연에 담음` : html`${icon('plus', 18)} 내 공연에 담기`}
            </button>
            <button type="button" class="btn btn-outline" data-action="share">${icon('share', 18)} 공유</button>
          </div>
          ${allPredicted.length ? html`<div class="ev-progress">
            <span class="small">${loggedIn ? '나의 예습 진행률' : '로그인하면 곡마다 예습 완료를 체크할 수 있어요'}</span>
            <span class="mono small accent">${loggedIn ? `${done} / ${allPredicted.length}곡` : ''}</span>
            ${loggedIn ? progressBar(done, allPredicted.length) : ''}
          </div>` : ''}
        </div>
      </section>
      <div class="container">
        ${ev.performances.length ? ev.performances.map(perfBlock) : html`<div class="card" style="margin-top:24px"><p class="muted">출연진을 준비하고 있어요.</p></div>`}
        ${!prem ? html`<div class="card" style="margin-top:28px">
          <div class="row between">
            <div class="stack" style="gap:4px">
              <h3>6분짜리 곡도 핵심만, 떼창 타이밍까지</h3>
              <p class="muted small">멤버십이면 곡마다 하이라이트와 떼창 구간, 떼창 지수를 볼 수 있어요.</p>
            </div>
            <a class="btn btn-primary" href="#/membership">멤버십 알아보기</a>
          </div>
        </div>` : ''}
      </div>
      ${footer()}`,

    actions: {
      'toggle-song'(el) {
        const id = el.dataset.id;
        openSongs.has(id) ? openSongs.delete(id) : openSongs.add(id);
        ctx.rerender();
      },
      async 'toggle-progress'(el) {
        if (!loggedIn) return requireLogin('로그인하면 예습 진행을 기록할 수 있어요.');
        const id = el.dataset.song;
        const on = !state.progress.has(id);
        await api.setProgress(id, on);
        on ? state.progress.add(id) : state.progress.delete(id);
        ctx.rerender();
      },
      async 'toggle-follow'() {
        if (!loggedIn) return requireLogin('로그인하면 내 공연에 담을 수 있어요.');
        if (state.follows.has(ev.id)) {
          await api.unfollow(ev.id);
          state.follows.delete(ev.id);
          toast('내 공연에서 뺐어요.');
        } else {
          await api.follow(ev.id);
          state.follows.add(ev.id);
          toast('내 공연에 담았어요. 공연 전까지 예습 진행률을 챙겨 드릴게요.', 'ok');
        }
        ctx.rerender();
      },
      async share() {
        const url = location.href;
        if (navigator.share) {
          try { await navigator.share({ title: ev.title, text: `${ev.title} 예상 셋리스트 · 셋리뷰`, url }); return; } catch { /* 취소 */ }
        }
        await navigator.clipboard?.writeText(url);
        toast('공연 주소를 복사했어요.', 'ok');
      },
      'go-login'() { requireLogin('로그인하고 제보해 주세요.'); },
      async 'spotify-save'(el) {
        const p = ev.performances.find((x) => x.id === el.dataset.perf);
        const which = el.dataset.which;
        if (!loggedIn) return requireLogin('로그인하고 Spotify에 저장해 보세요.');
        if (!prem) { toast('Spotify 저장은 멤버십 기능이에요.'); return navigate('/membership'); }
        if (!spotifyEnabled()) {
          toast('Spotify 저장은 베타 테스터에게 먼저 열려 있어요. 지금은 곡마다 Spotify 링크로 열어 주세요.');
          return;
        }
        if (!getToken()) return connectSpotify({ slug: ev.slug, perf: p.id, which });
        await runSave(p, which);
      },
    },

    forms: {
      async 'chant-report'(fd, form) {
        if (!loggedIn) return requireLogin();
        const at = parseMmss(fd.get('at'));
        if (at == null) throw new UserError('떼창이 시작되는 시간을 3:05 처럼 적어 주세요.');
        await api.submitReport({ performanceId: fd.get('performanceId'), kind: 'chant', songId: fd.get('songId'), atSec: at });
        form.reset();
        toast('떼창 구간 제보 고마워요! 확인 후 반영할게요.', 'ok');
      },
      async 'now-report'(fd, form) {
        if (!loggedIn) return requireLogin();
        const title = String(fd.get('title') || '').trim();
        const songId = title ? null : fd.get('songId') || null;
        if (!songId && !title) throw new UserError('곡을 고르거나 곡 이름을 적어 주세요.');
        await api.submitReport({ performanceId: fd.get('performanceId'), kind: 'now_playing', songId, title });
        form.reset();
        toast('제보 고마워요! 운영자가 확인하면 바로 반영돼요.', 'ok');
      },
    },

    mount() {
      const flash = sessionStorage.getItem('sr-flash');
      if (flash) { sessionStorage.removeItem('sr-flash'); toast(flash); }

      // Spotify 로그인 후 돌아왔으면 하던 저장을 이어서 해요
      const pending = takePending();
      if (pending && pending.slug === ev.slug && getToken()) {
        const p = ev.performances.find((x) => x.id === pending.perf);
        if (p) runSave(p, pending.which).catch((e) => toast(e.userMessage || e.message, 'error'));
      }

      // 실시간 업데이트 + 혹시 몰라 30초마다 새로고침
      const unsub = api.subscribe(ev.id, () => ctx.rerender());
      const anyLive = ev.performances.some((p) => p.status === 'live') || ev.status === 'live';
      const timer = anyLive ? setInterval(() => ctx.rerender(), 30000) : null;
      return () => { unsub?.(); if (timer) clearInterval(timer); };
    },
  };

  async function runSave(p, which) {
    const items = which === 'actual' ? p.actual : p.predicted;
    const tracks = items.map((it) => ({ title: it.song?.title || it.title, artistName: p.artist.name, spotifyId: it.song?.spotifyId }))
      .filter((t) => !/^\[.*\]$/.test(t.title));
    const name = `${ev.title} · ${p.artist.name}${which === 'actual' ? ' (실제 셋리스트)' : ' (예상 셋리스트)'}`;
    const result = await savePlaylist(
      { name: name.slice(0, 100), description: '셋리뷰에서 만든 셋리스트 플레이리스트', tracks },
      (msg) => toast(msg)
    );
    savedLinks.set(`${p.id}:${which}`, result.url);
    toast(`Spotify에 ${result.added}곡을 저장했어요${result.missing.length ? ` (못 찾은 곡 ${result.missing.length}개)` : ''}.`, 'ok');
    ctx.rerender();
  }
}

// 다른 화면에서도 쓰도록 내보내요
export { linksRow };
