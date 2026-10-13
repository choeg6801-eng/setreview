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
