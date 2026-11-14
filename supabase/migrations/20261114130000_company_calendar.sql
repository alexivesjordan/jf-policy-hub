-- Company calendar. Staff can read. Admins can write.
-- request_status is confirmed for entries an admin adds now.
-- requested and declined are reserved for holiday booking requests later.
-- Resource holidays stay in ops.unavailability and are read, not copied.
-- New file only. Do not edit earlier migrations. Do not apply this to production.

create table public.calendar_entries (
  id uuid primary key default gen_random_uuid(),
  entry_type text not null
    check (entry_type in ('annual_leave', 'sick', 'other_absence', 'company_event')),
  profile_id uuid references public.profiles (id) on delete set null,
  starts_on date not null,
  ends_on date not null,
  notes text,
  request_status text not null default 'confirmed'
    check (request_status in ('confirmed', 'requested', 'declined')),
  requested_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  check (notes is null or char_length(notes) <= 500)
);

comment on table public.calendar_entries is
  'Company calendar. profile_id is optional so a company event needs no person. request_status requested/declined is unused until holiday booking requests exist.';

comment on column public.calendar_entries.request_status is
  'confirmed: on the calendar. requested/declined: reserved for a later holiday request, not written by the current admin form.';

create index calendar_entries_span_idx on public.calendar_entries (starts_on, ends_on);
create index calendar_entries_profile_idx on public.calendar_entries (profile_id, starts_on);

create trigger calendar_entries_touch_updated_at
before update on public.calendar_entries
for each row execute function public.touch_updated_at();

alter table public.calendar_entries enable row level security;

revoke all on public.calendar_entries from public, anon, authenticated;
grant select, insert, update, delete on public.calendar_entries to authenticated;
grant all on public.calendar_entries to service_role;

create policy "Signed-in staff read the company calendar"
on public.calendar_entries
for select
to authenticated
using (public.is_active_user());

create policy "Admins add calendar entries"
on public.calendar_entries
for insert
to authenticated
with check (public.is_active_user() and (public.is_admin() or public.workspace_is_admin()));

create policy "Admins update calendar entries"
on public.calendar_entries
for update
to authenticated
using (public.is_active_user() and (public.is_admin() or public.workspace_is_admin()))
with check (public.is_active_user() and (public.is_admin() or public.workspace_is_admin()));

create policy "Admins remove calendar entries"
on public.calendar_entries
for delete
to authenticated
using (public.is_active_user() and (public.is_admin() or public.workspace_is_admin()));

create or replace function public.people_resource_absence(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, public
as $$
begin
  if not public.is_active_user() then
    raise exception 'app: You cannot see the calendar.';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'app: Choose a date range.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', u.id,
      'name', r.name,
      'startsOn', u.starts_on,
      'endsOn', u.ends_on,
      'reason', u.reason,
      'notes', u.notes
    ) order by u.starts_on, r.name)
    from ops.unavailability u
    join ops.resources r on r.id = u.resource_id
    where u.ends_on >= p_from
      and u.starts_on <= p_to
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.people_resource_absence(date, date) from public, anon;
grant execute on function public.people_resource_absence(date, date) to authenticated, service_role;
