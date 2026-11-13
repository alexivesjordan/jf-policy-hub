-- A later visit must not count a file that is already on this install.

create or replace function public.install_save_access(
  p_token_hash text,
  p_answers jsonb,
  p_media_ids uuid[],
  p_accepted_name text,
  p_user_agent text
)
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_token jsonb;
  v_install uuid;
  v_existing ops.access_submissions%rowtype;
  v_media uuid[];
  v_name text := nullif(btrim(coalesce(p_accepted_name, '')), '');
  v_first boolean := false;
  v_added integer;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: You cannot submit that form.';
  end if;
  v_token := public.orbit_resolve_token(p_token_hash);
  if v_token is null or v_token->>'purpose' is distinct from 'access_form' or v_token->>'entity_table' is distinct from 'installs' then
    raise exception 'app: That link is not valid.';
  end if;
  v_install := (v_token->>'entity_id')::uuid;

  select * into v_existing
  from ops.access_submissions
  where install_id = v_install
  order by created_at desc
  limit 1;

  select coalesce(array_agg(owned.id), '{}')
  into v_media
  from (
    select distinct f.id
    from unnest(coalesce(p_media_ids, '{}')) as requested(file_id)
    join core.files f on f.id = requested.file_id
    where f.bucket = 'access-media'
      and f.entity_schema = 'ops'
      and f.entity_table = 'installs'
      and f.entity_id = v_install
      and not exists (
        select 1
        from ops.access_submissions previous
        where previous.install_id = v_install
          and f.id = any (previous.media_file_ids)
      )
  ) owned;
  v_added := coalesce(array_length(v_media, 1), 0);

  if v_existing.id is null then
    if v_name is null then
      raise exception 'app: Add your name.';
    end if;
    insert into ops.access_submissions (
      install_id, answers, media_file_ids, accepted_at, accepted_by_name, accepted_user_agent, submitted_by
    ) values (
      v_install,
      coalesce(p_answers, '{}'::jsonb),
      v_media,
      now(),
      v_name,
      left(coalesce(p_user_agent, ''), 400),
      'customer'
    );
    v_first := true;
    update ops.installs
    set access_submitted_at = coalesce(access_submitted_at, now()),
        access_media_count = access_media_count + v_added
    where id = v_install;
  else
    update ops.access_submissions
    set answers = case when p_answers is null then answers else p_answers end,
        media_file_ids = media_file_ids || v_media,
        accepted_by_name = coalesce(v_name, accepted_by_name)
    where id = v_existing.id;
    update ops.installs
    set access_submitted_at = coalesce(access_submitted_at, case when v_name is not null then now() else null end),
        access_media_count = access_media_count + v_added
    where id = v_install;
  end if;

  if v_first then
    perform ops.notify_install(v_install, 'Access form received', 'The customer sent the site access form.');
  elsif v_added > 0 then
    perform ops.notify_install(v_install, 'Access photos added', 'The customer added photos or videos to the access form.');
  end if;

  return jsonb_build_object('installId', v_install, 'firstSubmit', v_first, 'mediaAdded', v_added);
end;
$$;
