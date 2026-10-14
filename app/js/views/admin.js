// 운영자 화면: 라이브 진행 · 공연 · 곡 · 제보 · 출시 알림 · 설정
import { html, toast, dday, fmtDate, fmtTime, fmtDateTime, toLocalInput, fromLocalInput, mmss, parseMmss, slugify, median, timeAgo, UserError } from '../util.js';
import { art, emptyState, statusPill, KIND_LABEL, ticketInfo } from '../components.js';
import { icon } from '../icons.js';
import { isDemo, config } from '../config.js';
import { navigate } from '../router.js';
import { GENRES } from '../taste.js';

const TABS = [
  { id: 'live', label: '라이브 진행', icon: 'live' },
  { id: 'review', label: '검토 대기', icon: 'check' },
  { id: 'events', label: '공연', icon: 'ticket' },
  { id: 'songs', label: '곡 · 떼창 구간', icon: 'music' },
  { id: 'reports', label: '현장 제보', icon: 'mic' },
  { id: 'waitlist', label: '출시 알림', icon: 'bell' },
  { id: 'settings', label: '설정', icon: 'settings' },
];
const PERF_STATUS = [['scheduled', '예정'], ['live', '진행 중'], ['ended', '끝']];
const COVERS = ['/assets/img/hero.jpg', '/assets/img/encore.jpg', '/assets/img/live.jpg', '/assets/img/rock.jpg', '/assets/img/big.jpg', '/assets/img/chant.jpg', '/assets/img/recap.jpg'];

const drafts = new Map(); // 예상 셋리스트 편집 중인 내용 (performanceId → [{songId,title,isEncore}])

function parseSpotifyId(v) {
  const t = String(v || '').trim();
  if (!t) return null;
  const m = t.match(/track[/:]([A-Za-z0-9]{10,})/);
  return m ? m[1] : (/^[A-Za-z0-9]{10,}$/.test(t) ? t : null);
}

export default async function admin(ctx) {
  const { api, state, params, query } = ctx;
  if (!state.session?.isAdmin) {
    return {
      title: '운영자',
      html: html`<section class="container narrow">${emptyState('운영자만 볼 수 있어요', isDemo ? '로그인 화면에서 운영자 데모 계정으로 들어와 보세요.' : '운영자 권한은 Supabase 의 profiles 테이블에서 role 을 admin 으로 바꿔 주세요.', html`<a class="btn btn-primary" href="#/login">로그인</a>`)}</section>`,
    };
  }
  const tab = TABS.some((t) => t.id === params.tab) ? params.tab : 'live';
  const [reports, subs, allEvents] = await Promise.all([api.adminListReports(), api.adminListSubmissions().catch(() => []), api.listEvents({ includeUnpublished: true })]);
  const pending = reports.filter((r) => r.status === 'pending');
  const drafts = allEvents.filter((e) => !e.published && (e.source === 'news' || e.source === 'report'));
  const reviewCount = subs.length + drafts.length;

  const shell = (title, body) => html`<div class="container admin-layout">
    <nav class="admin-nav" aria-label="운영자 메뉴">
      ${TABS.map((t) => html`<a href="#/admin/${t.id}" class="${tab === t.id ? 'active' : ''}" ${tab === t.id ? html`aria-current="page"` : ''}>
        ${icon(t.icon, 18)}${t.label}${t.id === 'reports' && pending.length ? html`<span class="count">${pending.length}</span>` : ''}${t.id === 'review' && reviewCount ? html`<span class="count">${reviewCount}</span>` : ''}</a>`)}
    </nav>
    <div class="admin-main">${body}</div>
  </div>`;

  const view = await TAB_VIEWS[tab]({ ...ctx, reports, pending, subs, drafts, allEvents, tab, id: params.id, query });
  return {
    title: `운영 · ${view.title}`,
    html: shell(view.title, view.html),
    actions: view.actions || {},
    forms: view.forms || {},
    changes: view.changes || {},
    mount: view.mount,
  };
}

// 라이브 진행용: 지금 진행 중이거나 어제~3일 뒤 공연만 상세까지 불러와요 (공연이 많아져도 빠르게)
async function loadEventsWithDetail(api, all) {
  const list = all || await api.listEvents({ includeUnpublished: true });
  const now = Date.now(), DAY = 86400000;
  const events = list.filter((e) => e.status === 'live' || (Date.parse(e.endsAt || e.startsAt) > now - DAY && Date.parse(e.startsAt) < now + 3 * DAY));
  const details = await Promise.all(events.map((e) => api.getEventBySlug(e.slug)));
  return events.map((e, i) => ({ ...e, detail: details[i] }));
}

const TAB_VIEWS = {
  // ============================================================ 라이브 진행
  async live({ api, query, pending, rerender, allEvents }) {
    const events = (await loadEventsWithDetail(api, allEvents)).sort((a, b) => {
      const o = { live: 0, upcoming: 1, ended: 2 };
      return o[a.status] - o[b.status] || a.startsAt.localeCompare(b.startsAt);
    });
    const perfs = events.flatMap((e) => (e.detail?.performances || []).map((p) => ({ ...p, event: e })));
    const sel = perfs.find((p) => p.id === query.perf) || perfs.find((p) => p.status === 'live') || null;

    let body = '';
    if (sel) {
      const playedIds = new Set(sel.actual.map((i) => i.song?.id).filter(Boolean));
      const next = sel.predicted.filter((i) => !(i.song && playedIds.has(i.song.id)));
      const myReports = pending.filter((r) => r.performanceId === sel.id && r.kind === 'now_playing');
      const grouped = [...myReports.reduce((m, r) => {
        const key = r.songId || r.title.toLowerCase();
        const g = m.get(key) || { ...r, ids: [], count: 0 };
        g.ids.push(r.id);
        g.count++;
        m.set(key, g);
        return m;
      }, new Map()).values()].sort((a, b) => b.count - a.count);

      body = html`
        <div class="card stack">
          <div class="row between">
            <div class="stack" style="gap:2px">
              <strong style="font-size:20px">${sel.artist.name}</strong>
              <span class="muted small">${sel.event.title} · ${[sel.stage, sel.startsAt ? fmtDateTime(sel.startsAt) : ''].filter(Boolean).join(' · ')}</span>
            </div>
            <a class="btn btn-ghost btn-sm" href="#/e/${encodeURIComponent(sel.event.slug)}" target="_blank" rel="noopener">${icon('external', 16)} 사용자 화면</a>
          </div>
          <div class="row">
            <span class="label">무대 상태</span>
            <div class="status-switch" role="group" aria-label="무대 상태">
              ${PERF_STATUS.map(([v, l]) => html`<button type="button" class="${v}" data-action="perf-status" data-status="${v}" aria-pressed="${sel.status === v ? 'true' : 'false'}">${l}</button>`)}
            </div>
          </div>
          ${sel.status !== 'live' ? html`<p class="small muted">무대를 <strong>진행 중</strong>으로 바꾸면 사용자 화면에 LIVE 표시와 지금 부르는 곡이 나타나요.</p>` : ''}
        </div>

        ${grouped.length ? html`<div class="card stack">
          <h2>현장 제보 <span class="pill pill-accent">${myReports.length}</span></h2>
          <ul class="list-plain edit-list">
            ${grouped.map((g) => html`<li class="edit-item" style="grid-template-columns:minmax(0,1fr) auto">
              <div><strong>${g.title || '(제목 없음)'}</strong> <span class="muted small">· ${g.count}명 제보 · ${timeAgo(g.createdAt)}</span></div>
              <div class="tools">
                <button type="button" class="btn btn-primary btn-sm" data-action="approve-now" data-ids="${g.ids.join(',')}" data-song="${g.songId || ''}" data-title="${g.title}">셋리스트에 추가</button>
                <button type="button" class="btn btn-ghost btn-sm" data-action="reject-many" data-ids="${g.ids.join(',')}">무시</button>
              </div>
            </li>`)}
          </ul>
        </div>` : ''}

        <div class="card stack">
          <div class="row between">
            <h2>지금 부르는 곡 추가</h2>
            <label class="check"><input type="checkbox" id="encore-toggle"> 앙코르로 추가</label>
          </div>
          ${next.length ? html`<div class="quick-add">
            ${next.map((it) => html`<button type="button" class="btn btn-outline btn-sm" data-action="add-actual" data-song="${it.song?.id || ''}" data-title="${it.title}">${icon('plus', 15)} ${it.title}</button>`)}
          </div>` : html`<p class="muted small">예상 셋리스트의 곡을 모두 불렀어요.</p>`}
          <form class="inline-form" data-form="add-custom">
            <label class="sr-only" for="custom-title">목록에 없는 곡 이름</label>
            <input id="custom-title" class="input input-sm" name="title" placeholder="목록에 없는 곡 (깜짝 곡, 커버곡)" autocomplete="off">
            <button class="btn btn-soft btn-sm" type="submit">추가</button>
          </form>
        </div>

        <div class="setlist-card">
          <div class="setlist-head"><h3>실제 셋리스트 <span class="muted small">· ${sel.actual.length}곡</span></h3></div>
          ${sel.actual.length ? html`<ol class="list-plain edit-list">
            ${sel.actual.map((it, i) => html`<li class="edit-item">
              <span class="mono faint">${it.isEncore ? 'EN' : String(i + 1).padStart(2, '0')}</span>
              <div style="min-width:0"><strong>${it.title}</strong> <span class="muted small">${it.playedAt ? fmtTime(it.playedAt) : ''}</span></div>
              <div class="tools"><button type="button" class="icon-btn" data-action="del-item" data-id="${it.id}" aria-label="${it.title} 지우기">${icon('trash', 16)}</button></div>
            </li>`)}
          </ol>` : html`<p class="muted small" style="padding:16px">아직 부른 곡이 없어요.</p>`}
        </div>`;
    }

    return {
      title: '라이브 진행',
      html: html`
        <h1>라이브 진행</h1>
        <div class="card stack">
          <label class="label" for="perf-pick">진행할 무대</label>
          <select id="perf-pick" class="select" data-change="pick-perf">
            ${!sel ? html`<option value="">무대를 골라 주세요</option>` : ''}
            ${perfs.map((p) => html`<option value="${p.id}" ${sel?.id === p.id ? 'selected' : ''}>${p.status === 'live' ? '● ' : ''}${p.artist.name} — ${p.event.title} (${fmtDate(p.startsAt || p.event.startsAt)})</option>`)}
          </select>
          <p class="faint small">공연 당일 운영자가 지금 부르는 곡을 실시간으로 표시하는 곳이에요. 어제부터 3일 뒤까지 열리는 공연 중 예상 셋리스트(출연 무대)가 준비된 무대만 보여요.</p>
        </div>
        ${perfs.length ? body : emptyState('오늘 전후로 진행할 무대가 없어요', '어제부터 3일 뒤까지의 공연 중 출연 아티스트가 등록된 무대가 여기에 나와요. 공연 탭에서 공연과 출연 아티스트를 등록해 주세요.', html`<a class="btn btn-primary" href="#/admin/events">공연 등록하기</a>`)}`,
      changes: {
        'pick-perf'(el) { navigate('/admin/live', { perf: el.value }); },
      },
      actions: {
        async 'perf-status'(el) {
          await api.adminSetPerformanceStatus(sel.id, el.dataset.status);
          toast('무대 상태를 바꿨어요.', 'ok');
          rerender();
        },
        async 'add-actual'(el) {
          const encore = document.getElementById('encore-toggle')?.checked;
          await api.adminAddActual(sel.id, { songId: el.dataset.song || null, title: el.dataset.title, isEncore: encore });
          toast(`‘${el.dataset.title}’ 추가`, 'ok');
          rerender();
        },
        async 'del-item'(el) {
          await api.adminDeleteSetlistItem(el.dataset.id);
          rerender();
        },
        async 'approve-now'(el) {
          const encore = document.getElementById('encore-toggle')?.checked;
          await api.adminAddActual(sel.id, { songId: el.dataset.song || null, title: el.dataset.title, isEncore: encore });
          await Promise.all(el.dataset.ids.split(',').map((id) => api.adminResolveReport(id, 'approved')));
          toast('제보를 셋리스트에 반영했어요.', 'ok');
          rerender();
        },
        async 'reject-many'(el) {
          await Promise.all(el.dataset.ids.split(',').map((id) => api.adminResolveReport(id, 'rejected')));
          rerender();
        },
      },
      forms: {
        async 'add-custom'(fd, form) {
          const title = String(fd.get('title') || '').trim();
          if (!title) throw new UserError('곡 이름을 적어 주세요.');
          const encore = document.getElementById('encore-toggle')?.checked;
          await api.adminAddActual(sel.id, { title, isEncore: encore });
          form.reset();
          toast(`‘${title}’ 추가`, 'ok');
          rerender();
        },
      },
    };
  },

  // ============================================================ 검토 대기 (뉴스 수집 초안 · 사용자 제보)
  async review({ api, subs, drafts, rerender }) {
    const srcLink = (u) => (u ? html`<a href="${u}" target="_blank" rel="noopener">${icon('external', 13)} 출처 확인</a>` : '');
    return {
      title: '검토 대기',
      html: html`
        <h1>검토 대기</h1>
        <p class="muted">매일 공연 소식 수집이 찾은 공연과 사용자 제보예요. <strong>출처 링크를 열어 날짜 · 장소 · 티켓 오픈 시간을 확인</strong>한 뒤 공개해 주세요. 공개하면 좋아하는 사람들에게 알림과 티켓 오픈 알림이 가요.</p>
        <div class="card stack">
          <h2>수집한 공연 초안 <span class="faint small">${drafts.length}</span></h2>
          ${drafts.length ? html`<ol class="review-list">${drafts.map((e) => html`<li class="review-item">
            <div class="stack" style="gap:4px;min-width:0">
              <strong>${e.title}</strong>
              <span class="small muted">${fmtDate(e.startsAt)} · ${[e.city, e.venue].filter(Boolean).join(' ') || '장소 미정'}${e.ticketOpenAt ? ` · 티켓 오픈 ${fmtDateTime(e.ticketOpenAt)}` : ''}</span>
              ${e.lineup ? html`<span class="small">${e.lineup}</span>` : ''}
              ${e.reviewNote ? html`<span class="small faint">${e.reviewNote}</span>` : ''}
              <span class="row small" style="gap:10px"><span class="pill pill-soft">${KIND_LABEL[e.kind]}</span>${e.isVisit ? html`<span class="pill pill-visit">내한</span>` : ''}${srcLink(e.sourceUrl)}</span>
            </div>
            <div class="actions">
              <button type="button" class="btn btn-primary btn-sm" data-action="publish" data-id="${e.id}">${icon('check', 16)} 공개</button>
              <a class="btn btn-outline btn-sm" href="#/admin/events/${e.id}">고치기</a>
              <button type="button" class="btn btn-ghost btn-sm" data-action="drop-draft" data-id="${e.id}">버리기</button>
            </div>
          </li>`)}</ol>` : html`<p class="muted small">검토할 초안이 없어요.</p>`}
        </div>
        <div class="card stack">
          <h2>사용자 제보 <span class="faint small">${subs.length}</span></h2>
          ${subs.length ? html`<ol class="review-list">${subs.map((r) => html`<li class="review-item">
            <div class="stack" style="gap:4px;min-width:0">
              <strong>${r.title}</strong>
              <span class="small muted">${[r.startsOn && fmtDate(r.startsOn), [r.city, r.venue].filter(Boolean).join(' '), r.ticketOpenAt && `티켓 오픈 ${fmtDateTime(r.ticketOpenAt)}`].filter(Boolean).join(' · ') || '날짜 · 장소 미입력'}</span>
              ${r.artist ? html`<span class="small">${r.artist}</span>` : ''}
              ${r.memo ? html`<span class="small faint">“${r.memo}”</span>` : ''}
              <span class="row small" style="gap:10px"><span class="pill pill-soft">${KIND_LABEL[r.kind]}</span>${r.isVisit ? html`<span class="pill pill-visit">내한</span>` : ''}${srcLink(r.sourceUrl)}${r.ticketUrl ? html`<a href="${r.ticketUrl}" target="_blank" rel="noopener">${icon('ticket', 13)} 예매처</a>` : ''}<span class="faint">${timeAgo(r.createdAt)}</span></span>
            </div>
            <div class="actions">
              <button type="button" class="btn btn-primary btn-sm" data-action="approve-sub" data-id="${r.id}">${icon('check', 16)} 공연으로 등록</button>
              <button type="button" class="btn btn-ghost btn-sm" data-action="reject-sub" data-id="${r.id}">반려</button>
            </div>
          </li>`)}</ol>` : html`<p class="muted small">새 제보가 없어요.</p>`}
        </div>`,
      actions: {
        async publish(el) {
          await api.adminSetPublished(el.dataset.id, true);
          toast('공개했어요. 다음 알림 계산 때 관심 있는 사람들에게 알려요.', 'ok');
          rerender();
        },
        async 'drop-draft'(el) {
          if (!confirm('이 초안을 버릴까요?')) return;
          await api.adminDeleteEvent(el.dataset.id);
          toast('초안을 버렸어요.');
          rerender();
        },
        async 'approve-sub'(el) {
          const ev = await api.adminApproveSubmission(el.dataset.id);
          toast('공연으로 등록했어요. 날짜 · 시간을 확인해 주세요.', 'ok');
          navigate(`/admin/events/${ev.id}`);
        },
        async 'reject-sub'(el) {
          await api.adminRejectSubmission(el.dataset.id);
          toast('반려했어요.');
          rerender();
        },
      },
    };
  },

  // ============================================================ 공연
  async events(ctx) {
    const { api, id, query, rerender } = ctx;
    if (id) return eventEditor(ctx);
    const all = ctx.allEvents || await api.listEvents({ includeUnpublished: true });
    const scope = ['upcoming', 'past', 'drafts'].includes(query.show) ? query.show : 'upcoming';
    const isPast = (e) => e.status === 'ended';
    const lists = {
      upcoming: all.filter((e) => !isPast(e) && e.published).sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      past: all.filter((e) => isPast(e)).sort((a, b) => b.startsAt.localeCompare(a.startsAt)),
      drafts: all.filter((e) => !isPast(e) && !e.published).sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    };
    const list = lists[scope];
    const noPoster = all.filter((e) => !isPast(e) && !e.coverUrl).length;
    // 월별로 묶기 (한국 시간 기준)
    const monthOf = (iso) => new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(0, 7);
    const groups = [];
    for (const e of list) {
      const k = monthOf(e.startsAt);
      let g = groups[groups.length - 1];
      if (!g || g.key !== k) groups.push(g = { key: k, items: [] });
      g.items.push(e);
    }
    const SRC = { kopis: 'KOPIS', news: '소식 수집', report: '제보', manual: '직접 등록' };
    const row = (e) => { const t = ticketInfo(e); return html`<li class="aev">
      <a class="aev-poster" href="#/admin/events/${e.id}" aria-label="${e.title} 편집">${e.coverUrl ? html`<img src="${e.coverUrl}" alt="" loading="lazy" referrerpolicy="no-referrer">` : html`<span class="cover-fallback" aria-hidden="true">${icon('music', 22)}</span>`}</a>
      <div class="aev-date"><strong>${new Date(Date.parse(e.startsAt) + 9 * 3600000).toISOString().slice(5, 10).replace('-', '.')}</strong><span>${fmtDate(e.startsAt, { month: undefined, day: undefined })} ${fmtTime(e.startsAt)}</span><span class="pill pill-soft">${dday(e.startsAt)}</span></div>
      <div class="aev-main">
        <a class="aev-title" href="#/admin/events/${e.id}">${e.title}</a>
        <span class="small muted">${[e.city, e.venue].filter(Boolean).join(' · ') || '장소 미정'}${e.artists.length || e.lineup ? ` · ${e.artists.join(', ') || e.lineup}` : ''}</span>
        <span class="row" style="gap:6px">
          <span class="pill pill-soft">${KIND_LABEL[e.kind]}</span>${e.isVisit ? html`<span class="pill pill-visit">내한</span>` : ''}
          ${e.published ? html`<span class="pill pill-ok">공개</span>` : html`<span class="pill pill-muted">비공개</span>`}
          <span class="faint small">${SRC[e.source] || ''}</span>
          ${t ? html`<span class="small ${t.soon ? 'accent' : 'muted'}">${icon('ticket', 13)} ${t.label}</span>` : ''}
        </span>
      </div>
      <div class="actions">
        <a class="btn btn-outline btn-sm" href="#/admin/events/${e.id}">편집</a>
        <a class="btn btn-ghost btn-sm" href="#/e/${encodeURIComponent(e.slug)}">보기</a>
      </div>
    </li>`; };
    return {
      title: '공연',
      html: html`
        <div class="row between"><h1>공연</h1>
          <div class="row" style="gap:8px">
            ${noPoster ? html`<button type="button" class="btn btn-outline" data-action="fill-posters">${icon('download', 18)} 포스터 채우기 <span class="pill pill-soft">${noPoster}</span></button>` : ''}
            <a class="btn btn-primary" href="#/admin/events/new">${icon('plus', 18)} 새 공연</a>
          </div>
        </div>
        <div class="tabs" role="tablist" style="margin:6px 0 18px">
          ${[['upcoming', '다가오는 공연'], ['drafts', '검토 전 초안'], ['past', '지난 공연']].map(([k, label]) => html`<a class="tab ${scope === k ? 'active' : ''}" role="tab" aria-selected="${scope === k ? 'true' : 'false'}" href="#/admin/events?show=${k}">${label}<span class="count">${lists[k].length}</span></a>`)}
        </div>
        ${groups.length ? groups.map((g) => html`<section class="aev-group">
          <h2 class="log-group-title">${g.key.slice(0, 4)}년 ${Number(g.key.slice(5))}월 <span class="faint small">${g.items.length}개</span></h2>
          <ol class="aev-list">${g.items.map(row)}</ol>
        </section>`) : emptyState(scope === 'drafts' ? '검토할 초안이 없어요' : '아직 공연이 없어요', scope === 'upcoming' ? '공연을 등록하거나 검토 대기에서 공개해 보세요.' : '', '')}`,
      actions: {
        async 'fill-posters'() {
          toast('예매 · 공지 페이지에서 포스터를 찾고 있어요. 30초쯤 걸려요.');
          const r = await api.runPosterFill();
          toast(`포스터 ${r.filled}개를 채웠어요.${r.checked - r.filled ? ` ${r.checked - r.filled}개는 찾지 못했어요.` : ''}`, 'ok');
          rerender();
        },
      },
    };
  },


  // ============================================================ 곡
  async songs(ctx) {
    const { api, id, query } = ctx;
    if (id) return songEditor(ctx);
    const artists = await api.adminListArtists();
    const artistId = query.artist && artists.some((a) => a.id === query.artist) ? query.artist : artists[0]?.id;
    const songs = artistId ? await api.adminListSongs(artistId) : [];
    const cur = artists.find((a) => a.id === artistId);
    return {
      title: '곡 · 떼창 구간',
      html: html`
        <div class="row between"><h1>곡 · 떼창 구간</h1>
          ${artistId ? html`<a class="btn btn-primary" href="#/admin/songs/new?artist=${artistId}">${icon('plus', 18)} 새 곡</a>` : ''}
        </div>
        <div class="card stack">
          <div class="form-grid">
            <div class="field">
              <label for="artist-pick">아티스트</label>
              <select id="artist-pick" class="select" data-change="pick-artist">
                ${artists.map((a) => html`<option value="${a.id}" ${a.id === artistId ? 'selected' : ''}>${a.name}</option>`)}
              </select>
            </div>
            <form class="field" data-form="new-artist">
              <label for="new-artist">새 아티스트 추가</label>
              <div class="inline-form"><input id="new-artist" name="name" class="input" placeholder="아티스트 이름" autocomplete="off"><button class="btn btn-outline btn-sm" type="submit">추가</button></div>
            </form>
          </div>
        </div>
        ${cur ? html`<form class="card stack" data-form="artist-info">
          <h2>아티스트 정보 <span class="faint small">맞춤 공연 · 추천에 쓰여요</span></h2>
          <div class="form-grid">
            <div class="field"><label for="ai-name">이름</label><input id="ai-name" class="input" name="name" value="${cur.name}" required></div>
            <div class="field"><label for="ai-ko">한글 이름</label><input id="ai-ko" class="input" name="nameKo" value="${cur.name_ko || ''}" placeholder="예: 브루노 마스"></div>
            <div class="field"><label for="ai-alias">다른 이름</label><input id="ai-alias" class="input" name="aliases" value="${(cur.aliases || []).join(', ')}" placeholder="쉼표로 나눠 주세요. 예: Maroon5, 마룬5"></div>
          </div>
          <div class="field"><label for="ai-sim">비슷한 아티스트</label><input id="ai-sim" class="input" name="similar" value="${(cur.similar_artists || []).join(', ')}" placeholder="쉼표로 나눠 주세요. 추천에 가장 크게 반영돼요"></div>
          <fieldset class="field"><legend class="label">장르</legend><div class="tchips">
            ${GENRES.map((g) => html`<label class="tchip check-chip"><input type="checkbox" name="genres" value="${g}" ${(cur.genres || []).includes(g) ? 'checked' : ''}> ${g}</label>`)}
          </div></fieldset>
          <button class="btn btn-outline" type="submit" style="align-self:flex-start">아티스트 정보 저장</button>
        </form>` : ''}
        ${songs.length ? html`<div class="table-wrap"><table class="table">
          <thead><tr><th>곡</th><th>길이</th><th>하이라이트</th><th>떼창 지수</th><th><span class="sr-only">관리</span></th></tr></thead>
          <tbody>${songs.map((s) => {
            const hl = s.segments.filter((g) => g.kind === 'highlight');
            const ch = s.segments.filter((g) => g.kind === 'chant');
            return html`<tr>
              <td><div class="row" style="gap:12px;flex-wrap:nowrap">${art(s.albumArtUrl, '', 40)}<div><strong>${s.title}</strong><div class="muted small">${s.album}</div></div></div></td>
              <td class="mono small">${mmss(s.durationSec)}</td>
              <td class="small">${hl.length ? hl.map((g) => `${mmss(g.startSec)}–${mmss(g.endSec)}`).join(', ') : html`<span class="faint">없음</span>`}</td>
              <td class="small">${ch.length ? html`<span class="accent mono">${Math.max(...ch.map((g) => g.score || 0))}</span> <span class="faint">(${ch.length}구간)</span>` : html`<span class="faint">없음</span>`}</td>
              <td><div class="actions"><a class="btn btn-outline btn-sm" href="#/admin/songs/${s.id}">편집</a></div></td>
            </tr>`;
          })}</tbody>
        </table></div>` : emptyState('곡이 없어요', artistId ? '이 아티스트의 곡을 추가해 주세요.' : '먼저 아티스트를 추가해 주세요.', '')}`,
      changes: { 'pick-artist'(el) { navigate('/admin/songs', { artist: el.value }); } },
      forms: {
        async 'new-artist'(fd) {
          const newId = await api.adminUpsertArtist({ name: fd.get('name') });
          toast('아티스트를 추가했어요.', 'ok');
          navigate('/admin/songs', { artist: newId });
        },
        async 'artist-info'(fd) {
          await api.adminUpsertArtistInfo({
            id: cur.id, name: fd.get('name'), nameKo: fd.get('nameKo'),
            aliases: String(fd.get('aliases') || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 10),
            genres: fd.getAll('genres'),
            similar: String(fd.get('similar') || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 12),
          });
          toast('아티스트 정보를 저장했어요.', 'ok');
          ctx.rerender();
        },
      },
    };
  },

  // ============================================================ 제보
  async reports({ api, reports, query, rerender }) {
    const filter = ['pending', 'approved', 'rejected', 'all'].includes(query.status) ? query.status : 'pending';
    const list = filter === 'all' ? reports : reports.filter((r) => r.status === filter);
    const label = { pending: '대기', approved: '반영', rejected: '무시', all: '전체' };
    // 떼창 제보 요약 (곡별)
    const chant = new Map();
    reports.filter((r) => r.kind === 'chant' && r.songId && r.status !== 'rejected' && r.atSec != null).forEach((r) => {
      const g = chant.get(r.songId) || { songId: r.songId, title: r.title, artistName: r.artistName, secs: [] };
      g.secs.push(r.atSec);
      chant.set(r.songId, g);
    });
    const chantList = [...chant.values()].sort((a, b) => b.secs.length - a.secs.length);

    return {
      title: '현장 제보',
      html: html`
        <h1>현장 제보</h1>
        <div class="tabs">${Object.keys(label).map((k) => html`<a class="tab ${filter === k ? 'active' : ''}" href="#/admin/reports?status=${k}">${label[k]}<span class="count">${k === 'all' ? reports.length : reports.filter((r) => r.status === k).length}</span></a>`)}</div>
        ${list.length ? html`<div class="table-wrap"><table class="table">
          <thead><tr><th>시간</th><th>종류</th><th>무대</th><th>곡</th><th>제보자</th><th><span class="sr-only">처리</span></th></tr></thead>
          <tbody>${list.map((r) => html`<tr>
            <td class="small">${timeAgo(r.createdAt)}</td>
            <td>${r.kind === 'chant' ? html`<span class="badge badge-chant">떼창 ${mmss(r.atSec)}</span>` : html`<span class="badge badge-now">지금 곡</span>`}</td>
            <td class="small">${r.artistName}<div class="faint">${r.eventTitle}</div></td>
            <td><strong>${r.title || '-'}</strong></td>
            <td class="small">${r.nickname}</td>
            <td><div class="actions">${r.status === 'pending' ? html`
              ${r.kind === 'now_playing' ? html`<button type="button" class="btn btn-primary btn-sm" data-action="approve" data-id="${r.id}" data-perf="${r.performanceId}" data-song="${r.songId || ''}" data-title="${r.title}">셋리스트에 추가</button>`
                : html`<button type="button" class="btn btn-primary btn-sm" data-action="mark" data-id="${r.id}" data-status="approved">확인</button>`}
              <button type="button" class="btn btn-ghost btn-sm" data-action="mark" data-id="${r.id}" data-status="rejected">무시</button>`
              : html`<span class="pill ${r.status === 'approved' ? 'pill-ok' : 'pill-muted'}">${label[r.status]}</span>`}</div></td>
          </tr>`)}</tbody>
        </table></div>` : emptyState('제보가 없어요', '현장에서 사용자들이 제보하면 여기에 쌓여요.', '')}

        <div class="card stack">
          <h2>떼창 구간 제보 모아 보기</h2>
          <p class="muted small">같은 곡에 모인 제보 시간의 가운데 값으로 떼창 구간을 만들 수 있어요. 만든 뒤 곡 화면에서 다듬어 주세요.</p>
          ${chantList.length ? html`<ul class="list-plain edit-list">${chantList.map((g) => {
            const med = median(g.secs);
            return html`<li class="edit-item" style="grid-template-columns:minmax(0,1fr) auto">
              <div><strong>${g.title}</strong> <span class="muted small">· ${g.artistName} · ${g.secs.length}건 · 가운데 ${mmss(med)}</span></div>
              <div class="tools">
                <button type="button" class="btn btn-soft btn-sm" data-action="chant-segment" data-song="${g.songId}" data-sec="${med}" data-count="${g.secs.length}">떼창 구간 만들기</button>
                <a class="btn btn-ghost btn-sm" href="#/admin/songs/${g.songId}">곡 열기</a>
              </div>
            </li>`;
          })}</ul>` : html`<p class="faint small">아직 떼창 제보가 없어요.</p>`}
        </div>`,
      actions: {
        async approve(el) {
          await api.adminAddActual(el.dataset.perf, { songId: el.dataset.song || null, title: el.dataset.title });
          await api.adminResolveReport(el.dataset.id, 'approved');
          toast('셋리스트에 추가했어요.', 'ok');
          rerender();
        },
        async mark(el) {
          await api.adminResolveReport(el.dataset.id, el.dataset.status);
          rerender();
        },
        async 'chant-segment'(el) {
          const sec = Number(el.dataset.sec);
          const count = Number(el.dataset.count);
          await api.adminUpsertSegment({
            songId: el.dataset.song, kind: 'chant', label: '덕후 제보', startSec: Math.max(0, sec - 10), endSec: sec + 20,
            score: Math.min(95, 65 + count * 5),
          });
          toast('떼창 구간을 만들었어요. 곡 화면에서 시간을 다듬어 주세요.', 'ok');
          rerender();
        },
      },
    };
  },

  // ============================================================ 출시 알림
  async waitlist({ api, rerender }) {
    const list = await api.adminListWaitlist();
    return {
      title: '출시 알림',
      html: html`
        <div class="row between"><h1>출시 알림 신청 <span class="pill pill-accent">${list.length}명</span></h1>
          ${list.length ? html`<button type="button" class="btn btn-outline btn-sm" data-action="csv">${icon('download', 16)} CSV 내려받기</button>` : ''}
        </div>
        <p class="muted small">랜딩 페이지의 출시 알림 폼으로 들어온 이메일이에요. 동의한 목적(출시 알림) 외에는 쓰지 말아 주세요.</p>
        ${list.length ? html`<div class="table-wrap"><table class="table">
          <thead><tr><th>이메일</th><th>신청일</th><th><span class="sr-only">관리</span></th></tr></thead>
          <tbody>${list.map((w) => html`<tr><td>${w.email}</td><td class="small">${fmtDateTime(w.created_at)}</td>
            <td><div class="actions"><button type="button" class="icon-btn" data-action="del" data-id="${w.id}" aria-label="${w.email} 지우기">${icon('trash', 16)}</button></div></td></tr>`)}</tbody>
        </table></div>` : emptyState('아직 신청자가 없어요', '랜딩 페이지에서 출시 알림을 신청하면 여기에 쌓여요.', html`<a class="btn btn-outline" href="/#download">랜딩 페이지 열기</a>`)}`,
      actions: {
        csv() {
          const rows = [['email', 'created_at'], ...list.map((w) => [w.email, w.created_at])];
          const csv = '﻿' + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
          a.download = `setreview-waitlist-${new Date().toISOString().slice(0, 10)}.csv`;
          a.click();
        },
        async del(el) {
          if (!confirm('이 신청을 지울까요?')) return;
          await api.adminDeleteWaitlist(el.dataset.id);
          rerender();
        },
      },
    };
  },

  // ============================================================ 설정
  async settings({ api, state, rerender }) {
    const s = await api.getSettings();
    const sync = await api.getSyncStatus().catch(() => null);
    const ok = (v) => (v ? html`<span class="pill pill-ok">연결됨</span>` : html`<span class="pill pill-muted">설정 안 됨</span>`);
    return {
      title: '설정',
      html: html`
        <h1>설정</h1>
        <div class="card stack">
          <h2>무료 베타</h2>
          <p class="muted small">켜 두면 로그인하지 않은 사람까지 모두 멤버십 기능(하이라이트·떼창 구간, 무제한 담기, Spotify 저장)을 쓸 수 있어요. 결제를 열 때 꺼 주세요.</p>
          <label class="check"><input type="checkbox" data-change="free-beta" ${s.freeBeta ? 'checked' : ''}> 무료 베타 켜기</label>
        </div>
        <div class="card stack">
          <h2>공연 일정 자동 수집 (KOPIS)</h2>
          <p class="muted small">매일 오전 5시 10분에 KOPIS(공연예술통합전산망)에서 앞으로 1년 동안의 대중음악 공연을 확인하고, <strong>페스티벌</strong>과 <strong>내한 공연</strong>만 골라 공연 목록에 넣어요. 이미 있는 공연은 날짜·장소·포스터만 고쳐요.</p>
          ${isDemo ? html`<p class="small"><span class="pill pill-accent">데모 모드</span> Supabase 에 연결하면 동작해요.</p>`
            : !sync ? html`<p class="small"><span class="pill pill-muted">아직 실행 전</span></p>`
            : sync.error ? html`<p class="small"><span class="pill pill-danger">실패</span> ${fmtDateTime(sync.at)} · ${sync.error}</p>
                ${/KOPIS_API_KEY/.test(sync.error) ? html`<p class="small muted">KOPIS 인증키를 Supabase → Edge Functions → Secrets 에 <code>KOPIS_API_KEY</code> 이름으로 넣어 주세요. 방법은 docs/SETUP.md 의 "공연 일정 자동 수집" 에 있어요.</p>` : ''}`
            : html`<dl class="kv">
                <dt>마지막 실행</dt><dd>${fmtDateTime(sync.at)} <span class="faint small">(${sync.seconds}초)</span></dd>
                <dt>새로 추가</dt><dd>${sync.inserted}개</dd>
                <dt>일정 갱신</dt><dd>${sync.updated}개</dd>
                <dt>확인한 공연</dt><dd>${sync.listed}개 중 후보 ${sync.candidates}개${sync.deferred ? html` · <span class="faint">${sync.deferred}개는 다음 실행 때 확인</span>` : ''}</dd>
              </dl>
              ${sync.errors?.length ? html`<p class="faint small">일부 실패: ${sync.errors.slice(0, 3).join(' / ')}</p>` : ''}`}
          ${!isDemo ? html`<button type="button" class="btn btn-outline" data-action="kopis-sync" style="align-self:flex-start">${icon('download', 18)} 지금 가져오기</button>
            <p class="faint small">처음 실행은 1~2분 걸릴 수 있어요.</p>` : ''}
        </div>
        <div class="card stack">
          <h2>연결 상태</h2>
          <dl class="kv">
            <dt>데이터 저장</dt><dd>${isDemo ? html`<span class="pill pill-accent">데모 모드</span> <span class="small muted">이 브라우저에만 저장</span>` : html`<span class="pill pill-ok">Supabase</span> <span class="small muted">${config.supabaseUrl}</span>`}</dd>
            <dt>Spotify 베타</dt><dd>${ok(config.spotifyClientId)}</dd>
            <dt>토스페이먼츠</dt><dd>${ok(config.tossClientKey)} ${config.tossClientKey.startsWith('test_') ? html`<span class="pill pill-soft">테스트 키</span>` : ''}</dd>
            <dt>멤버십 가격</dt><dd>${new Intl.NumberFormat('ko-KR').format(config.membershipPrice)}원 / 월</dd>
            <dt>문의 이메일</dt><dd>${config.supportEmail || html`<span class="faint">설정 안 됨</span>`}</dd>
          </dl>
          <p class="faint small">이 값들은 app/config.js 와 Supabase 에서 바꿔요. 방법은 docs/SETUP.md 를 보세요.</p>
        </div>
        ${isDemo ? html`<div class="card stack">
          <h2>데모 데이터 초기화</h2>
          <p class="muted small">이 브라우저에 저장된 데모 데이터를 처음 상태로 되돌려요. 날짜도 오늘 기준으로 다시 맞춰져요.</p>
          <button type="button" class="btn btn-danger" data-action="reset" style="align-self:flex-start">데모 데이터 초기화</button>
        </div>` : ''}`,
      changes: {
        async 'free-beta'(el) {
          await api.setFreeBeta(el.checked);
          state.settings = await api.getSettings();
          toast(el.checked ? '무료 베타를 켰어요.' : '무료 베타를 껐어요.', 'ok');
          rerender();
        },
      },
      actions: {
        async 'kopis-sync'() {
          toast('KOPIS 에서 공연 일정을 가져오고 있어요. 1~2분 걸릴 수 있어요.');
          const r = await api.runKopisSync();
          toast(`새 공연 ${r.inserted}개를 추가하고 ${r.updated}개를 갱신했어요.`, 'ok');
          rerender();
        },
        async reset() {
          if (!confirm('데모 데이터를 처음 상태로 되돌릴까요?')) return;
          await api.resetDemo();
          location.reload();
        },
      },
    };
  },
};

// ------------------------------------------------------------ 공연 편집
async function eventEditor({ api, id, query, rerender }) {
  const isNew = id === 'new';
  const all = isNew ? [] : await api.listEvents({ includeUnpublished: true });
  const summary = all.find((e) => e.id === id);
  if (!isNew && !summary) return { title: '공연', html: emptyState('공연을 찾을 수 없어요', '', html`<a class="btn btn-primary" href="#/admin/events">목록으로</a>`) };
  const ev = isNew ? null : await api.getEventBySlug(summary.slug);
  const artists = isNew ? [] : await api.adminListArtists();
  const openPerf = query.perf && ev?.performances.find((p) => p.id === query.perf);
  const perfSongs = openPerf ? await api.adminListSongs(openPerf.artist.id) : [];
  if (openPerf && !drafts.has(openPerf.id)) {
    drafts.set(openPerf.id, openPerf.predicted.map((it) => ({ songId: it.song?.id || null, title: it.title, isEncore: it.isEncore })));
  }
  const draft = openPerf ? drafts.get(openPerf.id) : [];
  const v = ev || { kind: 'concert', published: true };

  const form = html`<form class="card stack" data-form="save-event">
    <div class="form-grid">
      <div class="field"><label for="ev-title">공연 이름</label><input id="ev-title" class="input" name="title" value="${v.title || ''}" required placeholder="예: Bruno Mars 내한 공연"></div>
      <div class="field"><label for="ev-slug">주소 이름</label><input id="ev-slug" class="input" name="slug" value="${v.slug || ''}" placeholder="비우면 자동으로 만들어요" pattern="[a-z0-9가-힣\\-]+"><span class="hint">#/e/주소이름 으로 열려요</span></div>
      <div class="field"><label for="ev-kind">종류</label><select id="ev-kind" class="select" name="kind">
        <option value="concert" ${v.kind === 'concert' ? 'selected' : ''}>단독 공연</option>
        <option value="festival" ${v.kind === 'festival' ? 'selected' : ''}>페스티벌</option>
      </select></div>
      <div class="field"><label for="ev-starts">시작 (한국 시간)</label><input id="ev-starts" class="input" type="datetime-local" name="starts" value="${toLocalInput(v.startsAt)}" required></div>
      <div class="field"><label for="ev-ends">종료 (한국 시간)</label><input id="ev-ends" class="input" type="datetime-local" name="ends" value="${toLocalInput(v.endsAt)}" required></div>
      <div class="field"><label for="ev-city">도시</label><input id="ev-city" class="input" name="city" value="${v.city || ''}"></div>
      <div class="field"><label for="ev-venue">공연장</label><input id="ev-venue" class="input" name="venue" value="${v.venue || ''}"></div>
      <div class="field"><label for="ev-cover">대표 이미지 주소</label><input id="ev-cover" class="input" name="cover" value="${v.coverUrl || ''}" list="cover-list" placeholder="/assets/img/hero.jpg 또는 https://...">
        <datalist id="cover-list">${COVERS.map((c) => html`<option value="${c}"></option>`)}</datalist></div>
      <div class="field"><label for="ev-ticket">예매 페이지 주소</label><input id="ev-ticket" class="input" name="ticket" type="url" value="${v.ticketUrl || ''}" placeholder="https://..."></div>
      <div class="field"><label for="ev-topen">티켓 오픈 (한국 시간)</label><input id="ev-topen" class="input" type="datetime-local" name="ticketOpen" value="${toLocalInput(v.ticketOpenAt)}"><span class="hint">넣으면 하루 전 · 1시간 전에 알림이 가요</span></div>
      <div class="field"><label for="ev-src">출처 (공지 · 기사 링크)</label><input id="ev-src" class="input" name="sourceUrl" type="url" value="${v.sourceUrl || ''}" placeholder="https://..."></div>
    </div>
    ${v.source === 'kopis' ? html`<p class="faint small">KOPIS 에서 자동으로 가져온 공연이에요. 날짜·장소·포스터는 매일 KOPIS 기준으로 다시 맞춰져요.</p>` : ''}
    <div class="field"><label for="ev-desc">소개</label><textarea id="ev-desc" class="textarea" name="description">${v.description || ''}</textarea></div>
    <div class="field"><label for="ev-lineup">출연진</label><textarea id="ev-lineup" class="textarea" name="lineup" rows="2" placeholder="쉼표로 나눠 주세요. 맞춤 알림과 추천에 쓰여요.">${v.lineup || ''}</textarea></div>
    <fieldset class="field"><legend class="label">장르</legend><div class="tchips">
      ${GENRES.map((g) => html`<label class="tchip check-chip"><input type="checkbox" name="genres" value="${g}" ${(v.genres || []).includes(g) ? 'checked' : ''}> ${g}</label>`)}
    </div></fieldset>
    <label class="check"><input type="checkbox" name="isVisit" ${v.isVisit ? 'checked' : ''}> 해외 아티스트 내한 공연</label>
    <label class="check"><input type="checkbox" name="published" ${v.published !== false ? 'checked' : ''}> 사용자에게 공개</label>
    <div class="row">
      <button class="btn btn-primary" type="submit">${isNew ? '공연 만들기' : '저장'}</button>
      ${!isNew ? html`<button type="button" class="btn btn-danger" data-action="del-event">공연 삭제</button>` : ''}
    </div>
  </form>`;

  const perfSection = isNew ? '' : html`<div class="card stack">
    <h2>출연 아티스트 · 무대</h2>
    ${ev.performances.length ? html`<ul class="list-plain edit-list">${ev.performances.map((p) => html`<li class="edit-item" style="grid-template-columns:minmax(0,1fr) auto">
      <div><strong>${p.artist.name}</strong> <span class="muted small">· ${[p.stage, p.startsAt ? fmtDateTime(p.startsAt) : ''].filter(Boolean).join(' · ')} · 예상 ${p.predicted.length}곡 · ${PERF_STATUS.find(([s]) => s === p.status)?.[1]}</span></div>
      <div class="tools">
        <a class="btn ${openPerf?.id === p.id ? 'btn-light' : 'btn-outline'} btn-sm" href="#/admin/events/${ev.id}?perf=${p.id}">예상 셋리스트</a>
        <a class="btn btn-ghost btn-sm" href="#/admin/live?perf=${p.id}">라이브</a>
        <button type="button" class="icon-btn" data-action="del-perf" data-id="${p.id}" aria-label="${p.artist.name} 무대 지우기">${icon('trash', 16)}</button>
      </div>
    </li>`)}</ul>` : html`<p class="muted small">아직 출연 아티스트가 없어요.</p>`}
    <form class="stack" data-form="add-perf" style="border-top:1px solid var(--line);padding-top:14px">
      <strong class="small">무대 추가</strong>
      <div class="form-grid">
        <div class="field"><label for="pf-artist">아티스트</label><select id="pf-artist" class="select" name="artistId">
          <option value="">새 아티스트 (오른쪽에 이름 입력)</option>
          ${artists.map((a) => html`<option value="${a.id}">${a.name}</option>`)}
        </select></div>
        <div class="field"><label for="pf-new">새 아티스트 이름</label><input id="pf-new" class="input" name="newArtist" placeholder="목록에 없을 때만"></div>
        <div class="field"><label for="pf-stage">무대</label><input id="pf-stage" class="input" name="stage" placeholder="예: 메인 스테이지"></div>
        <div class="field"><label for="pf-starts">시작</label><input id="pf-starts" class="input" type="datetime-local" name="starts" value="${toLocalInput(ev.startsAt)}"></div>
        <div class="field"><label for="pf-ends">종료</label><input id="pf-ends" class="input" type="datetime-local" name="ends"></div>
      </div>
      <button class="btn btn-outline" type="submit" style="align-self:flex-start">${icon('plus', 16)} 무대 추가</button>
    </form>
  </div>`;

  const usedIds = new Set(draft.map((d) => d.songId).filter(Boolean));
  const predictedEditor = !openPerf ? '' : html`<div class="card stack" id="predicted-editor">
    <div class="row between">
      <h2>${openPerf.artist.name} 예상 셋리스트</h2>
      <a class="btn btn-ghost btn-sm" href="#/admin/songs?artist=${openPerf.artist.id}">곡 관리</a>
    </div>
    <p class="muted small">최근 투어 셋리스트를 참고해 순서대로 넣어 주세요. 위아래 버튼으로 순서를 바꾸고, 다 고치면 저장을 눌러요.</p>
    ${draft.length ? html`<ol class="list-plain edit-list">${draft.map((d, i) => html`<li class="edit-item">
      <span class="mono faint">${d.isEncore ? 'EN' : String(i + 1).padStart(2, '0')}</span>
      <div style="min-width:0"><strong>${d.title}</strong>${d.songId ? '' : html` <span class="badge badge-surprise">곡 정보 없음</span>`}</div>
      <div class="tools">
        <button type="button" class="icon-btn" data-action="d-up" data-i="${i}" aria-label="위로" ${i === 0 ? 'disabled' : ''}>${icon('up', 16)}</button>
        <button type="button" class="icon-btn" data-action="d-down" data-i="${i}" aria-label="아래로" ${i === draft.length - 1 ? 'disabled' : ''}>${icon('down', 16)}</button>
        <button type="button" class="btn ${d.isEncore ? 'btn-light' : 'btn-ghost'} btn-sm" data-action="d-encore" data-i="${i}" aria-pressed="${d.isEncore ? 'true' : 'false'}">앙코르</button>
        <button type="button" class="icon-btn" data-action="d-del" data-i="${i}" aria-label="${d.title} 빼기">${icon('trash', 16)}</button>
      </div>
    </li>`)}</ol>` : html`<p class="faint small">아직 곡이 없어요. 아래에서 추가해 주세요.</p>`}
    <div class="quick-add">
      ${perfSongs.filter((s) => !usedIds.has(s.id)).map((s) => html`<button type="button" class="btn btn-outline btn-sm" data-action="d-add" data-song="${s.id}" data-title="${s.title}">${icon('plus', 15)} ${s.title}</button>`)}
    </div>
    <form class="inline-form" data-form="d-custom">
      <label class="sr-only" for="d-title">곡 정보 없이 제목만 추가</label>
      <input id="d-title" class="input input-sm" name="title" placeholder="곡 정보 없이 제목만 추가 (커버곡 등)" autocomplete="off">
      <button class="btn btn-ghost btn-sm" type="submit">추가</button>
    </form>
    <div class="row">
      <button type="button" class="btn btn-primary" data-action="d-save">예상 셋리스트 저장</button>
      <button type="button" class="btn btn-ghost" data-action="d-reset">되돌리기</button>
    </div>
  </div>`;

  const mutate = (fn) => { fn(draft); rerender(); };

  return {
    title: isNew ? '새 공연' : ev.title,
    html: html`
      <a class="back-link" href="#/admin/events">${icon('back', 18)}공연 목록</a>
      <h1>${isNew ? '새 공연 등록' : ev.title}</h1>
      ${form}${perfSection}${predictedEditor}`,
    mount() {
      if (openPerf) document.getElementById('predicted-editor')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    },
    forms: {
      async 'save-event'(fd) {
        const title = String(fd.get('title') || '').trim();
        const slug = String(fd.get('slug') || '').trim() || slugify(title);
        const newId = await api.adminUpsertEvent({
          id: isNew ? undefined : ev.id, title, slug, kind: fd.get('kind'),
          startsAt: fromLocalInput(fd.get('starts')), endsAt: fromLocalInput(fd.get('ends')),
          city: String(fd.get('city') || '').trim(), venue: String(fd.get('venue') || '').trim(),
          coverUrl: String(fd.get('cover') || '').trim(), description: String(fd.get('description') || '').trim(),
          published: fd.get('published') === 'on',
          isVisit: fd.get('isVisit') === 'on', ticketUrl: String(fd.get('ticket') || '').trim(),
          genres: fd.getAll('genres'), lineup: String(fd.get('lineup') || '').trim().slice(0, 1000),
          ticketOpenAt: fd.get('ticketOpen') ? fromLocalInput(fd.get('ticketOpen')) : null, sourceUrl: String(fd.get('sourceUrl') || '').trim(),
        });
        toast('공연을 저장했어요.', 'ok');
        if (isNew) navigate(`/admin/events/${newId}`); else rerender();
      },
      async 'add-perf'(fd, formEl) {
        let artistId = fd.get('artistId');
        if (!artistId) artistId = await api.adminUpsertArtist({ name: fd.get('newArtist') });
        await api.adminUpsertPerformance({
          eventId: ev.id, artistId, stage: String(fd.get('stage') || '').trim(),
          startsAt: fromLocalInput(fd.get('starts')), endsAt: fromLocalInput(fd.get('ends')),
        });
        formEl.reset();
        toast('무대를 추가했어요.', 'ok');
        rerender();
      },
      'd-custom'(fd, formEl) {
        const title = String(fd.get('title') || '').trim();
        if (!title) throw new UserError('곡 제목을 적어 주세요.');
        formEl.reset();
        mutate((d) => d.push({ songId: null, title, isEncore: false }));
      },
    },
    actions: {
      async 'del-event'() {
        if (!confirm(`‘${ev.title}’ 공연과 셋리스트를 모두 지울까요? 되돌릴 수 없어요.`)) return;
        await api.adminDeleteEvent(ev.id);
        toast('공연을 지웠어요.');
        navigate('/admin/events');
      },
      async 'del-perf'(el) {
        if (!confirm('이 무대와 셋리스트를 지울까요?')) return;
        await api.adminDeletePerformance(el.dataset.id);
        drafts.delete(el.dataset.id);
        rerender();
      },
      'd-up'(el) { const i = +el.dataset.i; mutate((d) => { [d[i - 1], d[i]] = [d[i], d[i - 1]]; }); },
      'd-down'(el) { const i = +el.dataset.i; mutate((d) => { [d[i + 1], d[i]] = [d[i], d[i + 1]]; }); },
      'd-encore'(el) { const i = +el.dataset.i; mutate((d) => { d[i].isEncore = !d[i].isEncore; }); },
      'd-del'(el) { const i = +el.dataset.i; mutate((d) => d.splice(i, 1)); },
      'd-add'(el) { mutate((d) => d.push({ songId: el.dataset.song, title: el.dataset.title, isEncore: false })); },
      'd-reset'() { drafts.delete(openPerf.id); rerender(); },
      async 'd-save'() {
        await api.adminSetPredicted(openPerf.id, draft);
        drafts.delete(openPerf.id);
        toast('예상 셋리스트를 저장했어요.', 'ok');
        rerender();
      },
    },
  };
}

// ------------------------------------------------------------ 곡 편집
async function songEditor({ api, id, query, reports, rerender }) {
  const isNew = id === 'new';
  const artists = await api.adminListArtists();
  let song = null;
  if (!isNew) {
    const all = await api.adminListSongs();
    song = all.find((s) => s.id === id);
    if (!song) return { title: '곡', html: emptyState('곡을 찾을 수 없어요', '', html`<a class="btn btn-primary" href="#/admin/songs">목록으로</a>`) };
  }
  const artistId = song?.artistId || query.artist || artists[0]?.id;
  const tags = song ? reports.filter((r) => r.kind === 'chant' && r.songId === song.id && r.status !== 'rejected' && r.atSec != null) : [];

  return {
    title: isNew ? '새 곡' : song.title,
    html: html`
      <a class="back-link" href="#/admin/songs?artist=${artistId || ''}">${icon('back', 18)}곡 목록</a>
      <h1>${isNew ? '새 곡' : song.title}</h1>
      <form class="card stack" data-form="save-song">
        <div class="row" style="gap:16px;align-items:flex-start;flex-wrap:nowrap">
          ${art(song?.albumArtUrl, '', 88)}
          <div class="form-grid" style="flex:1">
            <div class="field"><label for="sg-artist">아티스트</label><select id="sg-artist" class="select" name="artistId">${artists.map((a) => html`<option value="${a.id}" ${a.id === artistId ? 'selected' : ''}>${a.name}</option>`)}</select></div>
            <div class="field"><label for="sg-title">곡 제목</label><input id="sg-title" class="input" name="title" value="${song?.title || ''}" required></div>
            <div class="field"><label for="sg-album">앨범</label><input id="sg-album" class="input" name="album" value="${song?.album || ''}"></div>
            <div class="field"><label for="sg-dur">길이 (분:초)</label><input id="sg-dur" class="input" name="duration" value="${song?.durationSec ? mmss(song.durationSec) : ''}" placeholder="3:53" inputmode="numeric"></div>
          </div>
        </div>
        <div class="form-grid">
          <div class="field"><label for="sg-art">앨범 아트 주소</label><input id="sg-art" class="input" name="art" value="${song?.albumArtUrl || ''}" placeholder="/assets/img/uj.jpg 또는 https://..."><span class="hint">권리 확인된 이미지만 넣어 주세요</span></div>
          <div class="field"><label for="sg-sp">Spotify 트랙 링크 (선택)</label><input id="sg-sp" class="input" name="spotify" value="${song?.spotifyId ? `https://open.spotify.com/track/${song.spotifyId}` : ''}" placeholder="https://open.spotify.com/track/..."><span class="hint">넣으면 정확한 곡으로 연결돼요</span></div>
        </div>
        <div class="row">
          <button class="btn btn-primary" type="submit">${isNew ? '곡 만들기' : '저장'}</button>
          ${!isNew ? html`<button type="button" class="btn btn-danger" data-action="del-song">곡 삭제</button>` : ''}
        </div>
      </form>

      ${isNew ? '' : html`<div class="card stack">
        <h2>하이라이트 · 떼창 구간</h2>
        <p class="muted small">공연에서 실제로 터지는 구간을 적어 주세요. 떼창 지수 70 이상은 ‘떼창’, 90 이상은 ‘필수 떼창’으로 표시돼요.</p>
        ${song.segments.length ? html`<ul class="list-plain edit-list">${song.segments.map((g) => html`<li class="edit-item" style="grid-template-columns:auto minmax(0,1fr) auto">
          <span class="seg-dot ${g.kind}" aria-hidden="true"></span>
          <div><strong>${g.kind === 'chant' ? '떼창' : '하이라이트'}</strong> ${g.label} <span class="mono muted small">${mmss(g.startSec)}–${mmss(g.endSec)}</span> ${g.kind === 'chant' ? html`<span class="mono accent small">지수 ${g.score}</span>` : ''}</div>
          <div class="tools"><button type="button" class="icon-btn" data-action="del-seg" data-id="${g.id}" aria-label="구간 지우기">${icon('trash', 16)}</button></div>
        </li>`)}</ul>` : html`<p class="faint small">아직 구간이 없어요.</p>`}
        <form class="stack" data-form="add-seg" style="border-top:1px solid var(--line);padding-top:14px">
          <div class="form-grid">
            <div class="field"><label for="sx-kind">종류</label><select id="sx-kind" class="select" name="kind"><option value="chant">떼창</option><option value="highlight">하이라이트</option></select></div>
            <div class="field"><label for="sx-label">이름</label><input id="sx-label" class="input" name="label" placeholder="예: 마지막 후렴"></div>
            <div class="field"><label for="sx-start">시작 (분:초)</label><input id="sx-start" class="input" name="start" placeholder="3:05" required></div>
            <div class="field"><label for="sx-end">끝 (분:초)</label><input id="sx-end" class="input" name="end" placeholder="3:45" required></div>
            <div class="field"><label for="sx-score">떼창 지수 (0–100)</label><input id="sx-score" class="input" name="score" type="number" min="0" max="100" value="80"></div>
          </div>
          <button class="btn btn-outline" type="submit" style="align-self:flex-start">${icon('plus', 16)} 구간 추가</button>
        </form>
        ${tags.length ? html`<p class="small muted">덕후 떼창 제보 ${tags.length}건 · 가운데 값 <strong class="accent">${mmss(median(tags.map((t) => t.atSec)))}</strong></p>` : ''}
      </div>`}`,
    forms: {
      async 'save-song'(fd) {
        const dur = parseMmss(fd.get('duration'));
        const newId = await api.adminUpsertSong({
          id: isNew ? undefined : song.id, artistId: fd.get('artistId'), title: fd.get('title'),
          album: String(fd.get('album') || '').trim(), albumArtUrl: String(fd.get('art') || '').trim(),
          durationSec: dur, spotifyId: parseSpotifyId(fd.get('spotify')),
        });
        toast('곡을 저장했어요.', 'ok');
        if (isNew) navigate(`/admin/songs/${newId}`); else rerender();
      },
      async 'add-seg'(fd, formEl) {
        const start = parseMmss(fd.get('start'));
        const end = parseMmss(fd.get('end'));
        if (start == null || end == null) throw new UserError('시간을 3:05 처럼 적어 주세요.');
        await api.adminUpsertSegment({ songId: song.id, kind: fd.get('kind'), label: String(fd.get('label') || '').trim(), startSec: start, endSec: end, score: Number(fd.get('score')) });
        formEl.reset();
        toast('구간을 추가했어요.', 'ok');
        rerender();
      },
    },
    actions: {
      async 'del-song'() {
        if (!confirm(`‘${song.title}’을(를) 지울까요? 셋리스트에는 제목만 남아요.`)) return;
        await api.adminDeleteSong(song.id);
        navigate('/admin/songs', { artist: song.artistId });
      },
      async 'del-seg'(el) {
        await api.adminDeleteSegment(el.dataset.id);
        rerender();
      },
    },
  };
}
