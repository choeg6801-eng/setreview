// app/js/api/seed.js 의 샘플 데이터로 supabase/seed.sql 을 만들어요.
// 실행: node scripts/gen-seed-sql.mjs
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { SEED } from '../app/js/api/seed.js';

// 데모용 짧은 id → 항상 같은 UUID
const uuid = (key) => {
  const h = createHash('sha1').update('setreview:' + key).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const when = (w) => {
  if (typeof w === 'number') return `now() + interval '${w} minutes'`;
  if ('min' in w) return `now() + interval '${w.min} minutes'`;
  const minutes = Math.round(w.hour * 60);
  return `(date_trunc('day', now() at time zone 'Asia/Seoul') + interval '${w.day} days' + interval '${minutes} minutes') at time zone 'Asia/Seoul'`;
};

const out = [];
out.push('-- 셋리뷰 샘플 데이터 (scripts/gen-seed-sql.mjs 로 생성) — schema.sql 다음에 실행하세요.');
out.push('-- 날짜는 실행한 날 기준으로 계산돼요. 다시 실행하면 같은 데이터를 지우고 새로 넣어요.');
out.push('begin;');
const eventIds = SEED.events.map((e) => q(uuid(e.id))).join(', ');
const artistIds = SEED.artists.map((a) => q(uuid(a.id))).join(', ');
out.push(`delete from public.events where id in (${eventIds});`);
out.push(`delete from public.artists where id in (${artistIds});`);

for (const a of SEED.artists) {
  out.push(`insert into public.artists (id, name, slug) values (${q(uuid(a.id))}, ${q(a.name)}, ${q(a.slug)});`);
}
const songTitle = {};
for (const s of SEED.songs) {
  songTitle[s.id] = s.title;
  out.push(`insert into public.songs (id, artist_id, title, album, album_art_url, duration_sec) values (${q(uuid(s.id))}, ${q(uuid(s.artist))}, ${q(s.title)}, ${q(s.album)}, ${q(s.art)}, ${s.dur});`);
  for (const [kind, label, start, end, score] of s.segs) {
    out.push(`insert into public.song_segments (song_id, kind, label, start_sec, end_sec, score) values (${q(uuid(s.id))}, ${q(kind)}, ${q(label)}, ${start}, ${end}, ${score ?? 'null'});`);
  }
}
for (const e of SEED.events) {
  out.push(`insert into public.events (id, slug, title, kind, venue, city, starts_at, ends_at, cover_url, description) values (${q(uuid(e.id))}, ${q(e.slug)}, ${q(e.title)}, ${q(e.kind)}, ${q(e.venue)}, ${q(e.city)}, ${when(e.starts)}, ${when(e.ends)}, ${q(e.cover)}, ${q(e.description)});`);
  e.performances.forEach((p, sort) => {
    out.push(`insert into public.performances (id, event_id, artist_id, stage, starts_at, ends_at, status, sort) values (${q(uuid(p.id))}, ${q(uuid(e.id))}, ${q(uuid(p.artist))}, ${q(p.stage)}, ${when(p.starts)}, ${when(p.ends)}, ${q(p.status)}, ${sort});`);
    (p.predicted || []).forEach((ref, i) => {
      const [sid, encore] = Array.isArray(ref) ? ref : [ref, false];
      out.push(`insert into public.setlist_items (performance_id, kind, position, song_id, title, is_encore) values (${q(uuid(p.id))}, 'predicted', ${i + 1}, ${q(uuid(sid))}, ${q(songTitle[sid])}, ${!!encore});`);
    });
    (p.actual || []).forEach(([ref, w], i) => {
      let sid = null, title, encore = false;
      if (Array.isArray(ref)) { [sid, encore] = ref; title = songTitle[sid]; }
      else if (typeof ref === 'string') { sid = ref; title = songTitle[sid]; }
      else title = ref.title;
      out.push(`insert into public.setlist_items (performance_id, kind, position, song_id, title, is_encore, played_at) values (${q(uuid(p.id))}, 'actual', ${i + 1}, ${sid ? q(uuid(sid)) : 'null'}, ${q(title)}, ${encore}, ${when(w)});`);
    });
  });
}
out.push('commit;');
writeFileSync(new URL('../supabase/seed.sql', import.meta.url), out.join('\n') + '\n');
console.log('supabase/seed.sql 생성 완료:', out.length, '줄');
