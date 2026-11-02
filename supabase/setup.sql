-- Floorboard: shared server setup for Supabase.
-- Run once in your project: SQL Editor -> New query -> paste all of this -> Run.
-- The result at the bottom shows your store code and your own setup code. Keep both.
-- Safe to run again: it only creates what's missing and never overwrites your store's data.

-- 1. Tables ---------------------------------------------------------------
-- Everything the app shows (people, departments, chats, messages, tasks, files...) is stored as
-- small JSON records, one per item, so the app can sync them live.
create table if not exists public.records (
  coll text not null,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (coll, id)
);
-- Which sign-in belongs to which staff member.
create table if not exists public.members (
  auth_uid uuid primary key references auth.users (id) on delete cascade,
  staff_id text not null unique
);
-- Hidden sign-in name per staff member (staff only ever see their own name and a PIN).
create table if not exists public.logins (
  staff_id text primary key,
  handle text not null unique
);
-- One-time setup codes a manager gives a new person (they expire after 14 days or 5 wrong tries).
create table if not exists public.setup_codes (
  staff_id text primary key,
  code text not null,
  tries int not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.store_settings (
  id int primary key default 1 check (id = 1),
  store_code text not null
);

alter table public.records enable row level security;
alter table public.members enable row level security;
alter table public.logins enable row level security;
alter table public.setup_codes enable row level security;
alter table public.store_settings enable row level security;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
drop trigger if exists records_touch on public.records;
create trigger records_touch before update on public.records for each row execute function public.touch_updated_at();

-- 2. Who is who -----------------------------------------------------------
create or replace function public.my_staff_id() returns text
language sql stable security definer set search_path = public as $$
  select staff_id from members where auth_uid = auth.uid()
$$;
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where auth_uid = auth.uid())
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from members m join records r on r.coll = 'users' and r.id = m.staff_id
    where m.auth_uid = auth.uid() and r.data->>'role' = 'admin' and coalesce((r.data->>'active')::boolean, true)
  )
$$;

-- 3. Access rules ---------------------------------------------------------
-- Only signed-in staff of this store can read or change anything.
-- Personal pins are private to their owner. Only admins can change people, departments and store settings.
drop policy if exists "members read own row" on public.members;
create policy "members read own row" on public.members for select using (auth_uid = auth.uid());

drop policy if exists "staff read" on public.records;
create policy "staff read" on public.records for select
  using (public.is_member() and (coll <> 'pins' or id = public.my_staff_id()));
drop policy if exists "staff add" on public.records;
create policy "staff add" on public.records for insert
  with check (public.is_member() and (coll <> 'pins' or id = public.my_staff_id())
              and (coll not in ('users', 'depts', 'meta') or public.is_admin()));
drop policy if exists "staff change" on public.records;
create policy "staff change" on public.records for update
  using (public.is_member() and (coll <> 'pins' or id = public.my_staff_id())
         and (coll not in ('users', 'depts', 'meta') or public.is_admin()))
  with check (public.is_member() and (coll <> 'pins' or id = public.my_staff_id())
              and (coll not in ('users', 'depts', 'meta') or public.is_admin()));
drop policy if exists "staff remove" on public.records;
create policy "staff remove" on public.records for delete
  using (public.is_member() and (coll <> 'pins' or id = public.my_staff_id())
         and (coll not in ('users', 'depts', 'meta') or public.is_admin()));

-- 4. Logging in -----------------------------------------------------------
-- The login screen lists names only after the right store code is typed.
create or replace function public.staff_directory(p_code text)
returns table (id text, name text, title text, dept text, dept_name text, handle text, claimed boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from store_settings s where s.store_code = upper(trim(p_code))) then
    raise exception 'That store code is not right';
  end if;
  return query
    select r.id, r.data->>'name', r.data->>'title', r.data->'depts'->>0,
           (select d.data->>'name' from records d where d.coll = 'depts' and d.id = r.data->'depts'->>0),
           l.handle, exists (select 1 from members m where m.staff_id = r.id)
    from records r join logins l on l.staff_id = r.id
    where r.coll = 'users' and coalesce((r.data->>'active')::boolean, true)
    order by r.data->>'name';
end $$;

-- First login: links the new sign-in to the staff member if the setup code is right.
-- Returns false (instead of an error) on a wrong code so the failed try is counted.
create or replace function public.claim_login(p_staff text, p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  if not exists (select 1 from setup_codes where staff_id = p_staff and code = p_code and tries < 5
                 and created_at > now() - interval '14 days') then
    update setup_codes set tries = tries + 1 where staff_id = p_staff;
    return false;
  end if;
  delete from members where staff_id = p_staff or auth_uid = auth.uid();
  insert into members (auth_uid, staff_id) values (auth.uid(), p_staff);
  delete from setup_codes where staff_id = p_staff;
  return true;
end $$;

-- Admins make a setup code for a new person, or to reset someone's forgotten PIN.
create or replace function public.new_setup_code(p_staff text) returns text
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not public.is_admin() then raise exception 'Only admins can make setup codes'; end if;
  if p_staff = public.my_staff_id() then raise exception 'Ask another admin to reset your own login'; end if;
  if not exists (select 1 from records where coll = 'users' and id = p_staff) then raise exception 'Unknown person'; end if;
  v_code := lpad(floor(random() * 1000000)::int::text, 6, '0');
  insert into setup_codes (staff_id, code) values (p_staff, v_code)
    on conflict (staff_id) do update set code = excluded.code, tries = 0, created_at = now();
  -- a new code also resets their login: a fresh hidden sign-in name, and the old one is unlinked
  insert into logins (staff_id, handle) values (p_staff, replace(gen_random_uuid()::text, '-', ''))
    on conflict (staff_id) do update set handle = excluded.handle;
  delete from members where staff_id = p_staff;
  return v_code;
end $$;

-- Admins see which people have finished setting up their login.
create or replace function public.login_status() returns table (staff_id text, claimed boolean, code_waiting boolean)
language sql stable security definer set search_path = public as $$
  select r.id, exists (select 1 from members m where m.staff_id = r.id),
         exists (select 1 from setup_codes s where s.staff_id = r.id and s.tries < 5 and s.created_at > now() - interval '14 days')
  from records r where r.coll = 'users' and public.is_admin()
$$;

revoke all on function public.staff_directory(text) from public;
revoke all on function public.claim_login(text, text) from public;
revoke all on function public.new_setup_code(text) from public;
revoke all on function public.login_status() from public;
grant execute on function public.staff_directory(text) to anon, authenticated;
grant execute on function public.claim_login(text, text) to authenticated;
grant execute on function public.new_setup_code(text) to authenticated;
grant execute on function public.login_status() to authenticated;

-- 5. Live updates ---------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.records;
exception when duplicate_object then null; end $$;

-- 6. Photos, videos, voice notes and documents ---------------------------
insert into storage.buckets (id, name, public) values ('files', 'files', false) on conflict (id) do nothing;
drop policy if exists "staff read files" on storage.objects;
create policy "staff read files" on storage.objects for select to authenticated
  using (bucket_id = 'files' and public.is_member());
drop policy if exists "staff add files" on storage.objects;
create policy "staff add files" on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and public.is_member());

-- 7. Your store: departments, their group chats and drives, and your admin login ----
do $$
declare
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
  v_depts jsonb := '[
    {"id":"mgmt","name":"Management","color":"#3D4A5C","icon":"📋"},
    {"id":"admin","name":"Admin","color":"#0F8A8A","icon":"📝"},
    {"id":"finance","name":"Finance","color":"#2F7FB8","icon":"💰"},
    {"id":"bakery","name":"Bakery","color":"#9A6B2F","icon":"🍞"},
    {"id":"deli","name":"Hot Deli","color":"#D0622B","icon":"🔥"},
    {"id":"fv","name":"Fruit & Veg","color":"#3F8A2E","icon":"🍌"},
    {"id":"tills","name":"Tills & Front End","color":"#8A4FB8","icon":"🛒"},
    {"id":"receiving","name":"Receiving","color":"#6F7D1F","icon":"🚚"}
  ]';
  d jsonb;
begin
  if exists (select 1 from store_settings) then return; end if;
  insert into store_settings (store_code) values (upper(substr(md5(random()::text), 1, 6)));
  insert into records (coll, id, data) values ('meta', 'store', '{"store":"My store"}');
  for d in select * from jsonb_array_elements(v_depts) loop
    insert into records (coll, id, data) values
      ('depts', d->>'id', jsonb_build_object('id', d->>'id', 'name', d->>'name', 'color', d->>'color',
        'features', jsonb_build_object('tools', false, 'drive', false))),
      ('chats', 'c-' || (d->>'id'), jsonb_build_object('id', 'c-' || (d->>'id'), 'kind', 'group', 'name', d->>'name',
        'icon', d->>'icon', 'color', d->>'color', 'dept', d->>'id', 'members', '[]'::jsonb, 'createdBy', 'u-admin', 'createdAt', v_now)),
      ('drives', 'd-' || (d->>'id'), jsonb_build_object('id', 'd-' || (d->>'id'), 'name', d->>'name',
        'access', jsonb_build_array(d->>'id', 'mgmt'), 'desc', (d->>'name') || ' documents.'));
  end loop;
  insert into records (coll, id, data) values
    ('chats', 'c-all', jsonb_build_object('id', 'c-all', 'kind', 'group', 'name', 'Whole store', 'icon', '🏪',
      'color', '#5E6B65', 'dept', 'all', 'members', '[]'::jsonb, 'createdBy', 'u-admin', 'createdAt', v_now)),
    ('drives', 'd-shared', jsonb_build_object('id', 'd-shared', 'name', 'Shared', 'access', jsonb_build_array('all'),
      'desc', 'Forms, policies and rosters for everyone.')),
    ('users', 'u-admin', jsonb_build_object('id', 'u-admin', 'name', 'Store admin', 'title', 'Store Manager', 'role', 'admin',
      'depts', jsonb_build_array('mgmt'), 'manages', jsonb_build_array('mgmt'), 'active', true));
  insert into logins (staff_id, handle) values ('u-admin', replace(gen_random_uuid()::text, '-', ''));
  insert into setup_codes (staff_id, code) values ('u-admin', lpad(floor(random() * 1000000)::int::text, 6, '0'));
end $$;

select 'Store code (everyone types this once on each phone or computer)' as what, store_code as value from public.store_settings
union all
select 'Your setup code (log in as "Store admin" with this the first time)', code from public.setup_codes where staff_id = 'u-admin';
