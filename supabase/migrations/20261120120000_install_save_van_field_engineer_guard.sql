-- Issue #45. Behaviour unchanged. New file only.
-- Replaces public.install_save_van(uuid, text, text, boolean, text, date, date, date, date, text)
-- from 20261114140000_fleet_and_schedule.sql. That function already requires
-- public.workspace_is_admin(), and ops.is_field_engineer() is false for admins,
-- so a field engineer was already refused with the same error. The new check is
-- only the explicit refusal the grant audit expects.
-- Do not edit earlier migrations.

create or replace function public.install_save_van(
  p_id uuid,
  p_registration text,
  p_name text,
  p_active boolean,
  p_make_model text default null,
  p_mot_due date default null,
  p_tax_due date default null,
  p_insurance_due date default null,
  p_service_due date default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_reg text := upper(regexp_replace(btrim(coalesce(p_registration, '')), '[[:space:]]+', ' ', 'g'));
  v_key text := regexp_replace(v_reg, '[[:space:]]', '', 'g');
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_model text := nullif(btrim(coalesce(p_make_model, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_before jsonb;
  v_id uuid := p_id;
begin
  if ops.is_field_engineer() then
    raise exception 'app: You cannot change the vans.';
  end if;
  if not public.workspace_is_admin() then
    raise exception 'app: You cannot change the vans.';
  end if;
  if v_key = '' or char_length(v_key) > 12 then
    raise exception 'app: Enter the registration.';
  end if;
  if v_name is not null and char_length(v_name) > 80 then
    raise exception 'app: Enter a shorter name.';
  end if;
  if v_model is not null and char_length(v_model) > 80 then
    raise exception 'app: Enter a shorter make and model.';
  end if;
  if v_notes is not null and char_length(v_notes) > 2000 then
    raise exception 'app: Shorten the note.';
  end if;
  if exists (
    select 1 from ops.vans
    where regexp_replace(upper(registration), '[[:space:]]', '', 'g') = v_key
      and id is distinct from p_id
  ) then
    raise exception 'app: That registration is already on the list.';
  end if;
  if p_id is null then
    insert into ops.vans (
      registration, name, active, make_model, mot_due, tax_due, insurance_due, service_due, notes
    ) values (
      v_reg, v_name, coalesce(p_active, true), v_model, p_mot_due, p_tax_due, p_insurance_due, p_service_due, v_notes
    )
    returning id into v_id;
    perform public.write_access_audit(
      'van.created', 'van', v_id, null,
      jsonb_build_object('registration', v_reg, 'makeModel', v_model, 'active', coalesce(p_active, true))
    );
    return v_id;
  end if;
  select jsonb_build_object('registration', registration, 'name', name, 'active', active, 'makeModel', make_model)
  into v_before
  from ops.vans where id = p_id;
  if v_before is null then
    raise exception 'app: That van was not found.';
  end if;
  update ops.vans
  set registration = v_reg,
      name = v_name,
      active = coalesce(p_active, active),
      make_model = v_model,
      mot_due = p_mot_due,
      tax_due = p_tax_due,
      insurance_due = p_insurance_due,
      service_due = p_service_due,
      notes = v_notes
  where id = p_id
  returning id into v_id;
  perform public.write_access_audit(
    'van.updated', 'van', v_id, v_before,
    jsonb_build_object('registration', v_reg, 'makeModel', v_model, 'active', coalesce(p_active, active))
  );
  return v_id;
end;
$$;

revoke all on function public.install_save_van(uuid, text, text, boolean, text, date, date, date, date, text) from public, anon;
grant execute on function public.install_save_van(uuid, text, text, boolean, text, date, date, date, date, text) to authenticated, service_role;
