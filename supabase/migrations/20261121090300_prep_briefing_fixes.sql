-- Hide vehicle damage photos from sales, and do not treat a token-path
-- risk assessment or job sheet as the job already started.
-- New file only.
--
-- Damage photos stay with admin and operations. install_visit_photos is the
-- read the sales install page uses. The engineer job page does not render
-- stored damage photos, so field engineers are not given a separate read.
-- install_list_vehicle_flags already returns those files only to admin and
-- operations. ops.visit_payload carries the damage note, not the files.
--
-- started_at values already written for in-progress, completed, and earlier
-- risk or job-sheet rows are left as they are.

create or replace function public.install_visit_photos(p_install uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, core, public
as $$
begin
  if ops.is_field_engineer() then
    raise exception 'app: Field engineers cannot do that.';
  end if;
  if not (
    public.workspace_can('sales', 'view')
    or public.workspace_can('operations', 'view')
    or public.workspace_is_admin()
  ) then
    raise exception 'app: You cannot see that install.';
  end if;
  if not exists (select 1 from ops.installs where id = p_install) then
    raise exception 'app: That install was not found.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', listed.id,
      'kind', listed.kind,
      'bucket', listed.bucket,
      'path', listed.storage_path,
      'createdAt', listed.created_at
    ) order by listed.created_at, listed.id)
    from (
      select f.id, f.kind, f.bucket, f.storage_path, f.created_at
      from core.files f
      where f.bucket = 'job-sheets'
        and f.kind in ('concern', 'equipment', 'hq_photo', 'vehicle_damage')
        and (
          f.kind is distinct from 'vehicle_damage'
          or public.workspace_is_admin()
          or public.workspace_can('operations', 'view')
        )
        and (
          f.entity_id = p_install
          or f.id in (select photo.file_id from ops.install_equipment_photos photo where photo.install_id = p_install)
          or f.id in (
            select unnest(risk.concern_file_ids)
            from ops.risk_assessments risk
            where risk.install_id = p_install
          )
          or f.id in (select photo.file_id from ops.install_hq_photos photo where photo.install_id = p_install)
          or f.id in (
            select link.file_id
            from ops.vehicle_check_files link
            join ops.vehicle_checks check_row on check_row.id = link.check_id
            where check_row.install_id = p_install
          )
        )
    ) listed
  ), '[]'::jsonb);
end;
$$;

create or replace function ops.assert_visit_started(p_install uuid, p_token_hash text)
returns void
language plpgsql
security definer
set search_path = ops, public
as $$
begin
  if p_token_hash is not null then
    return;
  end if;
  if exists (select 1 from ops.installs where id = p_install and started_at is not null) then
    return;
  end if;
  if exists (
       select 1 from ops.risk_assessments
       where install_id = p_install and completed_by is not null
     )
     or exists (
       select 1 from ops.visit_sheets
       where install_id = p_install and token_link_id is null
     ) then
    update ops.installs
    set started_at = coalesce(started_at, now())
    where id = p_install and started_at is null;
    return;
  end if;
  raise exception 'app: Start this job before saving.';
end;
$$;

create or replace function ops.visit_payload(p_row ops.installs)
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, public
as $$
declare
  v_today date := (timezone('Europe/London', now()))::date;
  v_started boolean;
begin
  v_started := p_row.started_at is not null
    or exists (
      select 1 from ops.risk_assessments r
      where r.install_id = p_row.id and r.completed_by is not null
    )
    or exists (
      select 1 from ops.visit_sheets s
      where s.install_id = p_row.id and s.token_link_id is null
    );
  return jsonb_build_object(
    'job', jsonb_build_object(
      'id', p_row.id,
      'orderNumber', p_row.order_number,
      'customerName', p_row.customer_name,
      'siteAddress', p_row.site_address,
      'contactName', p_row.contact_name,
      'contactPhone', p_row.contact_phone,
      'contactEmail', p_row.contact_email,
      'startOn', p_row.start_on,
      'endOn', p_row.end_on,
      'status', p_row.status,
      'startedAt', p_row.started_at
    ),
    'lines', ops.order_lines(p_row.lines),
    'risk', (
      select jsonb_build_object('answers', ra.answers, 'concernCount', coalesce(cardinality(ra.concern_file_ids), 0), 'completedAt', ra.completed_at)
      from ops.risk_assessments ra
      where ra.install_id = p_row.id
      order by ra.completed_at desc
      limit 1
    ),
    'submitted', exists (select 1 from ops.visit_sheets vs where vs.install_id = p_row.id and vs.submitted_at is not null),
    'started', v_started,
    'canStart', (not v_started)
      and p_row.status not in ('cancelled', 'completed')
      and ops.install_day_open(p_row.start_on, p_row.end_on, v_today),
    'access', ops.install_access_json(p_row.id),
    'hqBuild', coalesce(p_row.hq_build, '{}'::jsonb),
    'siteInstall', coalesce(p_row.site_install, '{}'::jsonb),
    'crew', p_row.crew,
    'prep', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'kind', t.kind,
        'title', t.title,
        'body', t.body,
        'status', t.status,
        'dueOn', t.due_on,
        'items', t.items,
        'photos', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', f.id, 'itemKey', ph.item_key, 'bucket', f.bucket, 'path', f.storage_path
          ) order by ph.created_at)
          from ops.install_hq_photos ph
          join core.files f on f.id = ph.file_id
          where ph.task_id = t.id
        ), '[]'::jsonb)
      ) order by t.kind)
      from ops.install_prep_tasks t
      where t.install_id = p_row.id and t.status <> 'cancelled'
    ), '[]'::jsonb),
    'assignees', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', coalesce(nullif(btrim(p.full_name), ''), p.email)
      ) order by coalesce(nullif(btrim(p.full_name), ''), p.email))
      from (
        select distinct r.profile_id
        from ops.install_reservations ir
        join ops.resources r on r.id = ir.resource_id
        where ir.install_id = p_row.id
          and r.resource_type in ('installer', 'helper')
          and r.profile_id is not null
      ) people
      join public.profiles p on p.id = people.profile_id
    ), '[]'::jsonb),
    'vans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'registration', v.registration, 'name', v.name
      ) order by v.registration)
      from ops.vans v
      where v.active
    ), '[]'::jsonb),
    'defaultVanId', ops.install_default_van(p_row.id),
    'vehicleCheck', (
      select jsonb_build_object(
        'submitted', true,
        'fitToDrive', c.fit_to_drive,
        'newDamage', c.new_damage,
        'damageNote', c.damage_note,
        'driverId', c.driver_id,
        'vanId', c.van_id
      )
      from ops.vehicle_checks c
      where c.install_id = p_row.id
    )
  );
end;
$$;

revoke all on function ops.assert_visit_started(uuid, text) from public, anon, authenticated;
revoke all on function ops.visit_payload(ops.installs) from public, anon, authenticated;
