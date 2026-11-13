-- Look up files already stored on an install. Photos arrive by signed upload URL,
-- so the job sheet only receives their ids.

create or replace function public.install_owned_files(p_install uuid, p_ids uuid[], p_token_hash text default null)
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
as $$
begin
  if p_token_hash is not null then
    perform ops.assert_job_token(p_install, p_token_hash);
  else
    perform public.install_claim_engineer();
    if not ops.visit_can(p_install) then
      raise exception 'app: You cannot open that job.';
    end if;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', f.id, 'bucket', f.bucket, 'path', f.storage_path) order by array_position(p_ids, f.id))
    from core.files f
    where f.id = any(coalesce(p_ids, '{}'))
      and f.entity_id = p_install
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.install_owned_files(uuid, uuid[], text) from public, anon;
grant execute on function public.install_owned_files(uuid, uuid[], text) to authenticated, service_role;
