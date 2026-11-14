-- Visit photos already sit on the install: concern files from the risk
-- assessment, and equipment files from the job sheet. This read is for the
-- rep and the office. The job sheet PDF does not include them.

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
        and f.kind in ('concern', 'equipment')
        and (
          f.entity_id = p_install
          or f.id in (select photo.file_id from ops.install_equipment_photos photo where photo.install_id = p_install)
          or f.id in (
            select unnest(risk.concern_file_ids)
            from ops.risk_assessments risk
            where risk.install_id = p_install
          )
        )
    ) listed
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.install_visit_photos(uuid) from public, anon;
grant execute on function public.install_visit_photos(uuid) to authenticated, service_role;
