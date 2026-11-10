-- ترابری: جداول، دسترسی‌ها (RLS) و realtime

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  full_name text not null,
  phone text,
  vehicle text,
  role text not null check (role in ('supervisor','driver')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.stores (
  id bigint generated always as identity primary key,
  name text not null check (length(name) between 1 and 200),
  city text,
  address text,
  phone text,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.trips (
  id bigint generated always as identity primary key,
  driver_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  plan_date date not null default current_date,
  status text not null default 'planned' check (status in ('planned','active','done','cancelled')),
  origin_name text,
  origin_lat double precision not null,
  origin_lng double precision not null,
  -- مسیر چیدمان بار (روز قبل)
  load_order bigint[] ,
  load_geometry jsonb,
  load_distance_m double precision,
  load_duration_s double precision,
  -- مسیر فعلی (هنگام شروع حرکت دوباره محاسبه می‌شود)
  planned_geometry jsonb,
  planned_distance_m double precision,
  planned_duration_s double precision,
  replanned_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index trips_driver_idx on public.trips(driver_id, plan_date desc);

create table public.trip_stops (
  id bigint generated always as identity primary key,
  trip_id bigint not null references public.trips(id) on delete cascade,
  store_id bigint references public.stores(id) on delete set null,
  name text not null,
  address text,
  lat double precision not null,
  lng double precision not null,
  priority int check (priority is null or priority between 1 and 20),
  load_seq int,       -- ترتیب در برنامه‌ی چیدمان
  seq int,            -- ترتیب فعلی
  eta timestamptz,
  leg_distance_m double precision,
  leg_duration_s double precision,
  status text not null default 'pending' check (status in ('pending','arrived','delivered','skipped')),
  arrived_at timestamptz,
  delivered_at timestamptz,
  note text
);
create index trip_stops_trip_idx on public.trip_stops(trip_id, seq);
create index trip_stops_store_idx on public.trip_stops(store_id);

create table public.gps_points (
  id bigint generated always as identity primary key,
  trip_id bigint references public.trips(id) on delete cascade,
  driver_id uuid not null references public.profiles(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy double precision,
  speed double precision,
  heading double precision,
  recorded_at timestamptz not null default now()
);
create index gps_trip_idx on public.gps_points(trip_id, recorded_at);
create index gps_driver_idx on public.gps_points(driver_id, recorded_at desc);

-- آخرین موقعیت هر راننده (برای نمایش زنده حتی بدون سفر فعال)
create table public.driver_locations (
  driver_id uuid primary key references public.profiles(id) on delete cascade,
  trip_id bigint references public.trips(id) on delete set null,
  lat double precision not null,
  lng double precision not null,
  accuracy double precision,
  speed double precision,
  heading double precision,
  updated_at timestamptz not null default now()
);

-- توابع کمکی
create or replace function public.is_supervisor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'supervisor' and active)
$$;

create or replace function public.owns_trip(t bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.trips where id = t and driver_id = auth.uid())
$$;

revoke all on function public.is_supervisor() from public, anon;
revoke all on function public.owns_trip(bigint) from public, anon;
grant execute on function public.is_supervisor() to authenticated;
grant execute on function public.owns_trip(bigint) to authenticated;

alter table public.profiles enable row level security;
alter table public.stores enable row level security;
alter table public.trips enable row level security;
alter table public.trip_stops enable row level security;
alter table public.gps_points enable row level security;
alter table public.driver_locations enable row level security;

-- profiles: هر کس خودش؛ سرپرست همه. ساخت/حذف فقط از طریق edge function
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_supervisor()));
create policy profiles_update_sup on public.profiles for update to authenticated
  using ((select public.is_supervisor())) with check ((select public.is_supervisor()));

-- stores: همه‌ی کاربران وارد شده می‌بینند و اضافه می‌کنند؛ ویرایش/حذف سرپرست یا سازنده
create policy stores_select on public.stores for select to authenticated using (true);
create policy stores_insert on public.stores for insert to authenticated
  with check (created_by = (select auth.uid()));
create policy stores_update on public.stores for update to authenticated
  using ((select public.is_supervisor()) or created_by = (select auth.uid()));
create policy stores_delete on public.stores for delete to authenticated
  using ((select public.is_supervisor()) or created_by = (select auth.uid()));

-- trips
create policy trips_select on public.trips for select to authenticated
  using (driver_id = (select auth.uid()) or (select public.is_supervisor()));
create policy trips_insert on public.trips for insert to authenticated
  with check (driver_id = (select auth.uid()) or (select public.is_supervisor()));
create policy trips_update on public.trips for update to authenticated
  using (driver_id = (select auth.uid()) or (select public.is_supervisor()))
  with check (driver_id = (select auth.uid()) or (select public.is_supervisor()));
create policy trips_delete on public.trips for delete to authenticated
  using ((select public.is_supervisor()) or (driver_id = (select auth.uid()) and status = 'planned'));

-- trip_stops
create policy stops_all on public.trip_stops for all to authenticated
  using ((select public.is_supervisor()) or public.owns_trip(trip_id))
  with check ((select public.is_supervisor()) or public.owns_trip(trip_id));

-- gps: راننده فقط برای خودش ثبت می‌کند
create policy gps_select on public.gps_points for select to authenticated
  using (driver_id = (select auth.uid()) or (select public.is_supervisor()));
create policy gps_insert on public.gps_points for insert to authenticated
  with check (driver_id = (select auth.uid()) and (trip_id is null or public.owns_trip(trip_id)));

create policy loc_select on public.driver_locations for select to authenticated
  using (driver_id = (select auth.uid()) or (select public.is_supervisor()));
create policy loc_insert on public.driver_locations for insert to authenticated
  with check (driver_id = (select auth.uid()));
create policy loc_update on public.driver_locations for update to authenticated
  using (driver_id = (select auth.uid())) with check (driver_id = (select auth.uid()));

-- realtime برای پنل سرپرست
alter publication supabase_realtime add table public.gps_points, public.driver_locations, public.trip_stops, public.trips;
