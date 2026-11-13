-- A customer token can read the current charges and what they already sent.
-- Only this install. The service role calls it; the ops schema stays closed.

create or replace function public.install_access_preview(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_token jsonb;
  v_install ops.installs%rowtype;
  v_terms ops.terms_versions%rowtype;
  v_submission ops.access_submissions%rowtype;
  v_answers jsonb := null;
  v_accepted text := null;
  v_has_terms boolean := false;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: You cannot open that form.';
  end if;
  v_token := public.orbit_resolve_token(p_token_hash);
  if v_token is null or v_token->>'purpose' is distinct from 'access_form' or v_token->>'entity_table' is distinct from 'installs' then
    return null;
  end if;
  select * into v_install from ops.installs where id = (v_token->>'entity_id')::uuid;
  if v_install.id is null then
    return null;
  end if;

  select * into v_terms from ops.terms_versions order by created_at desc limit 1;
  v_has_terms := found;
  select * into v_submission
  from ops.access_submissions
  where install_id = v_install.id
  order by created_at desc
  limit 1;
  if found then
    v_answers := v_submission.answers;
    v_accepted := v_submission.accepted_by_name;
  end if;

  return jsonb_build_object(
    'install_id', v_install.id,
    'customer_name', v_install.customer_name,
    'site_address', v_install.site_address,
    'submitted', v_install.access_submitted_at is not null,
    'media_count', v_install.access_media_count,
    'accepted_by_name', v_accepted,
    'answers', v_answers,
    'terms', case when not v_has_terms then null else jsonb_build_object(
      'id', v_terms.id,
      'version_label', v_terms.version_label,
      'lines', coalesce(v_terms.charges_grid->'lines', '[]'::jsonb)
    ) end,
    'media', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id,
        'kind', f.kind,
        'fileName', regexp_replace(f.storage_path, '^.*/', ''),
        'mime', f.mime_type,
        'bucket', f.bucket,
        'path', f.storage_path
      ) order by f.created_at)
      from (
        select distinct f.id, f.kind, f.mime_type, f.bucket, f.storage_path, f.created_at
        from ops.access_submissions a
        cross join lateral unnest(a.media_file_ids) as mid(file_id)
        join core.files f on f.id = mid.file_id
        where a.install_id = v_install.id
          and f.bucket = 'access-media'
          and f.entity_schema = 'ops'
          and f.entity_table = 'installs'
          and f.entity_id = v_install.id
      ) f
    ), '[]'::jsonb)
  );
end;
$$;
