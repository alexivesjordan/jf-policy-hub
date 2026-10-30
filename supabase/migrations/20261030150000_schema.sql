-- Policy Hub schema.
-- Mutations that must stay consistent (versions, reviews, notifications) go
-- through security definer functions. Email delivery is not done here; the
-- app calls src/features/notifications/email.ts with the returned rows.

create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to postgres, service_role;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'staff' check (role in ('admin', 'approver', 'staff')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(trim(name)) between 1 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  auto_apply_allowed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.policies (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 200),
  category_id uuid not null references public.categories (id) on delete restrict,
  owner_id uuid references public.profiles (id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  review_date date,
  current_content text not null default '',
  source_file_path text,
  source_file_name text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.policy_versions (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies (id) on delete cascade,
  version_number integer not null check (version_number > 0),
  content text not null,
  author_id uuid references public.profiles (id) on delete set null,
  change_summary text not null check (char_length(trim(change_summary)) between 1 and 2000),
  reason text,
  legal_source text,
  amendment_id uuid,
  source_file_path text,
  source_file_name text,
  created_at timestamptz not null default now(),
  unique (policy_id, version_number)
);

create table public.amendments (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies (id) on delete cascade,
  proposed_content text not null,
  summary text not null check (char_length(trim(summary)) between 1 and 2000),
  legal_change_description text,
  source_urls text[] not null default '{}',
  jurisdiction text,
  effective_date date,
  severity text not null check (severity in ('low', 'medium', 'high')),
  created_by text not null check (created_by in ('research agent', 'user')),
  created_by_user_id uuid references public.profiles (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'auto-applied')),
  reviewer_id uuid references public.profiles (id) on delete set null,
  review_comment text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.policy_versions
  add constraint policy_versions_amendment_id_fkey
  foreign key (amendment_id) references public.amendments (id) on delete set null;

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  policy_id uuid references public.policies (id) on delete cascade,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text not null,
  kind text not null check (kind in ('proposal', 'auto_applied', 'decision')),
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index policies_category_id_idx on public.policies (category_id);
create index policies_status_idx on public.policies (status);
create index policies_review_date_idx on public.policies (review_date);
create index policies_title_idx on public.policies (title);
create index policy_versions_policy_id_idx on public.policy_versions (policy_id, version_number desc);
create index amendments_policy_id_idx on public.amendments (policy_id);
create index amendments_status_idx on public.amendments (status);
create index audit_log_policy_id_idx on public.audit_log (policy_id, created_at desc);
create index notifications_user_id_idx on public.notifications (user_id, created_at desc);

comment on table public.notifications is
  'In-app notifications for approvers. Email is a separate hook in src/features/notifications/email.ts.';

comment on table public.policy_versions is
  'Immutable snapshots. Updates and deletes are rejected by trigger.';

comment on column public.categories.auto_apply_allowed is
  'When true, low-severity suggestions are applied without a manual review. Default false.';

-- ---------------------------------------------------------------------------
-- Shared triggers
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

create trigger categories_touch_updated_at
before update on public.categories
for each row execute function public.touch_updated_at();

create trigger policies_touch_updated_at
before update on public.policies
for each row execute function public.touch_updated_at();

create or replace function public.prevent_version_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'policy versions are immutable';
end;
$$;

create trigger policy_versions_immutable
before update or delete on public.policy_versions
for each row execute function public.prevent_version_mutation();

create or replace function public.protect_notification_update()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is distinct from old.user_id
     or new.title is distinct from old.title
     or new.body is distinct from old.body
     or new.kind is distinct from old.kind
     or new.link is distinct from old.link
     or new.created_at is distinct from old.created_at
  then
    raise exception 'only read_at can be updated on a notification';
  end if;
  return new;
end;
$$;

create trigger notifications_protect_update
before update on public.notifications
for each row execute function public.protect_notification_update();

-- ---------------------------------------------------------------------------
-- Auth helpers (also used by row level security)
-- ---------------------------------------------------------------------------

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
  );
$$;

create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles
  where id = auth.uid() and is_active;
$$;

create or replace function public.current_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select email from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() = 'admin';
$$;

create or replace function public.is_reviewer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() in ('admin', 'approver');
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assigned_role text := 'staff';
  cleaned_email text := lower(trim(coalesce(new.email, '')));
begin
  if cleaned_email = 'alex.ives@jordanfitness.com' then
    assigned_role := 'admin';
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    cleaned_email,
    nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), ''),
    assigned_role
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles
    set email = lower(trim(coalesce(new.email, email)))
    where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_updated
after update of email on auth.users
for each row execute function public.handle_user_email_change();

create or replace function public.audit_profile_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role is distinct from new.role then
    -- The invite flow sets the real role immediately after the staff default.
    if not (old.role = 'staff' and old.created_at > now() - interval '2 minutes') then
      insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
      values (
        auth.uid(),
        'user.role_changed',
        'profile',
        new.id,
        jsonb_build_object('from_role', old.role, 'to_role', new.role, 'email', new.email)
      );
    end if;
  end if;

  if old.is_active is distinct from new.is_active then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
    values (
      auth.uid(),
      case when new.is_active then 'user.reactivated' else 'user.deactivated' end,
      'profile',
      new.id,
      jsonb_build_object('email', new.email, 'role', new.role)
    );
  end if;

  return new;
end;
$$;

create trigger profiles_audit_changes
after update on public.profiles
for each row execute function public.audit_profile_changes();

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

create or replace function private.approver_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(id), array[]::uuid[])
  from public.profiles
  where role in ('admin', 'approver') and is_active;
$$;

create or replace function private.notify_users(
  p_user_ids uuid[],
  p_title text,
  p_body text,
  p_kind text,
  p_link text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  with distinct_ids as (
    select distinct uid
    from unnest(coalesce(p_user_ids, array[]::uuid[])) as uid
    where uid is not null
  ),
  inserted as (
    insert into public.notifications (user_id, title, body, kind, link)
    select p.id, p_title, p_body, p_kind, p_link
    from distinct_ids d
    join public.profiles p on p.id = d.uid
    where p.is_active
    returning user_id, title, body, link
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', i.user_id,
        'email', p.email,
        'title', i.title,
        'body', i.body,
        'link', i.link
      )
    ),
    '[]'::jsonb
  )
  into v_result
  from inserted i
  join public.profiles p on p.id = i.user_id;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

create or replace function private.apply_amendment(
  p_amendment_id uuid,
  p_status text,
  p_reviewer uuid,
  p_comment text,
  p_content text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_am public.amendments%rowtype;
  v_policy public.policies%rowtype;
  v_version integer;
  v_content text;
  v_legal text;
  v_notes jsonb;
begin
  if p_status not in ('approved', 'auto-applied') then
    raise exception 'app: That decision is not valid.';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_amendment_id::text)::bigint);

  select * into v_am
  from public.amendments
  where id = p_amendment_id
  for update;

  if not found then
    raise exception 'app: That suggestion could not be found.';
  end if;

  if v_am.status <> 'pending' then
    raise exception 'app: This suggestion has already been reviewed.';
  end if;

  if p_content is not null and length(trim(p_content)) = 0 then
    raise exception 'app: The policy text is empty.';
  end if;

  v_content := coalesce(p_content, v_am.proposed_content);

  perform pg_advisory_xact_lock(hashtext(v_am.policy_id::text)::bigint);

  select * into v_policy
  from public.policies
  where id = v_am.policy_id
  for update;

  if not found then
    raise exception 'app: That policy could not be found.';
  end if;

  select coalesce(max(version_number), 0) + 1
  into v_version
  from public.policy_versions
  where policy_id = v_policy.id;

  v_legal := nullif(
    concat_ws(
      ' — ',
      nullif(trim(coalesce(v_am.jurisdiction, '')), ''),
      nullif(array_to_string(v_am.source_urls, ', '), '')
    ),
    ''
  );

  update public.policies
  set current_content = v_content
  where id = v_policy.id;

  insert into public.policy_versions (
    policy_id,
    version_number,
    content,
    author_id,
    change_summary,
    reason,
    legal_source,
    amendment_id,
    source_file_path,
    source_file_name
  )
  values (
    v_policy.id,
    v_version,
    v_content,
    p_reviewer,
    v_am.summary,
    nullif(trim(coalesce(v_am.legal_change_description, '')), ''),
    v_legal,
    v_am.id,
    v_policy.source_file_path,
    v_policy.source_file_name
  );

  update public.amendments
  set
    status = p_status,
    proposed_content = v_content,
    reviewer_id = p_reviewer,
    review_comment = nullif(trim(coalesce(p_comment, '')), ''),
    reviewed_at = now()
  where id = v_am.id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, policy_id, details)
  values (
    coalesce(p_reviewer, v_am.created_by_user_id),
    case when p_status = 'auto-applied' then 'amendment.auto_applied' else 'amendment.approved' end,
    'amendment',
    v_am.id,
    v_policy.id,
    jsonb_build_object(
      'summary', v_am.summary,
      'severity', v_am.severity,
      'version', v_version,
      'edited', p_content is not null and p_content is distinct from v_am.proposed_content,
      'created_by', v_am.created_by
    )
  );

  v_notes := private.notify_users(
    private.approver_ids() || array[v_am.created_by_user_id],
    case
      when p_status = 'auto-applied' then 'A suggestion was applied automatically'
      else 'A suggestion was approved'
    end,
    case
      when p_status = 'auto-applied' then
        v_policy.title || ': ' || v_am.summary
        || ' Low-severity updates are turned on for this category, so it was applied without a manual review.'
      else v_policy.title || ': ' || v_am.summary
    end,
    case when p_status = 'auto-applied' then 'auto_applied' else 'decision' end,
    '/policies/' || v_policy.id::text
  );

  return jsonb_build_object(
    'id', v_am.id,
    'status', p_status,
    'policy_id', v_policy.id,
    'notifications', v_notes
  );
end;
$$;

create or replace function private.insert_amendment(
  p_policy_id uuid,
  p_proposed_content text,
  p_summary text,
  p_legal_change_description text,
  p_source_urls text[],
  p_jurisdiction text,
  p_effective_date date,
  p_severity text,
  p_as_agent boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_title text;
  v_status text;
  v_auto boolean;
  v_urls text[];
  v_actor uuid;
  v_created_by text;
  v_notes jsonb;
  v_applied jsonb;
begin
  if p_as_agent then
    v_actor := null;
    v_created_by := 'research agent';
  else
    if not public.is_active_user() then
      raise exception 'app: You need an active account to do that.';
    end if;
    v_actor := auth.uid();
    v_created_by := 'user';
  end if;

  if p_severity not in ('low', 'medium', 'high') then
    raise exception 'app: Severity must be low, medium, or high.';
  end if;

  if p_summary is null or length(trim(p_summary)) = 0 then
    raise exception 'app: Please add a short summary of the suggestion.';
  end if;

  if p_proposed_content is null or length(trim(p_proposed_content)) = 0 then
    raise exception 'app: The suggested policy text is empty.';
  end if;

  if length(p_proposed_content) > 500000 then
    raise exception 'app: That policy text is too long.';
  end if;

  select coalesce(array_agg(trim(u)), array[]::text[])
  into v_urls
  from unnest(coalesce(p_source_urls, array[]::text[])) as u
  where length(trim(u)) > 0;

  if coalesce(array_length(v_urls, 1), 0) > 20 then
    raise exception 'app: Please include at most 20 source links.';
  end if;

  select p.title, c.auto_apply_allowed
  into v_title, v_auto
  from public.policies p
  join public.categories c on c.id = p.category_id
  where p.id = p_policy_id;

  if v_title is null then
    raise exception 'app: That policy could not be found.';
  end if;

  if exists (select 1 from public.policies where id = p_policy_id and status = 'archived') then
    raise exception 'app: This policy is archived. Restore it before suggesting changes.';
  end if;

  insert into public.amendments (
    policy_id,
    proposed_content,
    summary,
    legal_change_description,
    source_urls,
    jurisdiction,
    effective_date,
    severity,
    created_by,
    created_by_user_id,
    status
  )
  values (
    p_policy_id,
    p_proposed_content,
    trim(p_summary),
    nullif(trim(coalesce(p_legal_change_description, '')), ''),
    v_urls,
    nullif(trim(coalesce(p_jurisdiction, '')), ''),
    p_effective_date,
    p_severity,
    v_created_by,
    v_actor,
    'pending'
  )
  returning id into v_id;

  if coalesce(v_auto, false) and p_severity = 'low' then
    v_applied := private.apply_amendment(v_id, 'auto-applied', v_actor, null, null);
    return v_applied;
  end if;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, policy_id, details)
  values (
    v_actor,
    'amendment.submitted',
    'amendment',
    v_id,
    p_policy_id,
    jsonb_build_object(
      'summary', trim(p_summary),
      'severity', p_severity,
      'created_by', v_created_by
    )
  );

  v_notes := private.notify_users(
    private.approver_ids(),
    'New suggestion to review',
    v_title || ': ' || trim(p_summary),
    'proposal',
    '/amendments/' || v_id::text
  );

  v_status := 'pending';

  return jsonb_build_object(
    'id', v_id,
    'status', v_status,
    'policy_id', p_policy_id,
    'notifications', v_notes
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Public API (PostgREST)
-- ---------------------------------------------------------------------------

create or replace function public.save_policy(
  p_policy_id uuid,
  p_is_new boolean,
  p_title text,
  p_category_id uuid,
  p_status text,
  p_review_date date,
  p_owner_id uuid,
  p_content text,
  p_change_summary text,
  p_reason text,
  p_legal_source text,
  p_source_file_path text,
  p_source_file_name text,
  p_replace_source_file boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_version integer;
  v_actor uuid := auth.uid();
  v_path text;
  v_name text;
begin
  if not public.is_active_user() then
    raise exception 'app: You need an active account to do that.';
  end if;

  if p_title is null or length(trim(p_title)) = 0 or char_length(trim(p_title)) > 200 then
    raise exception 'app: Please give the policy a title of 200 characters or fewer.';
  end if;

  if p_status not in ('draft', 'active', 'archived') then
    raise exception 'app: Choose draft, active, or archived.';
  end if;

  if p_change_summary is null or length(trim(p_change_summary)) = 0 then
    raise exception 'app: Please add a short summary of what changed.';
  end if;

  if char_length(trim(p_change_summary)) > 2000 then
    raise exception 'app: The change summary is too long.';
  end if;

  if not exists (select 1 from public.categories where id = p_category_id) then
    raise exception 'app: Please choose a category.';
  end if;

  if p_owner_id is not null and not exists (select 1 from public.profiles where id = p_owner_id) then
    raise exception 'app: That owner could not be found.';
  end if;

  if coalesce(p_content, '') is null or length(coalesce(p_content, '')) > 500000 then
    raise exception 'app: That policy text is too long.';
  end if;

  if p_is_new then
    insert into public.policies (
      id,
      title,
      category_id,
      owner_id,
      status,
      review_date,
      current_content,
      source_file_path,
      source_file_name,
      created_by
    )
    values (
      coalesce(p_policy_id, gen_random_uuid()),
      trim(p_title),
      p_category_id,
      p_owner_id,
      p_status,
      p_review_date,
      coalesce(p_content, ''),
      nullif(p_source_file_path, ''),
      nullif(p_source_file_name, ''),
      v_actor
    )
    returning id into v_id;

    v_version := 1;

    insert into public.audit_log (actor_id, action, entity_type, entity_id, policy_id, details)
    values (
      v_actor,
      'policy.created',
      'policy',
      v_id,
      v_id,
      jsonb_build_object('title', trim(p_title), 'summary', trim(p_change_summary))
    );
  else
    if p_policy_id is null then
      raise exception 'app: That policy could not be found.';
    end if;

    perform pg_advisory_xact_lock(hashtext(p_policy_id::text)::bigint);

    if not exists (select 1 from public.policies where id = p_policy_id) then
      raise exception 'app: That policy could not be found.';
    end if;

    update public.policies
    set
      title = trim(p_title),
      category_id = p_category_id,
      owner_id = p_owner_id,
      status = p_status,
      review_date = p_review_date,
      current_content = coalesce(p_content, ''),
      source_file_path = case
        when p_replace_source_file then nullif(p_source_file_path, '')
        else source_file_path
      end,
      source_file_name = case
        when p_replace_source_file then nullif(p_source_file_name, '')
        else source_file_name
      end
    where id = p_policy_id
    returning id into v_id;

    select coalesce(max(version_number), 0) + 1
    into v_version
    from public.policy_versions
    where policy_id = v_id;

    insert into public.audit_log (actor_id, action, entity_type, entity_id, policy_id, details)
    values (
      v_actor,
      'policy.updated',
      'policy',
      v_id,
      v_id,
      jsonb_build_object('summary', trim(p_change_summary), 'status', p_status)
    );
  end if;

  select source_file_path, source_file_name
  into v_path, v_name
  from public.policies
  where id = v_id;

  insert into public.policy_versions (
    policy_id,
    version_number,
    content,
    author_id,
    change_summary,
    reason,
    legal_source,
    source_file_path,
    source_file_name
  )
  values (
    v_id,
    v_version,
    coalesce(p_content, ''),
    v_actor,
    trim(p_change_summary),
    nullif(trim(coalesce(p_reason, '')), ''),
    nullif(trim(coalesce(p_legal_source, '')), ''),
    v_path,
    v_name
  );

  return v_id;
exception
  when unique_violation then
    raise exception 'app: That save conflicted with another change. Refresh the page and try again.';
end;
$$;

create or replace function public.submit_amendment(
  p_policy_id uuid,
  p_proposed_content text,
  p_summary text,
  p_legal_change_description text,
  p_source_urls text[],
  p_jurisdiction text,
  p_effective_date date,
  p_severity text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return private.insert_amendment(
    p_policy_id,
    p_proposed_content,
    p_summary,
    p_legal_change_description,
    p_source_urls,
    p_jurisdiction,
    p_effective_date,
    p_severity,
    false
  );
end;
$$;

create or replace function public.submit_agent_amendment(
  p_policy_id uuid,
  p_proposed_content text,
  p_summary text,
  p_legal_change_description text,
  p_source_urls text[],
  p_jurisdiction text,
  p_effective_date date,
  p_severity text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return private.insert_amendment(
    p_policy_id,
    p_proposed_content,
    p_summary,
    p_legal_change_description,
    p_source_urls,
    p_jurisdiction,
    p_effective_date,
    p_severity,
    true
  );
end;
$$;

create or replace function public.review_amendment(
  p_amendment_id uuid,
  p_decision text,
  p_comment text,
  p_edited_content text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_am public.amendments%rowtype;
  v_policy_title text;
  v_notes jsonb;
begin
  if not public.is_reviewer() then
    raise exception 'app: Only approvers can review suggestions.';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'app: Choose approve or reject.';
  end if;

  if p_decision = 'rejected' and length(trim(coalesce(p_comment, ''))) = 0 then
    raise exception 'app: Please add a comment explaining the rejection.';
  end if;

  if p_decision = 'approved' then
    return private.apply_amendment(
      p_amendment_id,
      'approved',
      auth.uid(),
      p_comment,
      p_edited_content
    );
  end if;

  perform pg_advisory_xact_lock(hashtext(p_amendment_id::text)::bigint);

  select * into v_am
  from public.amendments
  where id = p_amendment_id
  for update;

  if not found then
    raise exception 'app: That suggestion could not be found.';
  end if;

  if v_am.status <> 'pending' then
    raise exception 'app: This suggestion has already been reviewed.';
  end if;

  update public.amendments
  set
    status = 'rejected',
    reviewer_id = auth.uid(),
    review_comment = trim(p_comment),
    reviewed_at = now()
  where id = v_am.id;

  select title into v_policy_title from public.policies where id = v_am.policy_id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, policy_id, details)
  values (
    auth.uid(),
    'amendment.rejected',
    'amendment',
    v_am.id,
    v_am.policy_id,
    jsonb_build_object(
      'summary', v_am.summary,
      'comment', trim(p_comment)
    )
  );

  v_notes := private.notify_users(
    array[v_am.created_by_user_id],
    'A suggestion was rejected',
    coalesce(v_policy_title, 'Policy') || ': ' || v_am.summary || ' Comment: ' || trim(p_comment),
    'decision',
    '/amendments/' || v_am.id::text
  );

  return jsonb_build_object(
    'id', v_am.id,
    'status', 'rejected',
    'policy_id', v_am.policy_id,
    'notifications', v_notes
  );
end;
$$;

create or replace function public.log_event(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_policy_id uuid,
  p_details jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_user() then
    raise exception 'app: You need an active account to do that.';
  end if;

  if p_action not in ('user.invited', 'category.created', 'category.updated') then
    raise exception 'app: That action cannot be recorded.';
  end if;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, policy_id, details)
  values (
    auth.uid(),
    p_action,
    p_entity_type,
    p_entity_id,
    p_policy_id,
    coalesce(p_details, '{}'::jsonb)
  );
end;
$$;

revoke all on all functions in schema private from public;
revoke all on function public.save_policy(uuid, boolean, text, uuid, text, date, uuid, text, text, text, text, text, text, boolean) from public;
revoke all on function public.submit_amendment(uuid, text, text, text, text[], text, date, text) from public;
revoke all on function public.submit_agent_amendment(uuid, text, text, text, text[], text, date, text) from public;
revoke all on function public.review_amendment(uuid, text, text, text) from public;
revoke all on function public.log_event(text, text, uuid, uuid, jsonb) from public;
revoke all on function public.is_active_user() from public;
revoke all on function public.current_role() from public;
revoke all on function public.current_email() from public;
revoke all on function public.is_admin() from public;
revoke all on function public.is_reviewer() from public;

grant execute on function public.save_policy(uuid, boolean, text, uuid, text, date, uuid, text, text, text, text, text, text, boolean) to authenticated;
grant execute on function public.submit_amendment(uuid, text, text, text, text[], text, date, text) to authenticated;
grant execute on function public.submit_agent_amendment(uuid, text, text, text, text[], text, date, text) to service_role;
grant execute on function public.review_amendment(uuid, text, text, text) to authenticated;
grant execute on function public.log_event(text, text, uuid, uuid, jsonb) to authenticated;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.current_role() to authenticated;
grant execute on function public.current_email() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_reviewer() to authenticated;
