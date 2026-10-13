// 복습: 실제 셋리스트 + 공유용 복습 카드
import { html, toast, fmtDate, fmtTime } from '../util.js';
import { backLink, emptyState, art, linksRow, chantBadge } from '../components.js';
import { icon } from '../icons.js';
import { premium } from '../state.js';
import { chantScore } from '../api/shape.js';
import { drawRecap, canvasToFile } from '../recap-card.js';
import { footer } from './footer.js';

const norm = (s) => String(s || '').trim().toLowerCase();

export default async function recap(ctx) {
  const { api, params } = ctx;
  const ev = await api.getEventBySlug(params.slug);
  const p = ev?.performances.find((x) => x.id === params.perf);
  if (!ev || !p) {
    return { title: '복습', html: html`<section class="container narrow">${emptyState('공연을 찾을 수 없어요', '', html`<a class="btn btn-primary" href="#/">공연 목록으로</a>`)}</section>` };
  }
  if (!p.actual.length) {
    return {
      title: '복습',
      html: html`<section class="container narrow section">${backLink(`#/e/${encodeURIComponent(ev.slug)}`, ev.title)}
        ${emptyState('아직 실제 셋리스트가 없어요', '공연이 시작되면 실제로 부른 곡이 채워져요. 그다음 복습 카드를 만들 수 있어요.', html`<a class="btn btn-primary" href="#/e/${encodeURIComponent(ev.slug)}">공연 페이지로</a>`)}</section>`,
    };
  }

  const prem = premium();
  const predictedIds = new Set(p.predicted.map((i) => i.song?.id).filter(Boolean));
  const predictedTitles = new Set(p.predicted.map((i) => norm(i.title)));
  const surprise = (it) => !(it.song ? predictedIds.has(it.song.id) : predictedTitles.has(norm(it.title)));
  const playedIds = new Set(p.actual.map((i) => i.song?.id).filter(Boolean));
  const hit = p.predicted.filter((i) => i.song && playedIds.has(i.song.id)).length;
  const hitRate = p.predicted.length ? Math.round((hit / p.predicted.length) * 100) : null;
  const surpriseCount = p.actual.filter(surprise).length;
  const chantCount = p.actual.filter((i) => (chantScore(i.song) || 0) >= 70).length;
  const stats = [
    [p.actual.length, '들은 곡'],
    prem ? [chantCount, '함께한 떼창'] : [hitRate == null ? '-' : `${hitRate}%`, '예상 적중률'],
    [surpriseCount, '깜짝 곡'],
  ];
  const fileName = `setreview-${ev.slug}.png`;

  return {
    title: `${p.artist.name} 복습`,
    html: html`<div class="container section">
      ${backLink(`#/e/${encodeURIComponent(ev.slug)}`, ev.title)}
      <div class="stack" style="gap:6px;margin:16px 0 24px">
        <span class="serif-kicker">afterglow</span>
        <h1 style="font-size:clamp(28px,4vw,40px);font-weight:900">${p.artist.name}, 그날 밤을 다시</h1>
        <p class="muted">${fmtDate(ev.startsAt)} · ${[ev.city, ev.venue].filter(Boolean).join(' · ')}</p>
      </div>
      <div class="recap-layout">
        <div class="recap-canvas-wrap">
          <canvas id="recap-canvas" width="1080" height="1920" role="img" aria-label="${p.artist.name} 공연 복습 카드 미리보기"></canvas>
          <div class="row">
            <button type="button" class="btn btn-primary" data-action="share-card" style="flex:1">${icon('share', 18)} 공유하기</button>
            <button type="button" class="btn btn-outline" data-action="download-card" style="flex:1">${icon('download', 18)} 이미지 저장</button>
          </div>
          <p class="faint small">인스타그램 스토리 크기(1080×1920)로 저장돼요.</p>
        </div>
        <div class="stack">
          <div class="stat-row">${stats.map(([v, l]) => html`<div class="stat"><strong>${v}</strong><span>${l}</span></div>`)}</div>
          <div class="setlist-card">
            <div class="setlist-head"><h3>실제 셋리스트 <span class="muted small">· ${p.actual.length}곡</span></h3></div>
            <ol class="songs">
              ${p.actual.map((it, i) => html`<li class="song">
                <div class="song-main" style="grid-template-columns:30px 48px minmax(0,1fr) auto">
                  <span class="song-no mono">${it.isEncore ? 'EN' : String(i + 1).padStart(2, '0')}</span>
                  ${art(it.song?.albumArtUrl, '', 48)}
                  <div style="min-width:0"><div class="song-title">${it.title}</div><div class="song-sub">${[it.song?.album, it.playedAt ? fmtTime(it.playedAt) : ''].filter(Boolean).join(' · ')}</div></div>
                  <span class="song-badges">${prem && it.song ? chantBadge(it.song) : ''}${surprise(it) ? html`<span class="badge badge-surprise">깜짝 곡</span>` : ''}</span>
                </div>
                <div class="song-detail" style="padding-top:0">${linksRow(it.song || { title: it.title }, p.artist.name)}</div>
              </li>`)}
            </ol>
          </div>
        </div>
      </div>
    </div>
    ${footer()}`,

    mount(root) {
      const canvas = root.querySelector('#recap-canvas');
      drawRecap(canvas, {
        artist: p.artist.name,
        eventTitle: ev.title,
        dateText: `${fmtDate(ev.startsAt)} · ${[ev.city, ev.venue].filter(Boolean).join(' ')}`,
        coverUrl: ev.coverUrl,
        items: p.actual.map((it) => ({ title: it.title, isEncore: it.isEncore, surprise: surprise(it) })),
        stats,
      });
    },

    actions: {
      async 'download-card'() {
        const canvas = document.getElementById('recap-canvas');
        const a = document.createElement('a');
        a.download = fileName;
        a.href = canvas.toDataURL('image/png');
        a.click();
        toast('복습 카드를 저장했어요.', 'ok');
      },
      async 'share-card'() {
        const canvas = document.getElementById('recap-canvas');
        const file = await canvasToFile(canvas, fileName);
        if (navigator.canShare?.({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: `${p.artist.name} 복습 카드`, text: `${ev.title} · 셋리뷰` });
            return;
          } catch { /* 공유 취소 */ return; }
        }
        const a = document.createElement('a');
        a.download = fileName;
        a.href = URL.createObjectURL(file);
        a.click();
        toast('이 브라우저는 바로 공유가 안 돼서 이미지로 저장했어요.');
      },
    },
  };
}
