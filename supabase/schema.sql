-- ============================================================
-- 셋리뷰 SetReview — Supabase 데이터베이스 스키마
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여 넣고 Run 하세요.
-- 여러 번 실행해도 안전하도록 작성했어요 (if not exists / or replace).
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. 앱 설정 (무료 베타 스위치 등)
-- ------------------------------------------------------------
create table if not exists public.app_settings (
  key   text primary key,
  value jsonb not null
);
insert into public.app_settings (key, value)
values ('free_beta', 'true'::jsonb)          -- true 면 모든 사용자가 멤버십 기능을 무료로 사용
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- 2. 사용자 프로필
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id               uuid primary key references auth.users on delete cascade,
  nickname         text,
  role             text not null default 'user' check (role in ('user', 'admin')),
  membership_until timestamptz,
  created_at       timestamptz not null default now()
);

-- 가입하면 프로필 자동 생성
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nickname)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'nickname',
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'full_name',
      split_part(coalesce(new.email, '덕후'), '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 권한 확인 함수 (API로 노출되지 않는 private 스키마)
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin');
$$;

create or replace function private.is_free_beta()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (value)::text = 'true' from public.app_settings where key = 'free_beta'), false);
$$;

-- 멤버십 기능을 볼 수 있는지 (무료 베타 · 유효한 멤버십 · 운영자)
create or replace function private.can_view_premium()
returns boolean language sql stable security definer set search_path = public as $$
  select private.is_free_beta()
      or private.is_admin()
      or exists (
           select 1 from public.profiles
           where id = (select auth.uid()) and membership_until is not null and membership_until > now()
         );
$$;

-- ------------------------------------------------------------
-- 3. 공연 데이터 (운영자가 입력)
-- ------------------------------------------------------------
create table if not exists public.artists (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  title       text not null,
  kind        text not null default 'concert' check (kind in ('festival', 'concert')),
  venue       text,
  city        text,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  cover_url   text,
  description text,
  published   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.songs (
  id            uuid primary key default gen_random_uuid(),
  artist_id     uuid not null references public.artists on delete cascade,
  title         text not null,
  album         text,
  album_art_url text,
  duration_sec  int,
  spotify_id    text,
  created_at    timestamptz not null default now(),
  unique (artist_id, title)
);

-- 하이라이트 · 떼창 구간 (멤버십 기능)
create table if not exists public.song_segments (
  id        uuid primary key default gen_random_uuid(),
  song_id   uuid not null references public.songs on delete cascade,
  kind      text not null check (kind in ('highlight', 'chant')),
  label     text,
  start_sec int not null check (start_sec >= 0),
  end_sec   int not null check (end_sec > start_sec),
  score     int check (score between 0 and 100)
);

create table if not exists public.performances (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events on delete cascade,
  artist_id  uuid not null references public.artists on delete cascade,
  stage      text,
  starts_at  timestamptz,
  ends_at    timestamptz,
  status     text not null default 'scheduled' check (status in ('scheduled', 'live', 'ended')),
  sort       int not null default 0
);

-- 예상 셋리스트(predicted) 와 실제 셋리스트(actual)
create table if not exists public.setlist_items (
  id             uuid primary key default gen_random_uuid(),
  performance_id uuid not null references public.performances on delete cascade,
  kind           text not null check (kind in ('predicted', 'actual')),
  position       int not null default 0,
  song_id        uuid references public.songs on delete set null,
  title          text not null,
  is_encore      boolean not null default false,
  note           text,
  played_at      timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists setlist_items_perf_idx on public.setlist_items (performance_id, kind, position);
create index if not exists performances_event_idx on public.performances (event_id);
create index if not exists songs_artist_idx on public.songs (artist_id);
create index if not exists segments_song_idx on public.song_segments (song_id);

-- ------------------------------------------------------------
-- 4. 사용자 데이터
-- ------------------------------------------------------------
create table if not exists public.follows (
  user_id    uuid not null references auth.users on delete cascade,
  event_id   uuid not null references public.events on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

create table if not exists public.progress (
  user_id    uuid not null references auth.users on delete cascade,
  song_id    uuid not null references public.songs on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, song_id)
);

-- 현장 제보: 지금 부르는 곡(now_playing) · 떼창 구간(chant)
create table if not exists public.reports (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users on delete cascade,
  performance_id uuid not null references public.performances on delete cascade,
  kind           text not null check (kind in ('now_playing', 'chant')),
  song_id        uuid references public.songs on delete set null,
  title          text,
  at_sec         int,
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at     timestamptz not null default now()
);
create index if not exists reports_status_idx on public.reports (status, created_at desc);

-- 출시 알림 신청
create table if not exists public.waitlist (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique check (position('@' in email) > 1),
  consent    boolean not null default true,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 5. 결제 (Edge Function 이 서비스 키로만 접근)
-- ------------------------------------------------------------
create table if not exists public.subscriptions (
  user_id            uuid primary key references auth.users on delete cascade,
  customer_key       text not null unique,
  billing_key        text,
  status             text not null default 'pending' check (status in ('pending', 'active', 'canceled', 'past_due')),
  current_period_end timestamptz,
  updated_at         timestamptz not null default now()
);

create table if not exists public.payments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  order_id   text not null unique,
  amount     int not null,
  status     text not null check (status in ('paid', 'failed')),
  raw        jsonb,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 6. 접근 권한 (Row Level Security)
-- ------------------------------------------------------------
alter table public.app_settings  enable row level security;
alter table public.profiles      enable row level security;
alter table public.artists       enable row level security;
alter table public.events        enable row level security;
alter table public.songs         enable row level security;
alter table public.song_segments enable row level security;
alter table public.performances  enable row level security;
alter table public.setlist_items enable row level security;
alter table public.follows       enable row level security;
alter table public.progress      enable row level security;
alter table public.reports       enable row level security;
alter table public.waitlist      enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments      enable row level security;

-- 정책을 다시 만들 수 있도록 먼저 지워요
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- 앱 설정: 누구나 읽기, 운영자만 수정
create policy "settings read"  on public.app_settings for select using (true);
create policy "settings admin" on public.app_settings for all using (private.is_admin()) with check (private.is_admin());

-- 프로필: 본인 · 운영자만 읽기, 본인은 닉네임만 수정
create policy "profile read own"    on public.profiles for select using (id = (select auth.uid()) or private.is_admin());
create policy "profile update own"  on public.profiles for update using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "profile admin"       on public.profiles for update using (private.is_admin()) with check (private.is_admin());
revoke update on public.profiles from authenticated, anon;
grant update (nickname) on public.profiles to authenticated;

-- 공연 데이터: 누구나 읽기, 운영자만 쓰기
create policy "artists read"  on public.artists for select using (true);
create policy "artists admin" on public.artists for all using (private.is_admin()) with check (private.is_admin());

create policy "events read"  on public.events for select using (published or private.is_admin());
create policy "events admin" on public.events for all using (private.is_admin()) with check (private.is_admin());

create policy "songs read"  on public.songs for select using (true);
create policy "songs admin" on public.songs for all using (private.is_admin()) with check (private.is_admin());

create policy "performances read"  on public.performances for select using (true);
create policy "performances admin" on public.performances for all using (private.is_admin()) with check (private.is_admin());

create policy "setlist read"  on public.setlist_items for select using (true);
create policy "setlist admin" on public.setlist_items for all using (private.is_admin()) with check (private.is_admin());

-- 하이라이트·떼창 구간: 멤버십(또는 무료 베타)일 때만 읽기
create policy "segments read premium" on public.song_segments for select using (private.can_view_premium());
create policy "segments admin"        on public.song_segments for all using (private.is_admin()) with check (private.is_admin());

-- 내 공연: 본인 것만. 멤버십이 아니면 1개까지만 등록
create policy "follows read own"   on public.follows for select using (user_id = (select auth.uid()));
create policy "follows delete own" on public.follows for delete using (user_id = (select auth.uid()));
create policy "follows insert own" on public.follows for insert with check (
  user_id = (select auth.uid())
  and (private.can_view_premium() or (select count(*) from public.follows f where f.user_id = (select auth.uid())) < 1)
);

-- 예습 체크: 본인 것만
create policy "progress own" on public.progress for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 제보: 로그인한 사용자가 작성, 본인·운영자가 읽기, 운영자가 처리
create policy "reports insert" on public.reports for insert with check (user_id = (select auth.uid()) and status = 'pending');
create policy "reports read"   on public.reports for select using (user_id = (select auth.uid()) or private.is_admin());
create policy "reports admin"  on public.reports for update using (private.is_admin()) with check (private.is_admin());
create policy "reports delete" on public.reports for delete using (private.is_admin());

-- 출시 알림: 누구나 신청, 운영자만 열람
create policy "waitlist insert" on public.waitlist for insert with check (consent);
create policy "waitlist admin"  on public.waitlist for select using (private.is_admin());
create policy "waitlist delete" on public.waitlist for delete using (private.is_admin());

-- 결제: 운영자만 열람 (쓰기는 Edge Function 의 서비스 키로만)
create policy "payments admin" on public.payments for select using (private.is_admin());
create policy "subscriptions read own" on public.subscriptions for select using (user_id = (select auth.uid()) or private.is_admin());
revoke select on public.subscriptions from authenticated, anon;
grant select (user_id, status, current_period_end, updated_at) on public.subscriptions to authenticated;

-- ------------------------------------------------------------
-- 7. 실시간 업데이트 (라이브 셋리스트)
-- ------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.setlist_items;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.performances;
  exception when duplicate_object then null;
  end;
end $$;

-- ------------------------------------------------------------
-- 보안 · 성능 보강
-- ------------------------------------------------------------
revoke all on function private.is_admin() from public;
revoke all on function private.is_free_beta() from public;
revoke all on function private.can_view_premium() from public;
grant execute on function private.is_admin(), private.is_free_beta(), private.can_view_premium() to anon, authenticated, service_role;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create index if not exists follows_event_idx on public.follows(event_id);
create index if not exists payments_user_idx on public.payments(user_id);
create index if not exists performances_artist_idx on public.performances(artist_id);
create index if not exists progress_song_idx on public.progress(song_id);
create index if not exists reports_performance_idx on public.reports(performance_id);
create index if not exists reports_song_idx on public.reports(song_id);
create index if not exists reports_user_idx on public.reports(user_id);
create index if not exists setlist_items_song_idx on public.setlist_items(song_id);

-- ------------------------------------------------------------
-- 자동 수집(KOPIS) 표시 · 내 공연 기록
-- ------------------------------------------------------------
alter table public.events
  add column if not exists source      text not null default 'manual',
  add column if not exists external_id text,
  add column if not exists is_visit    boolean not null default false,   -- 내한 공연
  add column if not exists ticket_url  text,
  add column if not exists updated_at  timestamptz not null default now();
alter table public.events drop constraint if exists events_source_check;
alter table public.events add constraint events_source_check check (source in ('manual', 'kopis'));
alter table public.events drop constraint if exists events_source_external_key;
alter table public.events add constraint events_source_external_key unique (source, external_id);
create index if not exists events_starts_idx on public.events(starts_at);

create table if not exists public.attendances (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  event_id    uuid references public.events on delete set null,
  title       text not null check (char_length(title) between 1 and 120),
  artist      text check (char_length(artist) <= 120),
  kind        text not null default 'concert' check (kind in ('festival', 'concert')),
  is_visit    boolean not null default false,
  venue       text check (char_length(venue) <= 80),
  city        text check (char_length(city) <= 40),
  attended_on date not null,
  rating      smallint check (rating between 1 and 5),
  memo        text check (char_length(memo) <= 500),
  created_at  timestamptz not null default now(),
  unique (user_id, event_id)
);
create index if not exists attendances_user_date_idx on public.attendances(user_id, attended_on desc);
create index if not exists attendances_event_idx on public.attendances(event_id);
alter table public.attendances enable row level security;
drop policy if exists "attendances own" on public.attendances;
create policy "attendances own" on public.attendances for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.attendances from anon;

-- ============================================================
-- 취향 · 맞춤 공연 · 알림
-- ============================================================

-- 아티스트: 한글 이름 · 다른 이름 · 장르
alter table public.artists
  add column if not exists name_ko text,
  add column if not exists aliases text[] not null default '{}',
  add column if not exists genres  text[] not null default '{}';

-- 공연: 출연진 원문 · 장르
alter table public.events
  add column if not exists lineup text,
  add column if not exists genres text[] not null default '{}';

-- 이름 비교용: 소문자 + 공백·기호 제거
create or replace function public.norm_name(t text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(lower(coalesce(t, '')), '[^0-9a-z가-힣ぁ-んァ-ン一-龥]+', '', 'g');
$$;

-- 좋아하는 아티스트
create table if not exists public.favorite_artists (
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  norm       text generated always as (public.norm_name(name)) stored,
  created_at timestamptz not null default now(),
  primary key (user_id, norm)
);
alter table public.favorite_artists enable row level security;
drop policy if exists "favorite own" on public.favorite_artists;
create policy "favorite own" on public.favorite_artists for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.favorite_artists from anon;

-- 좋아하는 장르
create table if not exists public.user_genres (
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  genre      text not null check (char_length(genre) between 1 and 30),
  created_at timestamptz not null default now(),
  primary key (user_id, genre)
);
alter table public.user_genres enable row level security;
drop policy if exists "genres own" on public.user_genres;
create policy "genres own" on public.user_genres for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.user_genres from anon;

-- 알림 설정 (프로필)
alter table public.profiles
  add column if not exists email_alerts  boolean not null default true,
  add column if not exists weekly_digest boolean not null default true;
grant update (nickname, email_alerts, weekly_digest) on public.profiles to authenticated;

-- 알림함
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  kind        text not null check (kind in ('artist', 'genre', 'ticket_d1', 'ticket_h1')),
  event_id    uuid not null references public.events on delete cascade,
  reason      text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  emailed_at  timestamptz,
  digested_at timestamptz,
  unique (user_id, event_id, kind)
);
create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);
create index if not exists notifications_event_idx on public.notifications(event_id);
alter table public.notifications enable row level security;
drop policy if exists "notifications read own" on public.notifications;
drop policy if exists "notifications update own" on public.notifications;
drop policy if exists "notifications delete own" on public.notifications;
create policy "notifications read own"   on public.notifications for select using (user_id = (select auth.uid()));
create policy "notifications update own" on public.notifications for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "notifications delete own" on public.notifications for delete using (user_id = (select auth.uid()));
revoke all on public.notifications from anon;
revoke insert, update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- 함께 좋아하는 아티스트 (2명 이상이 같이 고른 쌍만, 누가 골랐는지는 남기지 않아요)
create table if not exists public.artist_pairs (
  a     text not null,
  b     text not null,
  users int  not null,
  primary key (a, b)
);
alter table public.artist_pairs enable row level security;
drop policy if exists "pairs read" on public.artist_pairs;
create policy "pairs read" on public.artist_pairs for select using (true);
revoke insert, update, delete on public.artist_pairs from anon, authenticated;

-- ------------------------------------------------------------
-- 알림 만들기: 좋아하는 아티스트가 나오는 공연 + 좋아하는 장르의 새 공연
-- p_user 가 null 이면 모든 사용자 (매일 예약 실행), 아니면 그 사용자만
-- ------------------------------------------------------------
create or replace function private.generate_notifications(p_user uuid default null)
returns int language plpgsql security definer set search_path = '' as $$
declare n1 int; n2 int;
begin
  -- 1) 아티스트: 공연 제목 · 출연진 · 무대 아티스트에 이름(한글 이름 · 다른 이름 포함)이 들어 있으면
  with names as (
    select f.user_id, f.name as label, f.norm as key from public.favorite_artists f
    where (p_user is null or f.user_id = p_user) and char_length(f.norm) >= 2
    union
    select f.user_id, f.name, public.norm_name(x)
    from public.favorite_artists f
    join public.artists a on public.norm_name(a.name) = f.norm or public.norm_name(a.name_ko) = f.norm
                          or f.norm = any (select public.norm_name(y) from unnest(a.aliases) y)
    cross join lateral unnest(array[a.name, a.name_ko] || a.aliases) x
    where (p_user is null or f.user_id = p_user) and char_length(public.norm_name(x)) >= 2
  ),
  ev as (
    select e.id, public.norm_name(e.title) || '|' || public.norm_name(e.lineup) || '|' ||
           coalesce((select string_agg(public.norm_name(a.name) || '|' || public.norm_name(a.name_ko), '|')
                     from public.performances p join public.artists a on a.id = p.artist_id where p.event_id = e.id), '') as txt
    from public.events e
    where e.published and e.ends_at > now()
  ),
  hits as (
    select distinct on (names.user_id, ev.id) names.user_id, ev.id as event_id, names.label
    from names join ev on strpos(ev.txt, names.key) > 0
    order by names.user_id, ev.id, names.label
  )
  insert into public.notifications (user_id, kind, event_id, reason)
  select user_id, 'artist', event_id, label || ' 출연' from hits
  on conflict (user_id, event_id, kind) do nothing;
  get diagnostics n1 = row_count;

  -- 2) 장르: 최근 8일 안에 새로 올라온 공연 중 좋아하는 장르와 겹치는 것
  insert into public.notifications (user_id, kind, event_id, reason)
  select distinct on (g.user_id, e.id) g.user_id, 'genre', e.id, g.genre || ' 공연'
  from public.user_genres g
  join public.events e on e.published and e.starts_at > now() and e.created_at > now() - interval '8 days'
  where (p_user is null or g.user_id = p_user)
    and (g.genre = any (e.genres) or exists (
      select 1 from public.performances p join public.artists a on a.id = p.artist_id
      where p.event_id = e.id and g.genre = any (a.genres)))
  order by g.user_id, e.id, g.genre
  on conflict (user_id, event_id, kind) do nothing;
  get diagnostics n2 = row_count;
  return n1 + n2;
end $$;

-- 함께 좋아하는 아티스트 쌍 다시 계산
create or replace function private.refresh_artist_pairs()
returns void language plpgsql security definer set search_path = '' as $$
begin
  create temp table if not exists _pairs on commit drop as
    select max(f1.name) as a, max(f2.name) as b, count(distinct f1.user_id)::int as users
    from public.favorite_artists f1
    join public.favorite_artists f2 on f2.user_id = f1.user_id and f2.norm <> f1.norm
    group by f1.norm, f2.norm
    having count(distinct f1.user_id) >= 2;
  merge into public.artist_pairs t
  using _pairs s on t.a = s.a and t.b = s.b
  when matched then update set users = s.users
  when not matched then insert (a, b, users) values (s.a, s.b, s.users)
  when not matched by source then delete;
end $$;

revoke all on function private.generate_notifications(uuid) from public;
revoke all on function private.refresh_artist_pairs() from public;
grant execute on function private.generate_notifications(uuid) to authenticated, service_role;

-- 로그인한 사용자가 자기 알림만 바로 새로 만들 때 (취향을 바꾼 직후)
create or replace function public.refresh_my_notifications()
returns int language sql security invoker set search_path = '' as $$
  select private.generate_notifications((select auth.uid()));
$$;
revoke all on function public.refresh_my_notifications() from public, anon;
grant execute on function public.refresh_my_notifications() to authenticated;

-- ============================================================
-- 티켓 오픈 · 공연 소식 검토 · 사용자 공연 제보
-- ============================================================
alter table public.events
  add column if not exists ticket_open_at timestamptz,
  add column if not exists source_url     text,
  add column if not exists review_note    text;
alter table public.events drop constraint if exists events_source_check;
alter table public.events add constraint events_source_check check (source in ('manual', 'kopis', 'news', 'report'));
create index if not exists events_ticket_open_idx on public.events(ticket_open_at) where ticket_open_at is not null;

create table if not exists public.event_submissions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users on delete cascade,
  title          text not null check (char_length(title) between 2 and 120),
  artist         text check (char_length(artist) <= 200),
  kind           text not null default 'concert' check (kind in ('festival', 'concert')),
  is_visit       boolean not null default false,
  starts_on      date,
  venue          text check (char_length(venue) <= 80),
  city           text check (char_length(city) <= 40),
  ticket_open_at timestamptz,
  ticket_url     text check (char_length(ticket_url) <= 500),
  source_url     text not null check (source_url ~* '^https?://' and char_length(source_url) <= 500),
  memo           text check (char_length(memo) <= 500),
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  event_id       uuid references public.events on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists event_submissions_status_idx on public.event_submissions(status, created_at desc);
create index if not exists event_submissions_user_idx on public.event_submissions(user_id);
create index if not exists event_submissions_event_idx on public.event_submissions(event_id);
alter table public.event_submissions enable row level security;
drop policy if exists "submissions insert own" on public.event_submissions;
drop policy if exists "submissions read" on public.event_submissions;
drop policy if exists "submissions admin update" on public.event_submissions;
drop policy if exists "submissions admin delete" on public.event_submissions;
create policy "submissions insert own" on public.event_submissions for insert
  with check (user_id = (select auth.uid()) and status = 'pending' and event_id is null);
create policy "submissions read" on public.event_submissions for select using (user_id = (select auth.uid()) or (select private.is_admin()));
create policy "submissions admin update" on public.event_submissions for update using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "submissions admin delete" on public.event_submissions for delete using ((select private.is_admin()));
revoke all on public.event_submissions from anon;

-- 공연에 관심 있는 사용자 (좋아하는 아티스트 출연)
create or replace function private.interested_users(p_user uuid default null)
returns table (user_id uuid, event_id uuid, label text)
language sql stable security definer set search_path = '' as $$
  with names as (
    select f.user_id, f.name as label, f.norm as key from public.favorite_artists f
    where (p_user is null or f.user_id = p_user) and char_length(f.norm) >= 2
    union
    select f.user_id, f.name, public.norm_name(x)
    from public.favorite_artists f
    join public.artists a on public.norm_name(a.name) = f.norm or public.norm_name(a.name_ko) = f.norm
                          or f.norm = any (select public.norm_name(y) from unnest(a.aliases) y)
    cross join lateral unnest(array[a.name, a.name_ko] || a.aliases) x
    where (p_user is null or f.user_id = p_user) and char_length(public.norm_name(x)) >= 2
  ),
  ev as (
    select e.id, public.norm_name(e.title) || '|' || public.norm_name(e.lineup) || '|' ||
           coalesce((select string_agg(public.norm_name(a.name) || '|' || public.norm_name(a.name_ko), '|')
                     from public.performances p join public.artists a on a.id = p.artist_id where p.event_id = e.id), '') as txt
    from public.events e where e.published and e.ends_at > now()
  )
  select distinct on (names.user_id, ev.id) names.user_id, ev.id, names.label
  from names join ev on strpos(ev.txt, names.key) > 0
  order by names.user_id, ev.id, names.label;
$$;
revoke all on function private.interested_users(uuid) from public;

-- 취향 알림 (아티스트 · 장르) — 위 버전을 대체해요
create or replace function private.generate_notifications(p_user uuid default null)
returns int language plpgsql security definer set search_path = '' as $$
declare n1 int; n2 int;
begin
  insert into public.notifications (user_id, kind, event_id, reason)
  select i.user_id, 'artist', i.event_id, i.label || ' 출연' from private.interested_users(p_user) i
  on conflict (user_id, event_id, kind) do nothing;
  get diagnostics n1 = row_count;
  insert into public.notifications (user_id, kind, event_id, reason)
  select distinct on (g.user_id, e.id) g.user_id, 'genre', e.id, g.genre || ' 공연'
  from public.user_genres g
  join public.events e on e.published and e.starts_at > now() and e.created_at > now() - interval '8 days'
  where (p_user is null or g.user_id = p_user)
    and not exists (select 1 from public.notifications n where n.user_id = g.user_id and n.event_id = e.id and n.kind = 'artist')
    and (g.genre = any (e.genres) or exists (
      select 1 from public.performances p join public.artists a on a.id = p.artist_id
      where p.event_id = e.id and g.genre = any (a.genres)))
  order by g.user_id, e.id, g.genre
  on conflict (user_id, event_id, kind) do nothing;
  get diagnostics n2 = row_count;
  return n1 + n2;
end $$;

-- 티켓 오픈 알림: 'd1' = 6~30시간 전 (매일 아침), 'h1' = 75분 안 (매시간)
create or replace function private.generate_ticket_alerts(p_kind text default 'both')
returns int language plpgsql security definer set search_path = '' as $$
declare n1 int := 0; n2 int := 0;
begin
  if p_kind in ('d1', 'both') then
    with targets as (
      select i.user_id, i.event_id, i.label || ' 공연' as why from private.interested_users(null) i
      union select f.user_id, f.event_id, '담아 둔 공연' from public.follows f
    )
    insert into public.notifications (user_id, kind, event_id, reason)
    select distinct on (t.user_id, e.id) t.user_id, 'ticket_d1', e.id,
           '티켓 오픈 ' || to_char(e.ticket_open_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI') || ' · ' || t.why
    from targets t join public.events e on e.id = t.event_id
    where e.published and e.ticket_open_at > now() + interval '75 minutes' and e.ticket_open_at <= now() + interval '30 hours'
    order by t.user_id, e.id
    on conflict (user_id, event_id, kind) do nothing;
    get diagnostics n1 = row_count;
  end if;
  if p_kind in ('h1', 'both') then
    with targets as (
      select i.user_id, i.event_id, i.label || ' 공연' as why from private.interested_users(null) i
      union select f.user_id, f.event_id, '담아 둔 공연' from public.follows f
    )
    insert into public.notifications (user_id, kind, event_id, reason)
    select distinct on (t.user_id, e.id) t.user_id, 'ticket_h1', e.id,
           '곧 티켓 오픈 · 오늘 ' || to_char(e.ticket_open_at at time zone 'Asia/Seoul', 'HH24:MI') || ' · ' || t.why
    from targets t join public.events e on e.id = t.event_id
    where e.published and e.ticket_open_at > now() and e.ticket_open_at <= now() + interval '75 minutes'
    order by t.user_id, e.id
    on conflict (user_id, event_id, kind) do nothing;
    get diagnostics n2 = row_count;
  end if;
  return n1 + n2;
end $$;
revoke all on function private.generate_ticket_alerts(text) from public;

-- ============================================================
-- 아티스트 추천용: 비슷한 아티스트 (셋리뷰가 정리한 목록, 운영자 화면 · 매일 수집 작업이 채워요)
-- ============================================================
alter table public.artists add column if not exists similar_artists text[] not null default '{}';
create index if not exists artists_name_norm_idx on public.artists (public.norm_name(name));
