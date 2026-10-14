// 여러 화면에서 함께 쓰는 UI 조각
import { html, raw, fmtDate, fmtTime, dday, mmss, daysUntil } from './util.js';
import { icon } from './icons.js';
import { chantScore } from './api/shape.js';
import { musicLinks } from './music.js';

export const KIND_LABEL = { festival: '페스티벌', concert: '단독 공연' };

export function statusPill(ev) {
  if (ev.status === 'live') return html`<span class="pill pill-live"><span class="dot" aria-hidden="true"></span>LIVE</span>`;
  if (ev.status === 'ended') return html`<span class="pill pill-muted">종료</span>`;
  const d = daysUntil(ev.startsAt);
  return html`<span class="pill ${d <= 7 ? 'pill-accent' : 'pill-soft'}">${dday(ev.startsAt)}</span>`;
}

export function art(url, alt = '', size = 48, cls = '') {
  if (!url) return html`<span class="art art-empty ${cls}" style="width:${size}px;height:${size}px" aria-hidden="true">${icon('music', Math.round(size / 2.4))}</span>`;
  return html`<img class="art ${cls}" src="${url}" alt="${alt}" width="${size}" height="${size}" loading="lazy" decoding="async">`;
}

// 티켓 오픈 표시: 열리기 전이면 "티켓 오픈 D-3 · 10월 20일 20:00", 막 열렸으면 "예매 중"
export function ticketInfo(ev, now = Date.now()) {
  if (!ev.ticketOpenAt || ev.status === 'ended') return null;
  const t = new Date(ev.ticketOpenAt).getTime();
  if (t > now) {
    const d = daysUntil(ev.ticketOpenAt, now);
    return { upcoming: true, soon: d <= 1, label: d === 0 ? `오늘 ${fmtTime(ev.ticketOpenAt)} 티켓 오픈` : `티켓 오픈 D-${d}`, when: `${fmtDate(ev.ticketOpenAt)} ${fmtTime(ev.ticketOpenAt)}` };
  }
  return { upcoming: false, soon: false, label: '예매 중', when: `${fmtDate(ev.ticketOpenAt)} 오픈` };
}

export function eventCard(ev, { followed = false, showFollow = true, note = '' } = {}) {
  return html`<article class="event-card ${ev.status === 'live' ? 'is-live' : ''}">
    <a class="event-cover ${ev.coverUrl && ev.source !== 'manual' ? 'is-poster' : ''}" href="#/e/${encodeURIComponent(ev.slug)}" aria-label="${ev.title} 자세히 보기">
      ${ev.coverUrl && ev.source !== 'manual'
        ? html`<img class="poster-bg" src="${ev.coverUrl}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" aria-hidden="true"><img class="poster" src="${ev.coverUrl}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
        : ev.coverUrl ? html`<img src="${ev.coverUrl}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : html`<span class="cover-fallback" aria-hidden="true"></span>`}
      <span class="event-cover-top">${statusPill(ev)}<span class="pill pill-glass">${KIND_LABEL[ev.kind] || ''}</span>${ev.isVisit ? html`<span class="pill pill-visit">내한</span>` : ''}</span>
    </a>
    <div class="event-body">
      ${note ? html`<p class="event-note">${note}</p>` : ''}
      <h3 class="event-title"><a href="#/e/${encodeURIComponent(ev.slug)}">${ev.title}</a></h3>
      <p class="event-meta">${icon('calendar', 15)} ${fmtDate(ev.startsAt)} ${fmtTime(ev.startsAt)}</p>
      <p class="event-meta">${icon('pin', 15)} ${[ev.city, ev.venue].filter(Boolean).join(' · ') || '장소 미정'}</p>
      ${(() => { const t = ticketInfo(ev); return t?.upcoming ? html`<p class="event-meta ticket-meta ${t.soon ? 'soon' : ''}">${icon('ticket', 15)} ${t.label} <span class="faint">· ${t.when}</span></p>` : ''; })()}
      ${ev.artists.length ? html`<p class="event-artists">${ev.artists.join(' · ')}</p>` : ''}
      ${showFollow ? html`<button type="button" class="btn ${followed ? 'btn-soft' : 'btn-outline'} btn-sm event-follow" data-action="toggle-follow" data-id="${ev.id}" aria-pressed="${followed ? 'true' : 'false'}">
        ${followed ? html`${icon('check', 16)} 내 공연에 담음` : html`${icon('plus', 16)} 내 공연에 담기`}
      </button>` : ''}
    </div>
  </article>`;
}

export function progressBar(done, total, label = '예습 진행률') {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return html`<div class="progress" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">
    <span style="width:${pct}%"></span>
  </div>`;
}

export function chantBadge(song) {
  const s = chantScore(song);
  if (s == null || s < 70) return '';
  return s >= 90
    ? html`<span class="badge badge-must" title="떼창 지수 ${s}">필수 떼창 ${s}</span>`
    : html`<span class="badge badge-chant" title="떼창 지수 ${s}">떼창 ${s}</span>`;
}

export function segmentTimeline(song) {
  const dur = song.durationSec || Math.max(180, ...song.segments.map((g) => g.endSec));
  const segs = song.segments;
  if (!segs.length) return html`<p class="muted small">아직 등록된 구간이 없어요.</p>`;
  const label = segs.map((g) => `${g.kind === 'chant' ? '떼창' : '하이라이트'} ${mmss(g.startSec)}부터 ${mmss(g.endSec)}`).join(', ');
  return html`<div class="timeline">
    <div class="tl-track" role="img" aria-label="${label}">
      ${segs.map((g) => {
        const left = Math.min(100, (g.startSec / dur) * 100);
        const width = Math.max(1.5, Math.min(100 - left, ((g.endSec - g.startSec) / dur) * 100));
        return html`<span class="tl-seg ${g.kind}" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%"></span>`;
      })}
    </div>
    <div class="tl-axis"><span>0:00</span><span>${mmss(dur)}</span></div>
    <ul class="seg-list">
      ${segs.map((g) => html`<li>
        <span class="seg-dot ${g.kind}" aria-hidden="true"></span>
        <strong>${g.kind === 'chant' ? '떼창' : '하이라이트'}</strong>
        ${g.label ? html`<span>${g.label}</span>` : ''}
        <span class="mono">${mmss(g.startSec)}–${mmss(g.endSec)}</span>
        ${g.kind === 'chant' && g.score != null ? html`<span class="mono accent">지수 ${g.score}</span>` : ''}
      </li>`)}
    </ul>
  </div>`;
}

export function linksRow(song, artistName) {
  const links = musicLinks({ title: song?.title || '', artistName, spotifyId: song?.spotifyId });
  return html`<div class="links-row" aria-label="음악 앱에서 열기">
    ${links.map((l) => html`<a class="link-chip link-${l.id}" href="${l.url}" target="_blank" rel="noopener">${l.label}${icon('external', 13)}</a>`)}
  </div>`;
}

export function lockedPanel(text = '하이라이트·떼창 구간은 멤버십 기능이에요.') {
  return html`<div class="locked">
    ${icon('lock', 18)}
    <p>${text}</p>
    <a class="btn btn-primary btn-sm" href="#/membership">멤버십 보기</a>
  </div>`;
}

// 셋리스트 한 줄
export function songRow(item, o) {
  const song = item.song;
  const done = song && o.progress.has(song.id);
  const open = o.open;
  const badges = [];
  if (o.premium && song) badges.push(chantBadge(song));
  if (item.isEncore) badges.push(html`<span class="badge badge-encore">앙코르</span>`);
  if (o.surprise) badges.push(html`<span class="badge badge-surprise">깜짝 곡</span>`);
  if (o.state === 'played') badges.push(html`<span class="badge badge-played">불렀어요</span>`);
  if (o.state === 'skipped') badges.push(html`<span class="badge badge-skipped">안 불렀어요</span>`);
  if (o.state === 'now') badges.push(html`<span class="badge badge-now"><span class="dot" aria-hidden="true"></span>지금</span>`);
  const sub = [song?.album, song?.durationSec ? mmss(song.durationSec) : '', o.time ? o.time : ''].filter(Boolean).join(' · ');

  return html`<li class="song ${open ? 'open' : ''} ${o.state ? 'is-' + o.state : ''}">
    <div class="song-main">
      <span class="song-no mono">${item.isEncore ? 'EN' : String(o.no).padStart(2, '0')}</span>
      ${art(song?.albumArtUrl, '', 48)}
      <button type="button" class="song-btn" data-action="toggle-song" data-id="${item.id}" aria-expanded="${open ? 'true' : 'false'}">
        <span class="song-title">${item.title}</span>
        ${sub ? html`<span class="song-sub">${sub}</span>` : ''}
      </button>
      <span class="song-badges">${badges}</span>
      ${song && o.canCheck ? html`<button type="button" class="check-btn ${done ? 'on' : ''}" data-action="toggle-progress" data-song="${song.id}" aria-pressed="${done ? 'true' : 'false'}" aria-label="${item.title} 예습 완료${done ? ' 취소' : ''}">${icon('check', 18)}</button>` : ''}
    </div>
    ${open ? html`<div class="song-detail">
      ${song
        ? (o.premium ? segmentTimeline(song) : lockedPanel())
        : html`<p class="muted small">곡 정보가 아직 등록되지 않은 곡이에요.</p>`}
      ${linksRow(song || { title: item.title }, o.artistName)}
      ${o.loggedIn && song && o.allowChantReport ? html`<form class="inline-form" data-form="chant-report" aria-label="떼창 구간 제보">
        <input type="hidden" name="songId" value="${song.id}">
        <input type="hidden" name="performanceId" value="${o.performanceId}">
        <label class="sr-only" for="chant-${item.id}">떼창이 시작되는 시간</label>
        <input id="chant-${item.id}" name="at" class="input input-sm" placeholder="떼창 시작 (예: 3:05)" inputmode="numeric" autocomplete="off">
        <button class="btn btn-ghost btn-sm" type="submit">${icon('mic', 16)} 여기서 떼창! 제보</button>
      </form>` : ''}
    </div>` : ''}
  </li>`;
}

export function emptyState(title, body, cta) {
  return html`<div class="empty">
    <h2>${title}</h2>
    ${body ? html`<p>${body}</p>` : ''}
    ${cta || ''}
  </div>`;
}

export function backLink(href, label = '뒤로') {
  return html`<a class="back-link" href="${href}">${icon('back', 18)}${label}</a>`;
}

export const spinner = raw('<span class="spinner" aria-hidden="true"></span>');
