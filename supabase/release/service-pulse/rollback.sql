-- Removes Pulse Service. Restores install availability to installs, legacy reservations, and unavailability only.
-- Destructive: drops svc and every service visit, site, asset, and photo row.
-- Does not delete install bookings, people, or files already stored in storage.
-- Not for production until the forward migration has been applied and this has been tried on TEST.

create or replace function ops.resource_free_for_days(p_resource uuid, p_days date[])
returns boolean
language sql
stable
as $$
  select not exists (
    select 1
    from unnest(p_days) as needed(day)
    where exists (
      select 1 from ops.install_reservations held
      where held.resource_id = p_resource and held.day = needed.day
    )
    or exists (
      select 1 from ops.reservations older
      where older.resource_id = p_resource and older.day = needed.day
    )
    or exists (
      select 1 from ops.unavailability away
      where away.resource_id = p_resource and needed.day between away.starts_on and away.ends_on
    )
  );
$$;

revoke all on function ops.resource_free_for_days(uuid, date[]) from public, anon, authenticated;

drop function if exists public.service_visit_add_photo(uuid, uuid);
drop function if exists public.service_visit_photo_allowed(uuid);
drop function if exists public.service_visit_set_progress(uuid, text, text, text);
drop function if exists public.service_visit_delete(uuid);
drop function if exists public.service_visit_arrange(uuid, uuid, uuid, date, integer);
drop function if exists public.service_visit_save(uuid, jsonb);
drop function if exists public.service_visit_day();
drop function if exists public.service_visit_open(uuid);
drop function if exists public.service_board(date, date);
drop function if exists public.service_people();

drop function if exists ops.person_day_conflicts(uuid, date, uuid);

drop schema if exists svc cascade;

update core.pulses
set name = 'Service', status = 'coming-soon'
where id = 'service';
