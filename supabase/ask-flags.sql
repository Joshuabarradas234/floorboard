-- Floorboard: Ask Floorboard's flagged questions (questions to the work assistant that clearly weren't about work).
-- Run once in your project: SQL Editor -> New query -> paste all of this -> Run. Safe to run again.
-- (It's also in setup.sql for new stores; this file is for a store that's already set up.)
-- Only the store's admins can read them or clear them; only the ask function adds them (with the server's own key).
create table if not exists public.ask_flags (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  staff_id text not null,
  name text,
  title text,
  question text not null,
  why text
);
alter table public.ask_flags enable row level security;
drop policy if exists "admins read flags" on public.ask_flags;
create policy "admins read flags" on public.ask_flags for select using (public.is_admin());
drop policy if exists "admins clear flags" on public.ask_flags;
create policy "admins clear flags" on public.ask_flags for delete using (public.is_admin());

select 'Ask Floorboard flags are ready' as done;
