// 공연 상세: 예상 셋리스트 · 하이라이트/떼창 구간 · 실시간 싱크 · 제보
import { html, toast, fmtDate, fmtTime, dday, parseMmss, timeAgo, UserError } from '../util.js';
import { songRow, statusPill, progressBar, art, backLink, emptyState, KIND_LABEL, linksRow, ticketInfo } from '../components.js';
import { icon } from '../icons.js';
import { premium } from '../state.js';
import { config } from '../config.js';
import { won } from '../util.js';
import { navigate } from '../router.js';
import { spotifyEnabled, getToken, connectSpotify, takePending, savePlaylist } from '../spotify.js';
import { footer } from './footer.js';
import { checkKey } from '../api/shape.js';

const openSongs = new Set();
const openPlay = new Set(); // '예습 플리 듣기' 패널을 연 무대
const openCheck = new Set(); // '셋리스트 맞추기'를 연 무대
const CHECK_DAYS = 14; // 공연 뒤 며칠까지 관객 체크를 받는지 (서버와 같게)
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

  // 예습 플리를 다른 앱으로: 유튜브 전곡 재생 · 곡 목록 복사(다른 앱으로 옮기기) · Spotify 저장
  function playPanel(p, items, which) {
    const ids = [...new Set(items.map((it) => it.song?.youtubeId).filter(Boolean))].slice(0, 50);
    const missing = items.length - ids.length;
    const ytUrl = ids.length ? `https://www.youtube.com/watch_videos?video_ids=${ids.join(',')}` : '';
    return html`<div class="play-panel card">
      <div class="play-opt">
        <div class="stack" style="gap:2px">
          <strong>유튜브 · 유튜브 뮤직</strong>
          <span class="small muted">${ids.length
            ? `${ids.length}곡을 순서대로 이어 듣는 재생목록을 바로 열어요. 유튜브 앱에서 '저장'을 누르면 내 재생목록에 남아요.${missing > 0 ? ` (아직 못 찾은 ${missing}곡은 빠져 있어요)` : ''}`
            : '곡마다 공식 음원을 찾고 있어요. 준비되면 여기서 한 번에 재생할 수 있어요.'}</span>
        </div>
        ${ids.length ? html`<a class="btn btn-primary btn-sm" href="${ytUrl}" target="_blank" rel="noopener">${icon('external', 14)} 전곡 재생</a>` : ''}
      </div>
      <div class="play-opt">
        <div class="stack" style="gap:2px">
          <strong>애플 뮤직 · 스포티파이 · 유튜브 뮤직으로 옮기기</strong>
          <span class="small muted">곡 목록을 복사한 뒤 TuneMyMusic(무료)에서 '텍스트 붙여넣기'를 고르면 내 계정에 플레이리스트로 만들어져요.</span>
        </div>
        <div class="row" style="gap:6px">
          <button type="button" class="btn btn-outline btn-sm" data-action="copy-list" data-perf="${p.id}" data-which="${which}">${icon('check', 14)} 곡 목록 복사</button>
          <a class="btn btn-outline btn-sm" href="https://www.tunemymusic.com/ko/transfer" target="_blank" rel="noopener">TuneMyMusic ${icon('external', 13)}</a>
        </div>
      </div>
      <div class="play-opt">
        <div class="stack" style="gap:2px">
          <strong>Spotify에 바로 저장 <span class="pill pill-soft">베타</span></strong>
          <span class="small muted">Spotify 계정을 연결하면 플레이리스트를 바로 만들어요.</span>
        </div>
        <button type="button" class="btn btn-outline btn-sm" data-action="spotify-save" data-perf="${p.id}" data-which="${which}">${icon('music', 14)} Spotify에 저장</button>
      </div>
      <p class="faint small">멜론은 외부에서 플레이리스트를 만드는 방법을 열어 두지 않아서, 곡을 누르면 나오는 '멜론' 버튼으로 한 곡씩 열 수 있어요.</p>
    </div>`;
  }

  // 셋리스트가 지금 어느 단계인지: 예상 → 관객이 맞추는 중 → 확정
  function stageOf(p) {
    const isLive = p.status === 'live' || (ev.status === 'live' && p.status !== 'ended');
    const ended = p.status === 'ended' || ev.status === 'ended';
    const confirmed = p.actual.length > 0 && !isLive;
    const checkOpen = isLive || (ended && Date.now() <= Date.parse(ev.endsAt) + CHECK_DAYS * 86400000);
    const stage = confirmed ? 'confirmed' : isLive ? 'live' : p.crowd.reporters ? 'crowd' : ended ? 'unconfirmed' : 'predicted';
    return { isLive, ended, confirmed, checkOpen, stage };
  }

  function stageBar(p, st) {
    const steps = [['predicted', '예상'], ['crowd', '관객이 맞추는 중'], ['confirmed', '확정']];
    const cur = st.stage === 'confirmed' ? 2 : st.stage === 'predicted' ? 0 : 1;
    const n = p.crowd.reporters;
    let text;
    if (st.stage === 'confirmed') {
      const playedKeys = new Set(p.actual.map((it) => checkKey(it.song?.id, it.title)));
      const hit = p.predicted.filter((it) => playedKeys.has(checkKey(it.song?.id, it.title))).length;
      const mine = Object.values(p.crowd.mine).filter((m) => m.played != null && p.predicted.some((it) => checkKey(it.song?.id, it.title) === m.key));
      const right = mine.filter((m) => m.played === playedKeys.has(m.key)).length;
      text = html`실제 공연에서 부른 곡으로 <strong>확정된 셋리스트</strong>예요.${p.predicted.length ? html` 예상 셋리스트와 <strong class="accent">${hit}/${p.predicted.length}곡</strong> 같았어요.` : ''}${n ? ` 관객 ${n}명이 함께 맞췄어요.` : ''}${mine.length ? html` <span class="memory-score">내 기억력 ${right}/${mine.length}</span>` : ''}`;
    } else if (st.stage === 'live') {
      text = html`지금 공연 중이에요. ${p.actual.length ? '운영자와 관객 제보로' : '관객 제보로'} 실제 셋리스트를 실시간으로 맞추고 있어요.${n ? ` 지금 ${n}명 참여 중.` : ''}`;
    } else if (st.stage === 'crowd') {
      text = html`관객 <strong>${n}명</strong>이 실제 셋리스트를 맞추고 있어요. 곡 옆 숫자는 '불렀어요'라고 한 관객 수예요. 운영자가 확인하면 <strong>확정</strong>으로 바뀌어요.`;
    } else if (st.stage === 'unconfirmed') {
      text = html`공연이 끝났지만 아직 실제 셋리스트가 확인되지 않았어요. 아래는 공연 전 <strong>예상</strong>이에요. 다녀오셨다면 같이 맞춰 주세요.`;
    } else {
      text = html`같은 투어 최근 공연을 바탕으로 만든 <strong>예상</strong>이에요. 실제 공연과 다를 수 있어요. 공연 당일부터는 관객들과 실제 셋리스트를 함께 맞춰요.`;
    }
    return html`<div class="stage-bar stage-${st.stage}">
      <ol class="stage-steps" aria-label="셋리스트 단계">
        ${steps.map(([, label], i) => html`<li class="${i < cur ? 'done' : i === cur ? 'current' : ''}" ${i === cur ? html`aria-current="step"` : ''}><span class="step-dot" aria-hidden="true">${i < cur ? icon('check', 12) : i + 1}</span>${label}</li>`)}
      </ol>
      <p class="small stage-text">${text}</p>
    </div>`;
  }

  // 관객 체크 숫자 (확정 전, 예상 곡 옆에 보여 줘요)
  const crowdFor = (p, it) => p.crowd.bySong[checkKey(it.song?.id, it.title)] || null;
  // 예상에 없던 곡 중 관객이 '불렀어요' 한 곡
  function crowdExtras(p) {
    const known = new Set(p.predicted.map((it) => checkKey(it.song?.id, it.title)));
    return Object.values(p.crowd.bySong).filter((r) => !known.has(r.key) && r.yes > 0).sort((a, b) => b.yes - a.yes);
  }
  // 관객 제보로 본 '지금 부르는 곡': 15분 안에 가장 최근 '불렀어요'
  function crowdNow(p) {
    const recent = Object.values(p.crowd.bySong).filter((r) => r.yes > 0 && r.lastAt && Date.now() - Date.parse(r.lastAt) < 15 * 60000);
    return recent.sort((a, b) => b.lastAt.localeCompare(a.lastAt))[0] || null;
  }

  // 공연 중: 한 번 눌러서 지금 부르는 곡 · 떼창 제보
  function livePanel(p, st) {
    const hasActual = p.actual.length > 0;
    const adminNow = hasActual ? p.actual[p.actual.length - 1] : null;
    const cNow = !adminNow ? crowdNow(p) : null;
    const nowTitle = adminNow?.title || cNow?.title || '';
    const nowSong = adminNow ? { id: adminNow.song?.id || '', title: adminNow.title } : cNow ? { id: cNow.songId || '', title: cNow.title } : null;
    const done = new Set([...p.actual.map((it) => checkKey(it.song?.id, it.title)), ...Object.values(p.crowd.mine).filter((m) => m.played).map((m) => m.key)]);
    const next = p.predicted.filter((it) => !done.has(checkKey(it.song?.id, it.title))).slice(0, 6);
    const mineNow = nowSong ? p.crowd.mine[checkKey(nowSong.id, nowSong.title)] : null;
    return html`<div class="live-panel" aria-live="polite">
      ${nowTitle ? html`<div class="now-card">
        ${art(adminNow?.song?.albumArtUrl, '', 84)}
        <div class="stack" style="gap:4px;min-width:0">
          <span class="now-label"><span class="dot" aria-hidden="true"></span>NOW PLAYING${adminNow ? ` · ${adminNow.position}번째 곡` : ''}</span>
          <span class="now-title">${nowTitle}</span>
          <span class="live-meta">${adminNow ? `${timeAgo(adminNow.playedAt)} 시작 · 지금까지 ${p.actual.length}곡` : `관객 ${cNow.yes}명 제보 · ${timeAgo(cNow.lastAt)}`}</span>
        </div>
        ${loggedIn ? html`<button type="button" class="btn ${mineNow?.chant ? 'btn-soft' : 'btn-primary'} btn-sm fire-btn" data-action="chant-tap" data-perf="${p.id}" data-song="${nowSong.id}" data-title="${nowSong.title}" aria-pressed="${mineNow?.chant ? 'true' : 'false'}">🔥 ${mineNow?.chant ? '떼창 제보함' : '떼창 터졌다!'}</button>` : ''}
      </div>` : html`<p class="muted">공연이 시작되면 지금 부르는 곡을 눌러 알려 주세요. 관객 제보가 모이면 여기에 바로 보여요.</p>`}
      <div class="report-box">
        <strong class="small">현장에 계신가요? 지금 부르는 곡을 눌러 주세요</strong>
        ${loggedIn ? html`
          ${next.length ? html`<div class="tap-grid">${next.map((it, i) => html`<button type="button" class="tap-chip ${i === 0 ? 'is-next' : ''}" data-action="now-tap" data-perf="${p.id}" data-song="${it.song?.id || ''}" data-title="${it.title}">
            ${i === 0 ? html`<span class="tap-hint">다음 예상</span>` : ''}<span class="tap-title">${it.title}</span></button>`)}</div>` : ''}
          <form class="inline-form" data-form="now-report">
            <input type="hidden" name="performanceId" value="${p.id}">
            <label class="sr-only" for="now-title-${p.id}">목록에 없는 곡 이름</label>
            <input id="now-title-${p.id}" name="title" class="input input-sm" placeholder="목록에 없는 곡이면 직접 입력 (깜짝 곡 · 커버)" autocomplete="off">
            <button class="btn btn-outline btn-sm" type="submit">${icon('live', 16)} 제보</button>
          </form>` : html`<a class="btn btn-primary btn-sm" href="#/login" data-action="go-login">로그인하고 한 번에 제보하기</a>`}
      </div>
    </div>`;
  }

  // 공연 뒤: 곡마다 '불렀어요 / 안 불렀어요 / 떼창'만 눌러서 같이 맞추기
  function checkCta(p, st) {
    const mineN = Object.keys(p.crowd.mine).length;
    const n = p.crowd.reporters;
    return html`<div class="check-cta">
      <div class="stack" style="gap:2px;min-width:0">
        <strong>${st.confirmed ? '어느 곡에서 떼창이 터졌나요?' : mineN ? `내가 체크한 ${mineN}곡 · 고칠 수 있어요` : st.isLive ? '공연 끝나고 한 번에 체크해도 돼요' : '다녀오셨나요? 셋리스트를 같이 맞춰 주세요'}</strong>
        <span class="small muted">${st.confirmed ? '곡마다 🔥만 눌러 주세요. 모인 표는 다음 공연 예습하는 사람들의 떼창 표시가 돼요.' : "곡마다 '불렀어요 · 안 불렀어요'만 누르면 끝이에요. 1분이면 돼요."}${n ? ` · 관객 ${n}명 참여` : ''}</span>
      </div>
      ${loggedIn
        ? html`<button type="button" class="btn ${openCheck.has(p.id) ? 'btn-soft' : 'btn-primary'} btn-sm" data-action="toggle-check" data-perf="${p.id}" aria-expanded="${openCheck.has(p.id) ? 'true' : 'false'}">${openCheck.has(p.id) ? html`${icon('x', 16)} 닫기` : st.confirmed ? '🔥 떼창 체크하기' : html`${icon('check', 16)} ${mineN ? '내 체크 고치기' : '셋리스트 맞추기'}`}</button>`
        : html`<a class="btn btn-primary btn-sm" href="#/login" data-action="go-login">로그인하고 맞추기</a>`}
    </div>`;
  }

  function checkForm(p, st) {
    const base = st.confirmed ? p.actual : p.predicted;
    const known = new Set(base.map((it) => checkKey(it.song?.id, it.title)));
    const extras = Object.values(p.crowd.mine).filter((m) => !known.has(m.key) && m.played);
    return html`<form class="check-form card" data-form="checks" aria-label="셋리스트 맞추기">
      <input type="hidden" name="performanceId" value="${p.id}">
      <input type="hidden" name="extrasBefore" value="${extras.map((m) => m.title).join('\n')}">
      <p class="small muted">${st.confirmed ? '떼창이 터졌던 곡에 🔥를 눌러 주세요.' : '기억나는 곡만 눌러도 괜찮아요. 모르는 곡은 그대로 두세요.'}</p>
      <ol class="check-list">
        ${base.map((it, i) => {
          const m = p.crowd.mine[checkKey(it.song?.id, it.title)];
          const v = m?.played === true ? 'yes' : m?.played === false ? 'no' : '';
          return html`<li class="check-row">
            <span class="song-no mono">${it.isEncore ? 'EN' : String(i + 1).padStart(2, '0')}</span>
            <span class="check-title">${it.title}</span>
            <input type="hidden" name="sid" value="${it.song?.id || ''}"><input type="hidden" name="t" value="${it.title}">
            <span class="check-opts">
              ${st.confirmed ? '' : html`<span class="seg" role="radiogroup" aria-label="${it.title}">
                <label class="seg-yes"><input type="radio" name="p${i}" value="yes" ${v === 'yes' ? 'checked' : ''}><span>불렀어요</span></label>
                <label class="seg-no"><input type="radio" name="p${i}" value="no" ${v === 'no' ? 'checked' : ''}><span>안 불렀어요</span></label>
                <label class="seg-skip"><input type="radio" name="p${i}" value="" ${v === '' ? 'checked' : ''}><span>몰라요</span></label>
              </span>`}
              <label class="fire-toggle"><input type="checkbox" name="c${i}" ${m?.chant ? 'checked' : ''}><span>🔥 떼창</span></label>
            </span>
          </li>`;
        })}
      </ol>
      ${st.confirmed ? '' : html`<div class="field">
        <label for="extras-${p.id}">예상에 없던 곡도 불렀나요?</label>
        <textarea id="extras-${p.id}" name="extras" class="textarea" rows="3" placeholder="한 줄에 한 곡씩 (깜짝 곡 · 커버곡 · 앙코르)">${extras.map((m) => m.title).join('\n')}</textarea>
      </div>`}
      <div class="row">
        <button class="btn btn-primary" type="submit">${icon('check', 18)} 제보 보내기</button>
        <button class="btn btn-ghost" type="button" data-action="toggle-check" data-perf="${p.id}">닫기</button>
      </div>
    </form>`;
  }

  function perfBlock(p) {
    const st = stageOf(p);
    const { isLive } = st;
    const predictedIds = new Set(p.predicted.map((i) => i.song?.id).filter(Boolean));
    const predictedTitles = new Set(p.predicted.map((i) => norm(i.title)));
    const playedIds = new Set(p.actual.map((i) => i.song?.id).filter(Boolean));
    const playedTitles = new Set(p.actual.map((i) => norm(i.title)));
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
      if (hasActual && (isLive || p.status === 'ended' || st.confirmed)) return wasPlayed(it) ? 'played' : (st.confirmed ? 'skipped' : '');
      return '';
    };
    const showCrowd = !st.confirmed && p.crowd.reporters > 0;
    const extrasC = showCrowd ? crowdExtras(p) : [];
    const playItems = st.confirmed ? p.actual : p.predicted;
    const savedKey = (w) => savedLinks.get(`${p.id}:${w}`);

    return html`<section class="perf" aria-labelledby="perf-${p.id}">
      <div class="perf-head">
        <h2 id="perf-${p.id}">${p.artist.name}</h2>
        ${isLive ? html`<span class="pill pill-live"><span class="dot" aria-hidden="true"></span>LIVE</span>` : st.ended ? html`<span class="pill pill-muted">공연 끝</span>` : ''}
        <span class="meta">${[p.stage, p.startsAt ? `${fmtTime(p.startsAt)}${p.endsAt ? '–' + fmtTime(p.endsAt) : ''}` : ''].filter(Boolean).join(' · ')}</span>
        <div class="perf-actions">
          ${st.confirmed ? html`<a class="btn btn-soft btn-sm" href="#/recap/${encodeURIComponent(ev.slug)}/${encodeURIComponent(p.id)}">${icon('share', 16)} 복습 카드 만들기</a>` : ''}
          ${playItems.length ? html`<button type="button" class="btn ${openPlay.has(p.id) ? 'btn-soft' : 'btn-primary'} btn-sm" data-action="toggle-play" data-perf="${p.id}" aria-expanded="${openPlay.has(p.id) ? 'true' : 'false'}">
            ${icon(prem ? 'music' : 'lock', 16)} ${st.confirmed ? '실제 셋리스트' : '예습 플리'} 한 번에 듣기
          </button>` : ''}
        </div>
      </div>
      ${(p.predicted.length || hasActual) ? stageBar(p, st) : ''}
      ${openPlay.has(p.id) ? playPanel(p, playItems, st.confirmed ? 'actual' : 'predicted') : ''}

      ${savedKey(st.confirmed ? 'actual' : 'predicted') ? html`<div class="notice" style="margin-bottom:14px">
        Spotify 플레이리스트를 만들었어요. <a href="${savedKey(st.confirmed ? 'actual' : 'predicted')}" target="_blank" rel="noopener">Spotify에서 열기 ${icon('external', 13)}</a>
      </div>` : ''}

      ${isLive ? livePanel(p, st) : ''}
      ${st.checkOpen && (p.predicted.length || hasActual) ? checkCta(p, st) : ''}
      ${st.checkOpen && openCheck.has(p.id) && loggedIn ? checkForm(p, st) : ''}

      ${hasActual ? html`<div class="setlist-card is-confirmed" style="margin-bottom:16px">
        <div class="setlist-head">
          <h3>${isLive ? html`<span class="tag tag-live">실시간</span>` : html`<span class="tag tag-confirmed">${icon('check', 13)} 확정</span>`} ${isLive ? '지금까지 부른 곡' : '실제 셋리스트'} <span class="muted small">· ${p.actual.length}곡</span></h3>
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

      ${p.predicted.length ? html`<div class="setlist-card is-predicted ${st.confirmed ? 'is-past' : ''}">
        <div class="setlist-head">
          <h3><span class="tag tag-predicted">예상</span> ${hasActual ? '공연 전 예상했던 셋리스트' : '예상 셋리스트'} <span class="muted small">· ${p.predictedTotal}곡</span></h3>
          ${prem ? html`<span class="legend">
            <span><span class="seg-dot highlight" aria-hidden="true"></span>하이라이트</span>
            <span><span class="seg-dot chant" aria-hidden="true"></span>떼창 구간</span>
          </span>` : html`<a class="small" href="#/membership">${icon('lock', 14)} 떼창 지수 보기</a>`}
        </div>
        ${p.predicted.find((it) => it.note) ? html`<p class="setlist-basis small muted">${icon('info', 14)} 예상 근거 · ${p.predicted.find((it) => it.note).note}</p>` : ''}
        <ol class="songs">
          ${p.predicted.map((it, i) => songRow(it, rowOpts(it, i + 1, { state: predictedState(it), crowd: showCrowd ? crowdFor(p, it) : null })))}
        </ol>
        ${extrasC.length ? html`<div class="crowd-extras">
          <strong class="small">예상에 없던 곡 제보</strong>
          <ul class="list-plain">${extrasC.map((r) => html`<li><span class="badge badge-surprise">깜짝 곡?</span> ${r.title} <span class="muted small">· 관객 ${r.yes}명</span></li>`)}</ul>
        </div>` : ''}
        ${p.predictedTotal > p.predicted.length ? html`<div class="locked-tail">
          <ol class="songs ghost" aria-hidden="true">
            ${Array.from({ length: Math.min(3, p.predictedTotal - p.predicted.length) }, (_, i) => html`<li class="song"><div class="song-main"><span class="song-no mono">${String(p.predicted.length + i + 1).padStart(2, '0')}</span><span class="ghost-bar"></span></div></li>`)}
          </ol>
          <div class="locked-cta">
            ${icon('lock', 18)}
            <p><strong>나머지 ${p.predictedTotal - p.predicted.length}곡</strong>과 앙코르 순서, 떼창 구간은 멤버십에서 볼 수 있어요.</p>
            <a class="btn btn-primary btn-sm" href="#/membership">월 ${won(config.membershipPrice)}으로 전체 보기</a>
          </div>
        </div>` : ''}
      </div>` : (!hasActual ? (ev.predictedStatus === 'unavailable'
        ? html`<div class="card"><p class="muted">공개된 최근 셋리스트를 찾지 못해 예상 셋리스트를 만들지 못했어요.${ev.predictedNote ? ` (${ev.predictedNote})` : ''} 새 공연 소식이 나오면 다시 확인할게요.</p></div>`
        : html`<div class="card"><p class="muted">예상 셋리스트를 준비하고 있어요. 같은 투어의 최근 공연 곡을 바탕으로 만들고, <strong>내 공연에 담아 둔 공연은 몇 시간 안에 먼저</strong> 준비해 드려요.</p></div>`) : '')}
    </section>`;
  }

  // 예매처 포스터는 잘리지 않게 그대로 보여 주고, 뒤 배경은 흐리게 깔아요
  const isPoster = !!ev.coverUrl && ev.source !== 'manual';

  return {
    title: ev.title,
    html: html`
      <section class="ev-hero ${isPoster ? 'has-poster' : ''}">
        ${ev.coverUrl ? html`<img class="bg" src="${ev.coverUrl}" alt="" referrerpolicy="no-referrer">` : ''}
        <div class="container">
          ${backLink('#/', '공연 목록')}
          <div class="ev-head">
          ${isPoster ? html`<a class="ev-poster" href="${ev.coverUrl}" target="_blank" rel="noopener" aria-label="포스터 크게 보기"><img src="${ev.coverUrl}" alt="${ev.title} 포스터" referrerpolicy="no-referrer"></a>` : ''}
          <div class="ev-main">
          <div class="row">${statusPill(ev)}<span class="pill pill-glass">${KIND_LABEL[ev.kind] || ''}</span>${ev.isVisit ? html`<span class="pill pill-visit">${ev.visitNote || '내한'}</span>` : ''}</div>
          <h1>${ev.title}</h1>
          <div class="ev-facts">
            <span>${icon('calendar', 16)} ${fmtDate(ev.startsAt)} ${fmtTime(ev.startsAt)}${ev.status === 'upcoming' ? ` · ${dday(ev.startsAt)}` : ''}</span>
            <span>${icon('pin', 16)} ${[ev.city, ev.venue].filter(Boolean).join(' · ') || '장소 미정'}</span>
            ${(() => { const t = ticketInfo(ev); return t ? html`<span class="ticket-fact ${t.soon ? 'soon' : ''}">${icon('ticket', 16)} ${t.upcoming ? html`<strong>${t.label}</strong> · ${t.when}` : html`${t.label} · ${t.when}`}</span>` : ''; })()}
          </div>
          ${ev.description ? html`<p class="muted ev-desc">${ev.description}</p>` : ''}
          <div class="row">
            <button type="button" class="btn ${followed ? 'btn-soft' : 'btn-primary'}" data-action="toggle-follow" aria-pressed="${followed ? 'true' : 'false'}">
              ${followed ? html`${icon('check', 18)} 내 공연에 담음` : html`${icon('plus', 18)} 내 공연에 담기`}
            </button>
            ${ev.ticketUrl ? html`<a class="btn btn-outline" href="${ev.ticketUrl}" target="_blank" rel="noopener">${icon('ticket', 18)} 예매하기 ${icon('external', 13)}</a>` : ''}
            ${ev.status !== 'upcoming' ? html`<a class="btn btn-outline" href="#/log?add=${encodeURIComponent(ev.slug)}">${icon('calendar', 18)} 다녀왔어요 · 기록하기</a>` : ''}
            <button type="button" class="btn btn-outline" data-action="share">${icon('share', 18)} 공유</button>
          </div>
          ${ev.source === 'kopis' ? html`<p class="faint small">일정 정보는 KOPIS(공연예술통합전산망)에서 자동으로 가져와요. 정확한 시간과 좌석은 예매처에서 확인해 주세요.</p>` : ''}
          ${ev.sourceUrl ? html`<p class="faint small">${ev.source === 'report' ? '사용자 제보로 등록한 공연이에요. ' : ''}정확한 일정과 티켓 오픈 시간은 <a href="${ev.sourceUrl}" target="_blank" rel="noopener">공식 공지 ${icon('external', 12)}</a>와 예매처에서 다시 확인해 주세요.</p>` : ''}
          ${allPredicted.length ? html`<div class="ev-progress">
            <span class="small">${loggedIn ? '나의 예습 진행률' : '로그인하면 곡마다 예습 완료를 체크할 수 있어요'}</span>
            <span class="mono small accent">${loggedIn ? `${done} / ${allPredicted.length}곡` : ''}</span>
            ${loggedIn ? progressBar(done, allPredicted.length) : ''}
          </div>` : ''}
          </div>
          </div>
        </div>
      </section>
      <div class="container">
        ${ev.performances.length ? ev.performances.map(perfBlock) : html`<div class="card" style="margin-top:24px"><p class="muted">${ev.predictedStatus === 'unavailable' ? `공개된 최근 셋리스트를 찾지 못해 예상 셋리스트를 만들지 못했어요.${ev.predictedNote ? ` (${ev.predictedNote})` : ''} 새 소식이 나오면 다시 확인할게요.` : ev.source !== 'manual' ? '예상 셋리스트를 준비하고 있어요. 공연이 가까운 순서로 만들고, 내 공연에 담아 두면 몇 시간 안에 먼저 준비해 드려요.' : '출연진을 준비하고 있어요.'}</p></div>`}
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
      'toggle-play'(el) {
        if (!prem) { toast('예습 플리 한 번에 듣기는 멤버십 기능이에요.'); return navigate('/membership'); }
        const id = el.dataset.perf;
        openPlay.has(id) ? openPlay.delete(id) : openPlay.add(id);
        ctx.rerender();
      },
      async 'copy-list'(el) {
        const p = ev.performances.find((x) => x.id === el.dataset.perf);
        if (!p) return;
        const items = el.dataset.which === 'actual' ? p.actual : p.predicted;
        const text = items.map((it) => `${it.song?.originalArtist || p.artist.name} - ${it.song?.title || it.title}`).join('\n');
        try {
          await navigator.clipboard.writeText(text);
          toast(`${items.length}곡 목록을 복사했어요. TuneMyMusic에서 붙여 넣어 주세요.`, 'ok');
        } catch {
          // 복사가 막힌 브라우저에서는 직접 고를 수 있게 보여 줘요
          window.prompt('아래 목록을 길게 눌러 복사해 주세요.', text);
        }
      },
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
      'toggle-check'(el) {
        if (!loggedIn) return requireLogin('로그인하고 셋리스트를 같이 맞춰 주세요.');
        const id = el.dataset.perf;
        openCheck.has(id) ? openCheck.delete(id) : openCheck.add(id);
        ctx.rerender();
      },
      // 공연 중 한 번 누르기: 운영자에게 '지금 이 곡' 제보 + 관객 셋리스트에 '불렀어요'
      async 'now-tap'(el) {
        if (!loggedIn) return requireLogin();
        const perf = el.dataset.perf, songId = el.dataset.song || null, title = el.dataset.title;
        el.disabled = true;
        await api.submitReport({ performanceId: perf, kind: 'now_playing', songId, title: songId ? '' : title });
        const r = await api.submitChecks(perf, [{ songId, title, played: true }]);
        toast(`‘${title}’ 제보 고마워요!${r.reporters > 1 ? ` 지금 관객 ${r.reporters}명이 같이 맞추고 있어요.` : ''}`, 'ok');
        ctx.rerender();
      },
      async 'chant-tap'(el) {
        if (!loggedIn) return requireLogin();
        const p = ev.performances.find((x) => x.id === el.dataset.perf);
        const songId = el.dataset.song || null, title = el.dataset.title;
        const m = p?.crowd.mine[checkKey(songId, title)];
        const on = !m?.chant;
        await api.submitChecks(el.dataset.perf, [{ songId, title, played: true, chant: on, encore: !!m?.encore }]);
        toast(on ? '🔥 떼창 제보 완료! 다음 공연 예습하는 사람들에게 보여 줄게요.' : '떼창 제보를 취소했어요.', on ? 'ok' : undefined);
        ctx.rerender();
      },
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
        if (!title) throw new UserError('부르는 곡 이름을 적어 주세요.');
        const perf = fd.get('performanceId');
        await api.submitReport({ performanceId: perf, kind: 'now_playing', title });
        const r = await api.submitChecks(perf, [{ title, played: true }]);
        form.reset();
        toast(`‘${title}’ 제보 고마워요!${r.reporters > 1 ? ` 지금 관객 ${r.reporters}명이 같이 맞추고 있어요.` : ''}`, 'ok');
        ctx.rerender();
      },
      // 공연 뒤 셋리스트 맞추기: 곡마다 불렀어요 / 안 불렀어요 / 떼창 + 예상에 없던 곡
      async checks(fd) {
        if (!loggedIn) return requireLogin();
        const perf = fd.get('performanceId');
        const sids = fd.getAll('sid'), titles = fd.getAll('t');
        const items = titles.map((title, i) => {
          const v = fd.get(`p${i}`);
          return { songId: sids[i] || null, title, played: v === 'yes' ? true : v === 'no' ? false : null, chant: fd.get(`c${i}`) === 'on' };
        });
        const lines = (s) => [...new Set(String(s || '').split('\n').map((x) => x.trim()).filter(Boolean))].slice(0, 30);
        const extras = lines(fd.get('extras'));
        const before = lines(fd.get('extrasBefore'));
        const keyOf = (t) => checkKey(null, t);
        for (const t of extras) items.push({ title: t, played: true });
        for (const t of before) if (!extras.some((x) => keyOf(x) === keyOf(t))) items.push({ title: t, played: null }); // 지운 곡은 내 체크에서 빼요
        const marked = items.filter((x) => x.played != null || x.chant).length;
        if (!marked) throw new UserError("기억나는 곡에 '불렀어요'나 🔥를 하나 이상 눌러 주세요.");
        const r = await api.submitChecks(perf, items);
        openCheck.delete(perf);
        toast(`고마워요! ${marked}곡을 맞췄어요.${r.reporters > 1 ? ` 이 공연 셋리스트를 관객 ${r.reporters}명이 함께 맞추고 있어요.` : ' 첫 번째로 맞춰 주셨어요 🙌'}`, 'ok');
        ctx.rerender();
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
