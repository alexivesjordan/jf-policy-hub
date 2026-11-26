-- Aftersales and Operations can plan service visits. Overlapping windows warn until confirmed.
-- Install bookings and leave stay hard blocks. New file only. Do not apply this to production.

insert into public.workspace_team_access (team_id, module_id, access_level)
select t.id, 'service', 'edit'
from public.workspace_teams t
where t.name in ('Aftersales', 'Operations')
  and t.archived_at is null
on conflict (team_id, module_id) do update
set access_level = excluded.access_level
where public.workspace_team_access.access_level is distinct from excluded.access_level;

create or replace function svc.overlap_warning(p_visit uuid)
returns text
language sql
stable
set search_path = svc, ops, public
as $$
  select case
    when listed is null then null
    else 'app: These times overlap with ' || listed || '.'
  end
  from (
    select string_agg(
      r.name || ' at ' || s.customer_name || ' ('
        || to_char(other.window_start, 'HH24:MI') || '–' || to_char(other.window_end, 'HH24:MI') || ')',
      ', ' order by r.name, s.customer_name, other.window_start
    ) as listed
    from svc.visits mine
    join svc.visit_assignees mine_a on mine_a.visit_id = mine.id
    join ops.resources r on r.id = mine_a.resource_id
    join svc.visit_assignees other_a on other_a.resource_id = mine_a.resource_id
    join svc.visits other on other.id = other_a.visit_id
    join svc.sites s on s.id = other.site_id
    where mine.id = p_visit
      and mine.window_start is not null
      and mine.window_end is not null
      and other.id is distinct from mine.id
      and other.visit_on = mine.visit_on
      and other.window_start is not null
      and other.window_end is not null
      and other.window_start < mine.window_end
      and mine.window_start < other.window_end
  ) clashes;
$$;

revoke all on function svc.overlap_warning(uuid) from public, anon, authenticated;

alter function public.service_visit_save(uuid, jsonb) rename to service_visit_save_body;
alter function public.service_visit_arrange(uuid, uuid, uuid, date, integer) rename to service_visit_arrange_body;

revoke all on function public.service_visit_save_body(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.service_visit_arrange_body(uuid, uuid, uuid, date, integer) from public, anon, authenticated;

create or replace function public.service_visit_save(p_id uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = svc, public
as $$
declare
  v_id uuid;
  v_warning text;
begin
  if not svc.office('edit') then
    raise exception 'app: You cannot change service visits.';
  end if;
  v_id := public.service_visit_save_body(p_id, p_payload);
  if coalesce(p_payload->>'confirmOverlap', '') is distinct from 'true' then
    v_warning := svc.overlap_warning(v_id);
    if v_warning is not null then
      raise exception '%', v_warning;
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.service_visit_arrange(
  p_visit uuid,
  p_from uuid,
  p_to uuid,
  p_day date,
  p_index integer,
  p_confirm boolean default false
)
returns void
language plpgsql
security definer
set search_path = svc, public
as $$
declare
  v_warning text;
begin
  if not svc.office('edit') then
    raise exception 'app: You cannot change service visits.';
  end if;
  perform public.service_visit_arrange_body(p_visit, p_from, p_to, p_day, p_index);
  if coalesce(p_confirm, false) is distinct from true then
    v_warning := svc.overlap_warning(p_visit);
    if v_warning is not null then
      raise exception '%', v_warning;
    end if;
  end if;
end;
$$;

revoke all on function public.service_visit_save(uuid, jsonb) from public, anon;
revoke all on function public.service_visit_arrange(uuid, uuid, uuid, date, integer, boolean) from public, anon;
grant execute on function public.service_visit_save(uuid, jsonb) to authenticated, service_role;
grant execute on function public.service_visit_arrange(uuid, uuid, uuid, date, integer, boolean) to authenticated, service_role;
