-- Rolls back 20261128800000_service_routes_and_plans.sql.
-- DESTRUCTIVE: copies plan rows to backup tables, then drops svc.maintenance_plans
-- and svc.visits.maintenance_plan_id. Visit rows stay. The backup tables stay.
-- New file only. Do not apply to production.

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

drop function if exists public.svc_set_route(uuid, date, uuid[]);
drop function if exists public.svc_route_day(uuid, date);
drop function if exists public.svc_set_site_point(uuid, numeric, numeric);
drop function if exists public.svc_advance_plan(uuid);
drop function if exists public.svc_list_plans();
drop function if exists public.svc_eligible_installs();
drop function if exists public.svc_create_plan(uuid, date, date);
drop function if exists public.svc_set_plan_status(uuid, text);
drop function if exists public.svc_due_plans(integer);
drop function if exists public.svc_plan_prefill(uuid);

do $$
begin
  if to_regclass('svc.maintenance_plans') is not null then
    drop table if exists svc.maintenance_plans_backup_20261128800000;
    create table svc.maintenance_plans_backup_20261128800000 as
    select * from svc.maintenance_plans;
    alter table svc.maintenance_plans_backup_20261128800000 enable row level security;
    revoke all on svc.maintenance_plans_backup_20261128800000 from public, anon, authenticated;
    grant all on svc.maintenance_plans_backup_20261128800000 to service_role;
  end if;
  if to_regclass('svc.visits') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'svc' and table_name = 'visits' and column_name = 'maintenance_plan_id'
     )
  then
    drop table if exists svc.visit_plan_links_backup_20261128800000;
    create table svc.visit_plan_links_backup_20261128800000 as
    select id as visit_id, maintenance_plan_id
    from svc.visits
    where maintenance_plan_id is not null;
    alter table svc.visit_plan_links_backup_20261128800000 enable row level security;
    revoke all on svc.visit_plan_links_backup_20261128800000 from public, anon, authenticated;
    grant all on svc.visit_plan_links_backup_20261128800000 to service_role;
  end if;
end
$$;

alter table svc.visits drop column if exists maintenance_plan_id;

drop table if exists svc.maintenance_plans;

drop function if exists svc.add_months(date, integer);
drop function if exists svc.split_site_address(text);
drop function if exists svc.plan_cadence(text);
