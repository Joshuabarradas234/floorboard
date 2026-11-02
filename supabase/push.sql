-- Floorboard: alerts on phones and computers when the app is closed, and on shift / off shift.
-- Run once after setup.sql: SQL Editor -> New query -> paste -> Run. Safe to run again.

-- Each phone or computer that turned alerts on. Only the server function reads this.
create table if not exists public.push_subs (
  endpoint text primary key,
  staff_id text not null,
  p256dh text not null,
  auth text not null,
  device text,
  created_at timestamptz not null default now()
);
alter table public.push_subs enable row level security;
-- (no policies: nobody can read or change it directly, only through the two functions below)

-- Turn alerts on for this device, for whoever is logged in on it.
create or replace function public.save_push_sub(p_endpoint text, p_p256dh text, p_auth text, p_device text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if public.my_staff_id() is null then return false; end if;
  insert into push_subs (endpoint, staff_id, p256dh, auth, device)
    values (p_endpoint, public.my_staff_id(), p_p256dh, p_auth, left(p_device, 160))
    on conflict (endpoint) do update set staff_id = excluded.staff_id, p256dh = excluded.p256dh,
      auth = excluded.auth, device = excluded.device, created_at = now();
  return true;
end $$;

-- Turn them off again (logging out does this, so a shared phone stops getting someone else's alerts).
create or replace function public.remove_push_sub(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from push_subs where endpoint = p_endpoint and staff_id = public.my_staff_id()
$$;

revoke all on function public.save_push_sub(text, text, text, text) from public;
revoke all on function public.remove_push_sub(text) from public;
grant execute on function public.save_push_sub(text, text, text, text) to authenticated;
grant execute on function public.remove_push_sub(text) to authenticated;


-- On shift / off shift: everyone can see who is on, but only you (or an admin) can change yours.
drop policy if exists "own shift add" on public.records;
create policy "own shift add" on public.records as restrictive for insert to authenticated
  with check (coll <> 'status' or id = public.my_staff_id() or public.is_admin());
drop policy if exists "own shift change" on public.records;
create policy "own shift change" on public.records as restrictive for update to authenticated
  using (coll <> 'status' or id = public.my_staff_id() or public.is_admin())
  with check (coll <> 'status' or id = public.my_staff_id() or public.is_admin());
drop policy if exists "own shift remove" on public.records;
create policy "own shift remove" on public.records as restrictive for delete to authenticated
  using (coll <> 'status' or id = public.my_staff_id() or public.is_admin());

-- Tell the API to pick up the new functions straight away.
notify pgrst, 'reload schema';

select 'Phone alerts are ready in the database' as done;
