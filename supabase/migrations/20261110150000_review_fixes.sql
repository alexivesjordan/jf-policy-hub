-- Review fixes. 20261110140000 is already applied; do not edit it.
-- 1. Null owner_rep_id must not satisfy a pencil or visibility predicate.
-- 2. workspace_level is self, a workspace admin, or the service role.
-- 3. Saving a user sets access_granted with the active flag, and audits it.
-- 4. Policy writes need People edit. Reviewing suggestions is a can_review flag, not a role.
--    Owners still review. Admins keep Workspace admin even on a custom grid.

-- ---------------------------------------------------------------------------
-- Null-safe identity. A null id compares as false, never unknown.
-- ---------------------------------------------------------------------------

create or replace function public.same_actor(p_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select p_id is not null
     and auth.uid() is not null
     and p_id = auth.uid();
$$;

comment on function public.same_actor(uuid) is
  'True only when both ids are present and equal. Null is false, so IF NOT does not skip.';

revoke all on function public.same_actor(uuid) from public, anon;
grant execute on function public.same_actor(uuid) to authenticated, service_role;

create or replace function public.can_pencil_job(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.workspace_can('operations', 'edit')
    or (
      public.workspace_can('sales', 'edit')
      and public.same_actor(p_owner)
    ),
    false
  );
$$;

comment on function public.can_pencil_job(uuid) is
  'Operations edit, or sales edit on a job this person owns. A null owner is not a match.';

revoke all on function public.can_pencil_job(uuid) from public, anon, authenticated;

-- Visibility predicates used by RLS. Null owner_rep_id does not match the caller.
create or replace function ops.job_visible(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ops, public
as $$
  select exists (
    select 1
    from ops.install_jobs j
    where j.id = p_job_id
      and (
        public.workspace_can('operations', 'view')
        or (
          public.workspace_can('sales', 'view')
          and public.same_actor(j.owner_rep_id)
        )
      )
  );
$$;

create or replace function ops.customer_visible(p_customer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ops, public
as $$
  select exists (
    select 1
    from ops.customers c
    where c.id = p_customer_id
      and (
        public.workspace_can('operations', 'view')
        or (
          public.workspace_can('sales', 'view')
          and (
            public.same_actor(c.owner_rep_id)
            or exists (
              select 1
              from ops.install_jobs j
              where j.customer_id = c.id
                and public.same_actor(j.owner_rep_id)
            )
          )
        )
      )
  );
$$;

create or replace function ops.sales_job_visible(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ops, public
as $$
  select exists (
    select 1
    from ops.install_jobs j
    where j.id = p_job_id
      and (
        public.workspace_can('operations', 'view')
        or (
          public.workspace_can('sales', 'view')
          and public.same_actor(j.owner_rep_id)
        )
      )
  );
$$;

create or replace view ops.quote_customer_prices
with (security_barrier = true, security_invoker = false) as
select
  q.id,
  q.job_id,
  q.mode,
  q.customer_price,
  q.finality,
  q.segment,
  q.provisional_items,
  q.created_at
from ops.quote_versions q
join ops.install_jobs j on j.id = q.job_id
where public.workspace_can('sales', 'view')
  and public.same_actor(j.owner_rep_id);

create or replace function public.orbit_pencil_range(
  p_job_id uuid,
  p_start date,
  p_allow_weekends boolean,
  p_resource_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_job ops.install_jobs%rowtype;
  v_need ops.job_requirements%rowtype;
  v_owner boolean;
  v_dates date[] := '{}';
  v_cursor date;
  v_guard integer := 0;
  v_day date;
  v_problem text;
begin
  if auth.uid() is null then
    raise exception 'app: You need to be signed in.';
  end if;
  select * into v_job from ops.install_jobs where id = p_job_id;
  if v_job.id is null then
    raise exception 'app: That job was not found.';
  end if;
  if not coalesce(public.can_pencil_job(v_job.owner_rep_id), false) then
    raise exception 'app: You cannot pencil that job.';
  end if;
  select * into v_need from ops.job_requirements where job_id = p_job_id;
  if v_need.job_id is null then
    raise exception 'app: This job has no required resources yet.';
  end if;

  v_owner := coalesce(public.workspace_is_owner(), false);
  if coalesce(p_allow_weekends, false) and not v_owner then
    raise exception 'app: Weekend installs can only be pencilled by the owner.';
  end if;
  if extract(dow from p_start) in (0, 6) and not (v_owner and coalesce(p_allow_weekends, false)) then
    raise exception 'app: Weekend installs can only be pencilled by the owner.';
  end if;

  v_cursor := p_start;
  while cardinality(v_dates) < v_need.install_days and v_guard < 400 loop
    v_guard := v_guard + 1;
    if coalesce(p_allow_weekends, false) or extract(dow from v_cursor) not in (0, 6) then
      v_dates := v_dates || v_cursor;
    end if;
    v_cursor := v_cursor + 1;
  end loop;

  if cardinality(v_dates) < v_need.install_days then
    raise exception 'app: That start day does not cover the install.';
  end if;

  foreach v_day in array v_dates loop
    if extract(dow from v_day) in (0, 6) and not v_owner then
      raise exception 'app: Weekend installs can only be pencilled by the owner.';
    end if;
    v_problem := ops.assignment_problem(
      v_need.installers,
      v_need.licensed_drivers,
      v_need.van_size,
      v_need.van_count,
      v_need.stair_climber,
      p_resource_ids,
      v_day,
      p_job_id
    );
    if v_problem is not null then
      raise exception 'app: %', v_problem;
    end if;
  end loop;

  delete from ops.reservations
  where job_id = p_job_id and kind = 'pencil';

  insert into ops.reservations (resource_id, job_id, day, kind)
  select picked.id, p_job_id, booked.day, 'pencil'
  from unnest(p_resource_ids) as picked(id)
  cross join unnest(v_dates) as booked(day);

  update ops.install_jobs
  set requested_date = v_dates[1],
      requested_end = v_dates[cardinality(v_dates)]
  where id = p_job_id;

  update ops.job_requirements
  set conflict = false, conflict_detail = null, updated_at = now()
  where job_id = p_job_id;

  return jsonb_build_object(
    'job_id', p_job_id,
    'start', v_dates[1],
    'end', v_dates[cardinality(v_dates)],
    'days', cardinality(v_dates),
    'kind', 'pencil'
  );
end;
$$;

-- No session: sales edit is false and a null owner is not this caller.
do $$
declare
  v_allowed boolean;
begin
  v_allowed := public.can_pencil_job(null);
  if v_allowed is null or v_allowed then
    raise exception 'can_pencil_job(null) must be false, got %', v_allowed;
  end if;
end
$$;

-- Task policies from 20261110140000. Nullable assignee and created_by use same_actor.
drop policy if exists "Read tasks you are involved in" on core.tasks;
create policy "Read tasks you are involved in"
on core.tasks
for select
to authenticated
using (
  public.same_actor(assignee_id)
  or public.same_actor(created_by)
  or public.workspace_can('operations', 'view')
);

drop policy if exists "Operations edit creates tasks" on core.tasks;
create policy "Operations edit creates tasks"
on core.tasks
for insert
to authenticated
with check (
  public.same_actor(created_by)
  and public.workspace_can('operations', 'edit')
);

drop policy if exists "Assignees and operations edit update tasks" on core.tasks;
create policy "Assignees and operations edit update tasks"
on core.tasks
for update
to authenticated
using (public.same_actor(assignee_id) or public.workspace_can('operations', 'edit'))
with check (public.same_actor(assignee_id) or public.workspace_can('operations', 'edit'));

-- ---------------------------------------------------------------------------
-- workspace_level must not leak another person's levels.
-- A workspace admin still reads the directory. A custom grid does not remove
-- that admin access: workspace_is_admin keys off the workspace role.
-- ---------------------------------------------------------------------------

create or replace function public.workspace_level(p_profile uuid, p_module text)
returns text
language plpgsql
stable
security definer
set search_path = public, core
as $$
declare
  v_mode text;
  v_role text;
  v_custom text;
  v_team text;
  v_named_owner boolean;
begin
  if p_profile is distinct from auth.uid()
     and not public.workspace_is_admin()
     and coalesce(auth.role(), '') is distinct from 'service_role'
  then
    raise exception 'app: You cannot read another person''s access.';
  end if;

  select access_mode, workspace_role into v_mode, v_role
  from public.profiles
  where id = p_profile;

  select exists (
    select 1 from core.ops_roles r
    where r.profile_id = p_profile and r.is_owner
  ) into v_named_owner;

  if v_role is null and not coalesce(v_named_owner, false) then
    return 'none';
  end if;

  if v_role = 'owner' or coalesce(v_named_owner, false) then
    return 'edit';
  end if;

  if v_mode = 'custom' then
    select access_level into v_custom
    from public.module_access
    where profile_id = p_profile and module_id = p_module;
    return coalesce(v_custom, 'none');
  end if;

  select case max(case a.access_level when 'edit' then 2 when 'view' then 1 else 0 end)
    when 2 then 'edit'
    when 1 then 'view'
    else 'none'
  end
  into v_team
  from public.workspace_team_access a
  join public.workspace_team_members m on m.team_id = a.team_id
  where m.profile_id = p_profile
    and a.module_id = p_module;
  v_team := coalesce(v_team, 'none');

  if v_role = 'admin' then
    return 'edit';
  elsif v_role = 'viewer' then
    return case when v_team = 'none' then 'none' else 'view' end;
  elsif v_role = 'manager' then
    return case when v_team = 'none' then 'view' else v_team end;
  else
    return v_team;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Activating a user grants access. Deactivating removes it. Both are audited.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists can_review boolean not null default false;

comment on column public.profiles.can_review is
  'Capability: this person can approve or reject policy suggestions. Independent of workspace role. Owners can review without the flag.';

create or replace function public.workspace_save_user(
  p_profile uuid,
  p_workspace_role text,
  p_access_mode text,
  p_team_ids uuid[],
  p_custom jsonb,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_module text;
  v_level text;
  v_before jsonb;
  v_after jsonb;
begin
  if not public.workspace_is_admin() then
    raise exception 'app: Only a workspace owner or admin can edit users.';
  end if;
  if p_workspace_role not in ('owner', 'admin', 'manager', 'member', 'viewer') then
    raise exception 'app: Choose a workspace role.';
  end if;
  if p_access_mode not in ('follow', 'custom') then
    raise exception 'app: Choose how access is resolved.';
  end if;
  if exists (
    select 1 from public.profiles
    where id = p_profile and lower(email) = 'alex.ives@jordanfitness.com'
  ) and (p_workspace_role <> 'owner' or p_active is false) then
    raise exception 'app: Alex stays an owner.';
  end if;

  select jsonb_build_object(
    'workspace_role', p.workspace_role,
    'access_mode', p.access_mode,
    'is_active', p.is_active,
    'access_granted', p.access_granted,
    'can_review', p.can_review,
    'role', p.role,
    'teams', coalesce((
      select jsonb_agg(m.team_id order by m.team_id)
      from public.workspace_team_members m
      where m.profile_id = p.id
    ), '[]'::jsonb),
    'levels', coalesce((
      select jsonb_object_agg(a.module_id, a.access_level)
      from public.module_access a
      where a.profile_id = p.id
    ), '{}'::jsonb)
  )
  into v_before
  from public.profiles p
  where p.id = p_profile;

  if v_before is null then
    raise exception 'app: That person could not be found.';
  end if;

  update public.profiles
  set workspace_role = p_workspace_role,
      access_mode = p_access_mode,
      is_active = p_active,
      access_granted = p_active,
      role = case
        when p_workspace_role in ('owner', 'admin') then 'admin'
        when p_workspace_role = 'manager' then 'approver'
        else 'staff'
      end
  where id = p_profile;

  delete from public.workspace_team_members where profile_id = p_profile;
  insert into public.workspace_team_members (team_id, profile_id)
  select team_id, p_profile
  from unnest(coalesce(p_team_ids, '{}'::uuid[])) as team_id;

  if p_access_mode = 'custom' and p_custom is not null then
    for v_module, v_level in
      select key, value
      from jsonb_each_text(p_custom)
    loop
      if v_module in ('people', 'service', 'supply', 'operations', 'sales', 'finance')
         and v_level in ('none', 'view', 'edit') then
        insert into public.module_access (profile_id, module_id, enabled, access_level)
        values (p_profile, v_module, v_level <> 'none', v_level)
        on conflict (profile_id, module_id) do update
          set enabled = excluded.enabled,
              access_level = excluded.access_level;
      end if;
    end loop;
  end if;

  select jsonb_build_object(
    'workspace_role', p.workspace_role,
    'access_mode', p.access_mode,
    'is_active', p.is_active,
    'access_granted', p.access_granted,
    'can_review', p.can_review,
    'role', p.role,
    'teams', coalesce((
      select jsonb_agg(m.team_id order by m.team_id)
      from public.workspace_team_members m
      where m.profile_id = p.id
    ), '[]'::jsonb),
    'levels', coalesce((
      select jsonb_object_agg(a.module_id, a.access_level)
      from public.module_access a
      where a.profile_id = p.id
    ), '{}'::jsonb)
  )
  into v_after
  from public.profiles p
  where p.id = p_profile;

  perform public.write_access_audit('user.access_changed', 'profile', p_profile, v_before, v_after);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reviewer is a capability, not the approver role. Owners can still review.
-- ---------------------------------------------------------------------------

update public.profiles as p
set can_review = true
where p.can_review is not true
  and (
    p.role in ('admin', 'approver')
    or p.workspace_role = 'owner'
    or exists (
      select 1 from core.ops_roles r
      where r.profile_id = p.id and r.is_owner
    )
  );

create or replace function public.is_reviewer()
returns boolean
language sql
stable
security definer
set search_path = public, core
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active
      and p.access_granted
      and (
        p.can_review
        or p.workspace_role = 'owner'
        or exists (
          select 1 from core.ops_roles r
          where r.profile_id = p.id and r.is_owner
        )
      )
  );
$$;

comment on function public.is_reviewer() is
  'True when the person has the reviewer capability, or is a workspace owner.';

create or replace function private.approver_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public, core
as $$
  select coalesce(array_agg(id), array[]::uuid[])
  from public.profiles p
  where p.is_active
    and p.access_granted
    and (
      p.can_review
      or p.workspace_role = 'owner'
      or exists (
        select 1 from core.ops_roles r
        where r.profile_id = p.id and r.is_owner
      )
    );
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
  if not coalesce(public.is_reviewer(), false) then
    raise exception 'app: You need the reviewer capability to approve or reject a suggestion.';
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

-- Policy text changes need People edit. Reviewing a suggestion stays on the flag.
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
  if not coalesce(public.workspace_can('people', 'edit'), false) then
    raise exception 'app: You need edit access on People to change a policy.';
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
      id, title, category_id, owner_id, status, review_date, current_content,
      source_file_path, source_file_name, created_by
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
      v_actor, 'policy.created', 'policy', v_id, v_id,
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
      v_actor, 'policy.updated', 'policy', v_id, v_id,
      jsonb_build_object('summary', trim(p_change_summary), 'status', p_status)
    );
  end if;

  select source_file_path, source_file_name
  into v_path, v_name
  from public.policies
  where id = v_id;

  insert into public.policy_versions (
    policy_id, version_number, content, author_id, change_summary, reason,
    legal_source, source_file_path, source_file_name
  )
  values (
    v_id, v_version, coalesce(p_content, ''), v_actor, trim(p_change_summary),
    nullif(trim(coalesce(p_reason, '')), ''),
    nullif(trim(coalesce(p_legal_source, '')), ''),
    v_path, v_name
  );

  return v_id;
exception
  when unique_violation then
    raise exception 'app: That save conflicted with another change. Refresh the page and try again.';
end;
$$;

drop policy if exists "Admins add categories" on public.categories;
create policy "People edit adds categories"
on public.categories
for insert
to authenticated
with check (public.workspace_can('people', 'edit'));

drop policy if exists "Admins update categories" on public.categories;
create policy "People edit updates categories"
on public.categories
for update
to authenticated
using (public.workspace_can('people', 'edit'))
with check (public.workspace_can('people', 'edit'));

drop policy if exists "Active users upload policy documents" on storage.objects;
create policy "People edit uploads policy documents"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'policy-documents'
  and public.workspace_can('people', 'edit')
);

drop policy if exists "Active users replace policy documents" on storage.objects;
create policy "People edit replaces policy documents"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'policy-documents'
  and public.workspace_can('people', 'edit')
)
with check (
  bucket_id = 'policy-documents'
  and public.workspace_can('people', 'edit')
);
