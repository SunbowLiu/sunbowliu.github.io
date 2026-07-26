create table if not exists visitor_locations (
  id bigint generated always as identity primary key,
  country text,
  city text,
  lat double precision,
  lng double precision,
  visited_at timestamptz default now()
);

alter table visitor_locations enable row level security;

drop policy if exists "Allow anonymous visitor insert" on visitor_locations;
drop policy if exists "Allow anonymous visitor select" on visitor_locations;

create policy "Allow anonymous visitor insert"
  on visitor_locations
  for insert
  to anon
  with check (true);

create policy "Allow anonymous visitor select"
  on visitor_locations
  for select
  to anon
  using (true);
