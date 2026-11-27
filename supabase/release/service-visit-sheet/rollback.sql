-- Rolls back 20261128520000_service_visit_sheet.sql.
-- Destructive: deletes service job sheets and their "Kit still to follow" tasks.
-- Service visits, completion notes, and the older visit photos stay.
-- Install job sheets stay. Not for production. Try it inside a transaction on TEST first.

delete from core.tasks
where id in (
  select follow_up_task_id
  from ops.visit_sheets
  where service_visit_id is not null
    and follow_up_task_id is not null
);

delete from ops.visit_sheets
where service_visit_id is not null;

drop function if exists public.service_visit_sheet(uuid);
drop function if exists public.service_save_visit_sheet(uuid, jsonb, uuid[]);
drop function if exists public.service_visit_upload_gate(uuid, text);

alter table ops.visit_sheets drop constraint if exists visit_sheets_one_job;
drop index if exists ops.visit_sheets_service_uidx;
alter table ops.visit_sheets drop column if exists service_visit_id;
alter table ops.visit_sheets alter column install_id set not null;

create or replace function public.service_visit_set_progress(
  p_visit uuid,
  p_status text,
  p_note text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = svc, public
as $$
declare
  v_status text := svc.clean_text(p_status, 20);
  v_note text := svc.clean_text(p_note, 2000);
  v_reason text := svc.clean_text(p_reason, 500);
begin
  if not (svc.visit_mine(p_visit) or svc.office('edit')) then
    raise exception 'app: You cannot update that visit.';
  end if;
  if v_status is null or v_status not in ('scheduled', 'en_route', 'on_site', 'done', 'incomplete') then
    raise exception 'app: Choose a status.';
  end if;
  if v_status = 'incomplete' and v_reason is null then
    raise exception 'app: Add a reason.';
  end if;
  update svc.visits
  set status = v_status,
      completion_note = v_note,
      incomplete_reason = case when v_status = 'incomplete' then v_reason else null end,
      arrived_at = case
        when v_status = 'on_site' then coalesce(arrived_at, now())
        else arrived_at
      end,
      completed_at = case
        when v_status in ('done', 'incomplete') then coalesce(completed_at, now())
        when v_status in ('scheduled', 'en_route') then null
        else completed_at
      end
  where id = p_visit;
  if not found then
    raise exception 'app: That visit was not found.';
  end if;
end;
$$;

grant execute on function public.service_visit_add_photo(uuid, uuid) to authenticated;
