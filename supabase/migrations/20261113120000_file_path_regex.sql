-- Postgres rejects a regex quantifier above 255 (error 2201B) when the check runs.
-- The original orbit_register_file used {0,480}, so every upload failed.
-- TEST already has this body applied by hand. Replacing the function again is safe.

create or replace function public.orbit_register_file(
  p_bucket text,
  p_storage_path text,
  p_mime_type text,
  p_byte_size bigint,
  p_checksum text,
  p_uploaded_by uuid,
  p_entity_schema text,
  p_entity_table text,
  p_entity_id uuid,
  p_kind text
)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_id uuid;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: You cannot register a file.';
  end if;

  if p_bucket not in ('access-media', 'job-sheets', 'qc', 'insurance', 'terms') then
    raise exception 'app: That file bucket is not valid.';
  end if;

  if p_storage_path is null
     or char_length(p_storage_path) > 255
     or p_storage_path !~ '^[a-z0-9][a-z0-9_./-]{0,254}$'
     or p_storage_path like '%..%'
     or p_storage_path like '/%'
  then
    raise exception 'app: That file path is not allowed.';
  end if;

  if p_entity_schema not in ('ops', 'core') then
    raise exception 'app: That file cannot be linked to that record.';
  end if;

  insert into core.files (
    bucket, storage_path, mime_type, byte_size, checksum,
    uploaded_by, entity_schema, entity_table, entity_id, kind
  ) values (
    p_bucket,
    p_storage_path,
    nullif(trim(coalesce(p_mime_type, '')), ''),
    p_byte_size,
    nullif(trim(coalesce(p_checksum, '')), ''),
    p_uploaded_by,
    p_entity_schema,
    p_entity_table,
    p_entity_id,
    nullif(trim(coalesce(p_kind, '')), '')
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.orbit_register_file(text, text, text, bigint, text, uuid, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.orbit_register_file(text, text, text, bigint, text, uuid, text, text, uuid, text) to service_role;
