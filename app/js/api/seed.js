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
  return db;
}
