// 샘플 데이터 — 데모 모드와 supabase/seed.sql 이 같은 내용을 쓰도록 한 곳에서 관리해요.
// 시간은 "오늘(한국 시간) 기준 며칠 뒤 몇 시" 또는 "지금부터 몇 분 전/후" 로 적어 두고,
// 불러올 때 실제 날짜로 바꿔요. 그래서 언제 열어도 D-day 와 라이브 데모가 자연스럽게 보여요.

export const SEED = {
  artists: [
    { id: 'a-bruno', name: 'Bruno Mars', slug: 'bruno-mars' },
    { id: 'a-maroon5', name: 'Maroon 5', slug: 'maroon-5' },
  ],

  // segments: [kind, label, start, end, score]
  songs: [
    { id: 's-24k', artist: 'a-bruno', title: '24K Magic', album: '24K Magic', art: '/assets/img/k24.jpg', dur: 226,
      segs: [['highlight', '첫 후렴', 50, 95, null], ['chant', '후렴 반복', 175, 215, 80]] },
    { id: 's-treasure', artist: 'a-bruno', title: 'Treasure', album: 'Unorthodox Jukebox', art: '/assets/img/uj.jpg', dur: 178,
      segs: [['highlight', '첫 후렴', 40, 80, null], ['chant', '후렴 반복', 120, 160, 84]] },
    { id: 's-twil', artist: 'a-bruno', title: "That's What I Like", album: '24K Magic', art: '/assets/img/k24.jpg', dur: 206,
      segs: [['highlight', '두 번째 후렴', 105, 150, null], ['chant', '마지막 후렴', 150, 190, 74]] },
    { id: 's-loh', artist: 'a-bruno', title: 'Locked Out of Heaven', album: 'Unorthodox Jukebox', art: '/assets/img/uj.jpg', dur: 233,
      segs: [['highlight', '두 번째 후렴', 120, 170, null], ['chant', '마지막 후렴', 185, 225, 92]] },
    { id: 's-marry', artist: 'a-bruno', title: 'Marry You', album: 'Doo-Wops & Hooligans', art: '/assets/img/dw.jpg', dur: 230,
      segs: [['highlight', '첫 후렴', 45, 85, null], ['chant', '후렴 반복', 150, 200, 82]] },
    { id: 's-wiwym', artist: 'a-bruno', title: 'When I Was Your Man', album: 'Unorthodox Jukebox', art: '/assets/img/uj.jpg', dur: 213,
      segs: [['highlight', '후렴', 50, 95, null], ['chant', '전 구간 합창', 50, 200, 90]] },
    { id: 's-grenade', artist: 'a-bruno', title: 'Grenade', album: 'Doo-Wops & Hooligans', art: '/assets/img/dw.jpg', dur: 222,
      segs: [['highlight', '첫 후렴', 55, 100, null], ['chant', '마지막 후렴', 150, 190, 78]] },
    { id: 's-jtwya', artist: 'a-bruno', title: 'Just the Way You Are', album: 'Doo-Wops & Hooligans', art: '/assets/img/dw.jpg', dur: 220,
      segs: [['highlight', '첫 후렴', 60, 100, null], ['chant', '마지막 후렴', 160, 210, 96]] },

    { id: 's-mlj', artist: 'a-maroon5', title: 'Moves Like Jagger', album: 'Moves Like Jagger (싱글)', art: '/assets/img/mlj.jpg', dur: 201,
      segs: [['highlight', '첫 후렴', 45, 80, null], ['chant', '후렴 2', 100, 130, 85], ['chant', '마지막 후렴', 165, 200, 95]] },
    { id: 's-thislove', artist: 'a-maroon5', title: 'This Love', album: 'Songs About Jane', art: '/assets/img/saj.jpg', dur: 206,
      segs: [['highlight', '첫 후렴', 40, 80, null], ['chant', '마지막 후렴', 150, 190, 81]] },
    { id: 's-animals', artist: 'a-maroon5', title: 'Animals', album: 'V', art: '/assets/img/v.jpg', dur: 231,
      segs: [['highlight', '첫 후렴', 50, 90, null], ['chant', '마지막 후렴', 170, 210, 72]] },
    { id: 's-sunday', artist: 'a-maroon5', title: 'Sunday Morning', album: 'Songs About Jane', art: '/assets/img/saj.jpg', dur: 245,
      segs: [['highlight', '첫 후렴', 60, 100, null], ['chant', '마지막 후렴', 180, 220, 76]] },
    { id: 's-gly', artist: 'a-maroon5', title: 'Girls Like You', album: 'Red Pill Blues', art: '/assets/img/rpb.jpg', dur: 235,
      segs: [['highlight', '첫 후렴', 55, 95, null], ['chant', '마지막 후렴', 170, 215, 88]] },
    { id: 's-swbl', artist: 'a-maroon5', title: 'She Will Be Loved', album: 'Songs About Jane', art: '/assets/img/saj.jpg', dur: 257,
      segs: [['highlight', '첫 후렴', 70, 110, null], ['chant', '마지막 후렴', 190, 240, 93]] },
  ],

  // when: { day: 오늘 기준 며칠, hour: 한국 시간 몇 시 } 또는 { min: 지금부터 몇 분 }
  events: [
    {
      id: 'e-maroon-live', slug: 'maroon-5-live-demo', title: 'Maroon 5 내한 공연 (라이브 데모)', kind: 'concert',
      venue: '예시 공연장', city: '서울', cover: '/assets/img/encore.jpg',
      starts: { min: -50 }, ends: { min: 70 },
      description: '실시간 싱크를 체험할 수 있는 데모 공연이에요. 운영자 화면에서 곡을 추가하면 바로 반영돼요.',
      performances: [
        { id: 'p-maroon-live', artist: 'a-maroon5', stage: '메인 스테이지', starts: { min: -35 }, ends: { min: 60 }, status: 'live',
          predicted: ['s-mlj', 's-thislove', 's-animals', 's-sunday', 's-gly', ['s-swbl', true]],
          actual: [['s-mlj', -30], ['s-thislove', -25], ['s-animals', -19], ['s-sunday', -4]] },
      ],
    },
    {
      id: 'e-bruno-seoul', slug: 'bruno-mars-seoul', title: 'Bruno Mars 내한 공연 (예시)', kind: 'concert',
      venue: '예시 공연장', city: '서울', cover: '/assets/img/live.jpg',
      starts: { day: 12, hour: 19 }, ends: { day: 12, hour: 22 },
      description: '최근 투어 기록을 바탕으로 만든 예상 셋리스트예요. 예시 데이터라 실제 공연과 다를 수 있어요.',
      performances: [
        { id: 'p-bruno-seoul', artist: 'a-bruno', stage: '메인 스테이지', starts: { day: 12, hour: 19.5 }, ends: { day: 12, hour: 21.5 }, status: 'scheduled',
          predicted: ['s-24k', 's-treasure', 's-twil', 's-loh', 's-marry', 's-wiwym', 's-grenade', ['s-jtwya', true]] },
      ],
    },
    {
      id: 'e-fest', slug: 'setreview-music-fest', title: '셋리뷰 뮤직 페스티벌 (예시)', kind: 'festival',
      venue: '예시 야외 공연장', city: '인천', cover: '/assets/img/rock.jpg',
      starts: { day: 41, hour: 14 }, ends: { day: 41, hour: 23.5 },
      description: '두 팀이 같은 날 무대에 오르는 페스티벌 예시예요. 무대 순서대로 예습 리스트가 만들어져요.',
      performances: [
        { id: 'p-fest-maroon', artist: 'a-maroon5', stage: '메인 스테이지', starts: { day: 41, hour: 20.1 }, ends: { day: 41, hour: 21.3 }, status: 'scheduled',
          predicted: ['s-mlj', 's-animals', 's-thislove', 's-gly', ['s-swbl', true]] },
        { id: 'p-fest-bruno', artist: 'a-bruno', stage: '메인 스테이지', starts: { day: 41, hour: 21.8 }, ends: { day: 41, hour: 23.3 }, status: 'scheduled',
          predicted: ['s-24k', 's-treasure', 's-loh', 's-wiwym', 's-grenade', ['s-jtwya', true]] },
      ],
    },
    {
      id: 'e-bruno-past', slug: 'bruno-mars-past-show', title: 'Bruno Mars 내한 공연 · 지난 공연 (예시)', kind: 'concert',
      venue: '예시 공연장', city: '서울', cover: '/assets/img/chant.jpg',
      starts: { day: -3, hour: 19 }, ends: { day: -3, hour: 22 },
      description: '끝난 공연이에요. 실제로 불린 셋리스트로 복습 카드를 만들어 보세요.',
      performances: [
        { id: 'p-bruno-past', artist: 'a-bruno', stage: '메인 스테이지', starts: { day: -3, hour: 19.5 }, ends: { day: -3, hour: 21.5 }, status: 'ended',
          predicted: ['s-24k', 's-treasure', 's-twil', 's-loh', 's-marry', 's-wiwym', 's-grenade', ['s-jtwya', true]],
          actual: [['s-24k', { day: -3, hour: 19.55 }], ['s-treasure', { day: -3, hour: 19.62 }], ['s-twil', { day: -3, hour: 19.7 }],
                   ['s-loh', { day: -3, hour: 19.78 }], [{ title: '[깜짝 커버곡]' }, { day: -3, hour: 19.86 }],
                   ['s-marry', { day: -3, hour: 19.95 }], ['s-wiwym', { day: -3, hour: 20.05 }], ['s-grenade', { day: -3, hour: 20.15 }],
                   [['s-jtwya', true], { day: -3, hour: 20.4 }]] },
      ],
    },
  ],
};

const DAY = 86400000;
const KST = 9 * 3600000;

// 오늘 한국 시간 자정(UTC 기준 ms)
function kstMidnight(now) {
  const k = now + KST;
  return k - (k % DAY) - KST;
}

export function resolveWhen(when, now) {
  if (typeof when === 'number') return new Date(now + when * 60000).toISOString();
  if ('min' in when) return new Date(now + when.min * 60000).toISOString();
  return new Date(kstMidnight(now) + when.day * DAY + Math.round(when.hour * 3600000)).toISOString();
}

// 데모용 정규화 데이터베이스 만들기
export function buildDemoDb(now = Date.now()) {
  const db = {
    settings: { free_beta: false },
    profiles: [
      { id: 'u-demo', nickname: '덕후 데모', role: 'user', membership_until: null },
      { id: 'u-admin', nickname: '셋리뷰 운영자', role: 'admin', membership_until: null },
    ],
    artists: SEED.artists.map((a) => ({ ...a })),
    songs: [],
    segments: [],
    events: [],
    performances: [],
    setlist: [],
    follows: [],
    progress: [],
    reports: [],
    waitlist: [],
    attendances: [],
  };
  let n = 0;
  const id = (p) => `${p}-${(++n).toString(36)}`;

  for (const s of SEED.songs) {
    db.songs.push({ id: s.id, artist_id: s.artist, title: s.title, album: s.album, album_art_url: s.art, duration_sec: s.dur, spotify_id: null });
    for (const [kind, label, start, end, score] of s.segs) {
      db.segments.push({ id: id('seg'), song_id: s.id, kind, label, start_sec: start, end_sec: end, score });
    }
  }
  const songById = Object.fromEntries(db.songs.map((s) => [s.id, s]));

  for (const e of SEED.events) {
    db.events.push({
      id: e.id, slug: e.slug, title: e.title, kind: e.kind, venue: e.venue, city: e.city,
      starts_at: resolveWhen(e.starts, now), ends_at: resolveWhen(e.ends, now),
      cover_url: e.cover, description: e.description, published: true,
      is_visit: e.title.includes('내한'), source: 'manual', ticket_url: null,
    });
    e.performances.forEach((p, sort) => {
      db.performances.push({
        id: p.id, event_id: e.id, artist_id: p.artist, stage: p.stage,
        starts_at: resolveWhen(p.starts, now), ends_at: resolveWhen(p.ends, now), status: p.status, sort,
      });
      (p.predicted || []).forEach((ref, i) => {
        const [sid, encore] = Array.isArray(ref) ? ref : [ref, false];
        db.setlist.push({ id: id('it'), performance_id: p.id, kind: 'predicted', position: i + 1, song_id: sid, title: songById[sid].title, is_encore: !!encore, note: null, played_at: null });
      });
      (p.actual || []).forEach(([ref, when], i) => {
        let sid = null, title, encore = false;
        if (Array.isArray(ref)) { [sid, encore] = ref; title = songById[sid].title; }
        else if (typeof ref === 'string') { sid = ref; title = songById[sid].title; }
        else { title = ref.title; }
        db.setlist.push({ id: id('it'), performance_id: p.id, kind: 'actual', position: i + 1, song_id: sid, title, is_encore: encore, note: null, played_at: resolveWhen(when, now) });
      });
    });
  }
  db.attendances = demoAttendances(db);
  Object.assign(db, demoTasteData(db));
  return db;
}

// 데모용 취향 데이터: 아티스트 장르 · 공연 장르/출연진 · 함께 좋아하는 아티스트 · 데모 계정 취향
export function demoTasteData(db) {
  const info = {
    'Bruno Mars': { name_ko: '브루노 마스', aliases: [], genres: ['팝', 'R&B'] },
    'Maroon 5': { name_ko: '마룬 파이브', aliases: ['Maroon5', '마룬5'], genres: ['팝', '록'] },
  };
  for (const a of db.artists) Object.assign(a, { name_ko: null, aliases: [], genres: [] }, info[a.name] || {});
  // 장르 추천 예시용 가상 아티스트
  for (const [name, genres] of [['선셋 오케스트라', ['인디', '록']], ['네온 웨이브', ['일렉트로닉', '팝']], ['미드나잇 소울', ['R&B', '팝']], ['데모 밴드', ['록']],
    ['스칼렛 리프', ['록', '메탈']], ['블루 아워 트리오', ['재즈']], ['오로라 포크', ['포크·어쿠스틱', '인디']], ['시티 라이츠', ['팝', 'R&B']]]) {
    if (!db.artists.some((a) => a.name === name)) db.artists.push({ id: `a-${name}`, name, slug: `demo-${db.artists.length}`, name_ko: null, aliases: [], genres });
  }
  for (const e of db.events) {
    e.genres = e.kind === 'festival' ? ['록', '팝'] : [];
    e.lineup = e.kind === 'festival' ? 'Bruno Mars, Maroon 5, 선셋 오케스트라, 스칼렛 리프, 데모 밴드 외 12팀' : null;
  }
  // 티켓 오픈 예시: 브루노 마스 공연은 3일 뒤 저녁 8시 오픈
  const day = 86400000;
  const kstMid = (t) => t - ((t + 9 * 3600000) % day);
  const bruno = db.events.find((e) => e.id === 'e-bruno-seoul');
  if (bruno) bruno.ticket_open_at = new Date(kstMid(Date.now()) + 3 * day + 20 * 3600000).toISOString();
  // 검토 대기 예시: 매일 공연 소식 수집이 찾은 초안
  if (!db.events.some((e) => e.id === 'e-draft-demo')) {
    const start = new Date(kstMid(Date.now()) + 120 * day + 19 * 3600000);
    db.events.push({
      id: 'e-draft-demo', slug: 'draft-demo', title: '스칼렛 리프 첫 내한 공연 (예시 초안)', kind: 'concert', is_visit: true,
      venue: '예시 아레나', city: '서울', starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 3 * 3600000).toISOString(),
      cover_url: null, description: null, published: false, source: 'news', source_url: 'https://example.com/news/demo',
      review_note: '기사 1건 확인 · 티켓 오픈 시간은 기획사 공지 확인 필요', lineup: '스칼렛 리프', genres: ['록', '메탈'],
      ticket_open_at: new Date(kstMid(Date.now()) + 10 * day + 20 * 3600000).toISOString(), ticket_url: null,
    });
  }
  return {
    submissions: [{
      id: 'sub-demo-1', user_id: 'u-demo', title: '오로라 포크 내한 공연 (예시 제보)', artist: '오로라 포크', kind: 'concert', is_visit: true,
      starts_on: new Date(kstMid(Date.now()) + 90 * day).toISOString().slice(0, 10), venue: '예시 홀', city: '서울',
      ticket_open_at: null, ticket_url: null, source_url: 'https://example.com/notice/demo', memo: '공식 SNS 공지 확인',
      status: 'pending', event_id: null, created_at: new Date().toISOString(),
    }],
    favorites: [{ user_id: 'u-demo', name: 'Maroon 5', created_at: new Date().toISOString() }],
    user_genres: [{ user_id: 'u-demo', genre: '록' }],
    notifications: [],
    artist_pairs: [{ a: 'Maroon 5', b: '시티 라이츠', users: 4 }, { a: 'Bruno Mars', b: '미드나잇 소울', users: 3 }, { a: 'Maroon 5', b: '오로라 포크', users: 2 }],
  };
}

// 데모 계정의 지난 공연 기록 (연도별 화면 예시)
export function demoAttendances(db) {
  const past = db.events.find((e) => e.id === 'e-bruno-past');
  const rows = [
    past && { event_id: past.id, title: past.title, artist: 'Bruno Mars', kind: 'concert', is_visit: true, venue: past.venue, city: past.city,
      attended_on: new Date(new Date(past.starts_at).getTime() + 9 * 3600000).toISOString().slice(0, 10), rating: 5, memo: '깜짝 커버곡에서 소리 질렀다' },
    { title: '여름 록 페스티벌 (예시)', artist: '선셋 오케스트라, 데모 밴드 외 28팀', kind: 'festival', venue: '달빛공원', city: '인천', attended_on: '2026-08-02', rating: 5, memo: '비 맞으면서 떼창한 날' },
    { title: '봄 재즈 페스티벌 (예시)', artist: '미드나잇 소울', kind: 'festival', venue: '자라섬', city: '가평', attended_on: '2026-05-17', rating: 4 },
    { title: 'Maroon 5 내한 공연 (예시)', artist: 'Maroon 5', kind: 'concert', is_visit: true, venue: '고척스카이돔', city: '서울', attended_on: '2026-03-08', rating: 5, memo: 'She Will Be Loved 떼창 최고' },
    { title: '인디 밴드 단독 공연 (예시)', artist: '인디 밴드', kind: 'concert', venue: '롤링홀', city: '서울', attended_on: '2025-11-22', rating: 4 },
    { title: '여름 록 페스티벌 2025 (예시)', artist: '선셋 오케스트라 외 27팀', kind: 'festival', venue: '달빛공원', city: '인천', attended_on: '2025-08-03', rating: 5 },
    { title: '해외 밴드 내한 공연 (예시)', artist: '해외 밴드', kind: 'concert', is_visit: true, venue: '올림픽홀', city: '서울', attended_on: '2025-06-14', rating: 4 },
    { title: '가을 뮤직 페스티벌 (예시)', artist: '네온 웨이브, 인디 밴드', kind: 'festival', venue: '올림픽공원', city: '서울', attended_on: '2024-10-19', rating: 4 },
    { title: '팝 가수 내한 공연 (예시)', artist: '팝 가수', kind: 'concert', is_visit: true, venue: 'KSPO DOME', city: '서울', attended_on: '2024-04-27', rating: 3 },
  ].filter(Boolean);
  return rows.map((r, i) => ({
    id: `att-demo-${i + 1}`, user_id: 'u-demo', event_id: null, is_visit: false, rating: null, memo: null,
    created_at: new Date().toISOString(), ...r,
  }));
}
