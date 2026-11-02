-- Filling blank version text is the one change allowed on an otherwise immutable
-- version. Used when a stored PDF or Word file had no extracted text.

create or replace function public.prevent_version_mutation()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'UPDATE'
     and coalesce(old.content, '') = ''
     and coalesce(new.content, '') <> ''
     and new.id = old.id
     and new.policy_id = old.policy_id
     and new.version_number = old.version_number
     and new.author_id is not distinct from old.author_id
     and new.change_summary is not distinct from old.change_summary
     and new.reason is not distinct from old.reason
     and new.legal_source is not distinct from old.legal_source
     and new.amendment_id is not distinct from old.amendment_id
     and new.source_file_path is not distinct from old.source_file_path
     and new.source_file_name is not distinct from old.source_file_name
     and new.created_at is not distinct from old.created_at
  then
    return new;
  end if;

  raise exception 'policy versions are immutable';
end;
$$;

create or replace function public.fill_empty_policy_text(
  p_policy_id uuid,
  p_content text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := coalesce(auth.role(), '');
  v_actor uuid;
  v_version public.policy_versions%rowtype;
  v_policy_content text;
begin
  if v_role = 'service_role' then
    v_actor := null;
  elsif public.is_active_user() then
    v_actor := auth.uid();
  else
    raise exception 'app: You need an active account to do that.';
  end if;

  if p_content is null or length(trim(p_content)) = 0 then
    raise exception 'app: No text could be read from that file.';
  end if;

  if length(p_content) > 500000 then
    raise exception 'app: That policy text is too long.';
  end if;

  if not exists (select 1 from public.policies where id = p_policy_id) then
    raise exception 'app: That policy could not be found.';
  end if;

  select * into v_version
  from public.policy_versions
  where policy_id = p_policy_id
    and coalesce(content, '') = ''
  order by version_number desc
  limit 1;

  if not found then
    raise exception 'app: Every version of this policy already has text. Upload the file again to add a new version.';
  end if;

  update public.policy_versions
  set content = p_content
  where id = v_version.id;

  select current_content into v_policy_content
  from public.policies
  where id = p_policy_id;

  if coalesce(v_policy_content, '') = '' then
    update public.policies
    set current_content = p_content
    where id = p_policy_id;
  end if;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, policy_id, details)
  values (
    v_actor,
    'policy.text_extracted',
    'policy',
    p_policy_id,
    p_policy_id,
    jsonb_build_object(
      'version', v_version.version_number,
      'characters', length(p_content)
    )
  );

  return jsonb_build_object(
    'policy_id', p_policy_id,
    'version_number', v_version.version_number,
    'characters', length(p_content)
  );
end;
$$;

revoke all on function public.fill_empty_policy_text(uuid, text) from public;
grant execute on function public.fill_empty_policy_text(uuid, text) to authenticated, service_role;
