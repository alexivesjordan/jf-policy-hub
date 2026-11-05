-- Orbit Core (M0).
-- Reviewed from the orbit-prep draft. People stays on public.profiles,
-- public.module_access, public.audit_log, and public.notifications.
-- core.* is the shared log, workflow, settings, files, and token store.
-- Do not apply to production until this migration has been reviewed.
-- Cin7 is not connected here. No credentials, webhooks, or field mappings.

create schema core;

revoke all on schema core from public;
grant usage on schema core to postgres, authenticated, service_role;

comment on schema core is
  'Shared Orbit foundation for People, Operations, and later modules. People audit and notifications stay in public.';

-- ---------------------------------------------------------------------------
-- Operations roles. One row per person. is_owner is the named owner (Alex),
-- not every administrator.
-- ---------------------------------------------------------------------------

create table core.ops_roles (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  ops_role text not null
    check (ops_role in ('sales', 'install_lead', 'installer', 'hq', 'admin_owner')),
  is_owner boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table core.ops_roles is
  'Per-user Operations role. Requires module_access.operations. Gate overrides need is_owner.';

comment on column core.ops_roles.is_owner is
  'Named owner (Alex). Pricing settings and gate overrides require this flag.';

create trigger ops_roles_touch_updated_at
before update on core.ops_roles
for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Workflow definitions. install_job is seeded below. Guards are names only
-- until later milestones; nothing in M0 executes guard_name.
-- ---------------------------------------------------------------------------

create table core.workflow_definitions (
  id uuid primary key default gen_random_uuid(),
  module_id text not null check (module_id in (
    'people', 'service', 'supply', 'operations', 'sales', 'finance'
  )),
  name text not null,
  entity_table text not null,
  created_at timestamptz not null default now(),
  unique (module_id, name)
);

create table core.workflow_states (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references core.workflow_definitions (id) on delete cascade,
  code text not null,
  label text not null,
  is_terminal boolean not null default false,
  sort_order integer not null default 0,
  unique (workflow_id, code)
);

create table core.workflow_transitions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references core.workflow_definitions (id) on delete cascade,
  from_state text not null,
  to_state text not null,
  event text not null,
  guard_name text,
  is_manual boolean not null default false,
  created_at timestamptz not null default now(),
  unique (workflow_id, from_state, to_state, event)
);

comment on table core.workflow_transitions is
  'Allowed moves. Clients do not write entity status. is_manual is only on_hold and lost_cancelled in M0.';

create index workflow_states_workflow_idx
  on core.workflow_states (workflow_id, sort_order);

create index workflow_transitions_workflow_idx
  on core.workflow_transitions (workflow_id, from_state);

-- ---------------------------------------------------------------------------
-- Immutable audit log. Inserts come from triggers. People keeps public.audit_log.
-- ---------------------------------------------------------------------------

create table core.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  actor_kind text not null default 'user'
    check (actor_kind in ('user', 'system', 'token', 'cron')),
  module_id text,
  entity_schema text not null,
  entity_table text not null,
  entity_id uuid,
  action text not null,
  field_name text,
  old_value jsonb,
  new_value jsonb,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_entity_idx
  on core.audit_log (entity_schema, entity_table, entity_id, created_at desc);

create index audit_log_actor_idx
  on core.audit_log (actor_id, created_at desc);

create index audit_log_created_idx
  on core.audit_log (created_at desc);

comment on table core.audit_log is
  'Immutable field and status audit for Core and Operations. Clients cannot insert or change rows.';

create or replace function core.prevent_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'core.audit_log is immutable';
end;
$$;

create trigger audit_log_immutable
before update or delete on core.audit_log
for each row execute function core.prevent_audit_mutation();

-- One audit row per changed column. updated_at is ignored.
create or replace function core.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_actor uuid := auth.uid();
  v_old jsonb;
  v_new jsonb;
  v_key text;
  v_entity uuid;
begin
  if tg_op = 'DELETE' then
    v_old := to_jsonb(old);
    v_entity := coalesce(
      nullif(v_old->>'id', '')::uuid,
      nullif(v_old->>'profile_id', '')::uuid
    );
    insert into core.audit_log (
      actor_id, entity_schema, entity_table, entity_id, action, old_value
    ) values (
      v_actor, tg_table_schema, tg_table_name, v_entity, 'delete', v_old
    );
    return old;
  end if;

  v_new := to_jsonb(new);
  v_entity := coalesce(
    nullif(v_new->>'id', '')::uuid,
    nullif(v_new->>'profile_id', '')::uuid
  );

  if tg_op = 'INSERT' then
    insert into core.audit_log (
      actor_id, entity_schema, entity_table, entity_id, action, new_value
    ) values (
      v_actor, tg_table_schema, tg_table_name, v_entity, 'insert', v_new
    );
    return new;
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    for v_key in select jsonb_object_keys(v_new)
    loop
      if v_key = 'updated_at' then
        continue;
      end if;
      if (v_old -> v_key) is distinct from (v_new -> v_key) then
        insert into core.audit_log (
          actor_id, entity_schema, entity_table, entity_id,
          action, field_name, old_value, new_value
        ) values (
          v_actor,
          tg_table_schema,
          tg_table_name,
          v_entity,
          case when v_key = 'status' then 'status' else 'update' end,
          v_key,
          v_old -> v_key,
          v_new -> v_key
        );
      end if;
    end loop;
    return new;
  end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tasks (exceptions, fleet, countdown). Empty until Installs writes them.
-- ---------------------------------------------------------------------------

create table core.tasks (
  id uuid primary key default gen_random_uuid(),
  module_id text not null,
  kind text not null
    check (kind in ('fleet', 'countdown', 'exception', 'general')),
  title text not null check (char_length(trim(title)) between 1 and 200),
  body text,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'done', 'cancelled')),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  due_at timestamptz,
  entity_schema text,
  entity_table text,
  entity_id uuid,
  assignee_id uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index tasks_assignee_idx on core.tasks (assignee_id, status, due_at);
create index tasks_entity_idx on core.tasks (entity_schema, entity_table, entity_id);
create index tasks_kind_status_idx on core.tasks (kind, status, due_at);

create trigger tasks_touch_updated_at
before update on core.tasks
for each row execute function public.touch_updated_at();

create trigger tasks_audit_row
after insert or update or delete on core.tasks
for each row execute function core.audit_row_change();

-- Assignee may change status only. Lead, owner, and service_role may edit the row.
create or replace function core.protect_task_update()
returns trigger
language plpgsql
set search_path = core, public
as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' and new.completed_at is null then
    new.completed_at := now();
  elsif new.status is distinct from 'done' and old.status = 'done' then
    new.completed_at := null;
  end if;

  if coalesce(auth.role(), '') = 'service_role'
     or core.has_ops_role(array['install_lead', 'admin_owner'])
  then
    return new;
  end if;

  if old.assignee_id = auth.uid()
     and new.id is not distinct from old.id
     and new.module_id is not distinct from old.module_id
     and new.kind is not distinct from old.kind
     and new.title is not distinct from old.title
     and new.body is not distinct from old.body
     and new.priority is not distinct from old.priority
     and new.due_at is not distinct from old.due_at
     and new.entity_schema is not distinct from old.entity_schema
     and new.entity_table is not distinct from old.entity_table
     and new.entity_id is not distinct from old.entity_id
     and new.assignee_id is not distinct from old.assignee_id
     and new.created_by is not distinct from old.created_by
     and new.created_at is not distinct from old.created_at
  then
    return new;
  end if;

  raise exception 'app: You cannot change that task.';
end;
$$;

create trigger tasks_protect_update
before update on core.tasks
for each row execute function core.protect_task_update();

-- ---------------------------------------------------------------------------
-- In-app notifications. Email and SMS stay in the app (no provider calls here).
-- ---------------------------------------------------------------------------

create table core.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text not null,
  kind text not null,
  channel text not null default 'in_app'
    check (channel in ('in_app', 'email', 'sms')),
  link text,
  entity_schema text,
  entity_table text,
  entity_id uuid,
  read_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx
  on core.notifications (user_id, created_at desc);

comment on table core.notifications is
  'Operations notifications. People keeps public.notifications. Only read_at is writable by the recipient.';

create or replace function core.protect_notification_update()
returns trigger
language plpgsql
set search_path = core, public
as $$
begin
  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.title is distinct from old.title
     or new.body is distinct from old.body
     or new.kind is distinct from old.kind
     or new.channel is distinct from old.channel
     or new.link is distinct from old.link
     or new.entity_schema is distinct from old.entity_schema
     or new.entity_table is distinct from old.entity_table
     or new.entity_id is distinct from old.entity_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'only read_at (and sent_at by service_role) may change on core.notifications';
  end if;

  if new.sent_at is distinct from old.sent_at
     and coalesce(auth.role(), '') is distinct from 'service_role'
  then
    raise exception 'only service_role may set sent_at on core.notifications';
  end if;

  return new;
end;
$$;

create trigger notifications_protect_update
before update on core.notifications
for each row execute function core.protect_notification_update();

-- ---------------------------------------------------------------------------
-- Append-only settings. Markups live in ops.pricing_settings, not here.
-- ---------------------------------------------------------------------------

create table core.settings (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  module_id text,
  value jsonb not null,
  version integer not null check (version > 0),
  changed_by uuid references public.profiles (id) on delete set null,
  change_reason text,
  created_at timestamptz not null default now(),
  unique (key, version)
);

create index settings_key_idx on core.settings (key, version desc);

comment on table core.settings is
  'Append-only settings. Current value is the highest version per key. Markups are in ops.pricing_settings.';

create or replace function core.enforce_settings_version()
returns trigger
language plpgsql
set search_path = core, public
as $$
declare
  v_max integer;
begin
  select coalesce(max(version), 0) into v_max
  from core.settings
  where key = new.key;

  if new.version <> v_max + 1 then
    raise exception 'app: Settings version must be the next version for this key.';
  end if;

  return new;
end;
$$;

create trigger settings_enforce_version
before insert on core.settings
for each row execute function core.enforce_settings_version();

create or replace function core.prevent_settings_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'core.settings rows are immutable; insert a new version';
end;
$$;

create trigger settings_immutable
before update or delete on core.settings
for each row execute function core.prevent_settings_mutation();

create or replace function core.audit_settings_version()
returns trigger
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_old jsonb;
begin
  select value into v_old
  from core.settings
  where key = new.key
    and version < new.version
  order by version desc
  limit 1;

  insert into core.audit_log (
    actor_id, module_id, entity_schema, entity_table, entity_id,
    action, field_name, old_value, new_value, details
  ) values (
    coalesce(new.changed_by, auth.uid()),
    new.module_id,
    'core',
    'settings',
    new.id,
    case when v_old is null then 'insert' else 'update' end,
    new.key,
    v_old,
    new.value,
    jsonb_build_object('version', new.version, 'reason', new.change_reason)
  );

  return new;
end;
$$;

create trigger settings_audit_version
after insert on core.settings
for each row execute function core.audit_settings_version();

create or replace view core.settings_current
with (security_barrier = true, security_invoker = true) as
select distinct on (key)
  id, key, module_id, value, version, changed_by, change_reason, created_at
from core.settings
order by key, version desc;

comment on view core.settings_current is
  'Latest version of each settings key. Row security of core.settings applies.';

-- ---------------------------------------------------------------------------
-- File metadata. Bytes live in private Storage buckets. Paths use ids only.
-- ---------------------------------------------------------------------------

create table core.files (
  id uuid primary key default gen_random_uuid(),
  bucket text not null
    check (bucket in ('access-media', 'job-sheets', 'qc', 'insurance', 'terms')),
  storage_path text not null check (char_length(trim(storage_path)) between 1 and 500),
  mime_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  checksum text,
  uploaded_by uuid references public.profiles (id) on delete set null,
  entity_schema text,
  entity_table text,
  entity_id uuid,
  kind text,
  created_at timestamptz not null default now(),
  unique (bucket, storage_path)
);

create index files_entity_idx
  on core.files (entity_schema, entity_table, entity_id);

comment on table core.files is
  'Metadata for private Storage objects. Customer names are not used in storage_path.';

-- Private buckets. No client storage policies: the server uploads and signs URLs.
insert into storage.buckets (id, name, public, file_size_limit)
values
  ('access-media', 'access-media', false, 52428800),
  ('job-sheets', 'job-sheets', false, 20971520),
  ('qc', 'qc', false, 20971520),
  ('insurance', 'insurance', false, 20971520),
  ('terms', 'terms', false, 20971520)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;

-- ---------------------------------------------------------------------------
-- Gate overrides. Insert only for the named owner. Rows are immutable.
-- ---------------------------------------------------------------------------

create table core.gate_overrides (
  id uuid primary key default gen_random_uuid(),
  module_id text not null default 'operations',
  entity_schema text not null default 'ops',
  entity_table text not null,
  entity_id uuid not null,
  gate text not null,
  reason text not null check (char_length(trim(reason)) between 1 and 2000),
  overridden_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index gate_overrides_entity_idx
  on core.gate_overrides (entity_schema, entity_table, entity_id, created_at desc);

create index gate_overrides_by_idx
  on core.gate_overrides (overridden_by, created_at desc);

comment on table core.gate_overrides is
  'Named-owner gate bypass. A reason is required. Rows cannot be edited.';

create or replace function core.prevent_gate_override_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'core.gate_overrides is immutable';
end;
$$;

create trigger gate_overrides_immutable
before update or delete on core.gate_overrides
for each row execute function core.prevent_gate_override_mutation();

create trigger gate_overrides_audit_row
after insert on core.gate_overrides
for each row execute function core.audit_row_change();

-- ---------------------------------------------------------------------------
-- Token links. The plaintext token is never stored. No authenticated policies.
-- ---------------------------------------------------------------------------

create table core.token_links (
  id uuid primary key default gen_random_uuid(),
  purpose text not null
    check (purpose in ('access_form', 'portal', 'subcontractor_job', 'tc_accept')),
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  entity_schema text not null check (entity_schema in ('ops', 'core')),
  entity_table text not null check (entity_table ~ '^[a-z][a-z0-9_]{0,62}$'),
  entity_id uuid not null,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_viewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index token_links_entity_idx
  on core.token_links (entity_schema, entity_table, entity_id);

comment on table core.token_links is
  'SHA-256 of a 32-byte token. service_role only. Authenticated has no privileges and no policies.';

comment on column core.token_links.token_hash is
  'SHA-256 of the raw 32 token bytes, not of the base64url text.';

-- ---------------------------------------------------------------------------
-- Role helpers. security definer so policies can read ops_roles without recursion.
-- ---------------------------------------------------------------------------

create or replace function core.has_ops_role(roles text[])
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.module_access m
      on m.profile_id = p.id
     and m.module_id = 'operations'
     and m.enabled
    join core.ops_roles r on r.profile_id = p.id
    where p.id = auth.uid()
      and p.is_active
      and p.access_granted
      and r.ops_role = any (roles)
  );
$$;

create or replace function core.is_ops_owner()
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  select exists (
    select 1
    from core.ops_roles r
    join public.profiles p on p.id = r.profile_id
    where r.profile_id = auth.uid()
      and r.is_owner
      and p.is_active
      and p.access_granted
  );
$$;

comment on function core.has_ops_role(text[]) is
  'True when the signed-in person has the Operations module and one of the given roles.';

comment on function core.is_ops_owner() is
  'True for the named owner (Alex). Required for gate overrides and settings writes.';

-- The named owner flag cannot be attached to anyone except Alex.
create or replace function core.guard_ops_owner()
returns trigger
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_email text;
begin
  select lower(email) into v_email
  from public.profiles
  where id = new.profile_id;

  if new.is_owner and v_email is distinct from 'alex.ives@jordanfitness.com' then
    raise exception 'app: Only the named owner can hold is_owner.';
  end if;

  if new.is_owner then
    new.ops_role := 'admin_owner';
  end if;

  return new;
end;
$$;

create trigger ops_roles_guard_owner
before insert or update on core.ops_roles
for each row execute function core.guard_ops_owner();

create trigger ops_roles_audit_row
after insert or update or delete on core.ops_roles
for each row execute function core.audit_row_change();

-- Keep Alex as admin_owner + is_owner, and keep the Operations module on.
-- Runs after the People profile insert, so it does not replace handle_new_user.
create or replace function core.ensure_named_owner()
returns trigger
language plpgsql
security definer
set search_path = core, public
as $$
begin
  if lower(new.email) is distinct from 'alex.ives@jordanfitness.com' then
    return new;
  end if;

  insert into public.module_access (profile_id, module_id, enabled)
  values (new.id, 'operations', true)
  on conflict (profile_id, module_id) do update
    set enabled = true
    where public.module_access.enabled is distinct from true;

  insert into core.ops_roles (profile_id, ops_role, is_owner)
  values (new.id, 'admin_owner', true)
  on conflict (profile_id) do update
    set ops_role = 'admin_owner',
        is_owner = true
    where core.ops_roles.ops_role is distinct from 'admin_owner'
       or core.ops_roles.is_owner is distinct from true;

  return new;
end;
$$;

create trigger profiles_ensure_named_owner
after insert or update of email on public.profiles
for each row execute function core.ensure_named_owner();

-- ---------------------------------------------------------------------------
-- Row level security.
-- token_links: enabled, and deliberately no policies for authenticated or anon.
-- ---------------------------------------------------------------------------

alter table core.ops_roles enable row level security;
alter table core.workflow_definitions enable row level security;
alter table core.workflow_states enable row level security;
alter table core.workflow_transitions enable row level security;
alter table core.audit_log enable row level security;
alter table core.tasks enable row level security;
alter table core.notifications enable row level security;
alter table core.settings enable row level security;
alter table core.files enable row level security;
alter table core.gate_overrides enable row level security;
alter table core.token_links enable row level security;

revoke all on all tables in schema core from public, anon, authenticated;

grant select on table core.ops_roles to authenticated;
grant select on table core.workflow_definitions to authenticated;
grant select on table core.workflow_states to authenticated;
grant select on table core.workflow_transitions to authenticated;
grant select on table core.audit_log to authenticated;
grant select, insert, update on table core.tasks to authenticated;
grant select, update on table core.notifications to authenticated;
grant select, insert on table core.settings to authenticated;
grant select on table core.files to authenticated;
grant select, insert on table core.gate_overrides to authenticated;
grant select on core.settings_current to authenticated;

-- token_links: service_role only. Authenticated receives nothing.
grant all on all tables in schema core to service_role;
grant all on core.settings_current to service_role;

create policy "Read own operations role"
on core.ops_roles
for select
to authenticated
using (profile_id = auth.uid() or core.has_ops_role(array['admin_owner']));

create policy "Leads read workflow definitions"
on core.workflow_definitions
for select
to authenticated
using (core.has_ops_role(array['install_lead', 'admin_owner']));

create policy "Leads read workflow states"
on core.workflow_states
for select
to authenticated
using (core.has_ops_role(array['install_lead', 'admin_owner']));

create policy "Leads read workflow transitions"
on core.workflow_transitions
for select
to authenticated
using (core.has_ops_role(array['install_lead', 'admin_owner']));

create policy "Leads read the operations audit log"
on core.audit_log
for select
to authenticated
using (core.has_ops_role(array['install_lead', 'admin_owner']));

create policy "Read tasks you are involved in"
on core.tasks
for select
to authenticated
using (
  assignee_id = auth.uid()
  or created_by = auth.uid()
  or core.has_ops_role(array['install_lead', 'admin_owner'])
);

create policy "Leads and HQ create tasks"
on core.tasks
for insert
to authenticated
with check (
  created_by = auth.uid()
  and core.has_ops_role(array['install_lead', 'admin_owner', 'hq'])
);

create policy "Assignees and leads update tasks"
on core.tasks
for update
to authenticated
using (
  assignee_id = auth.uid()
  or core.has_ops_role(array['install_lead', 'admin_owner'])
)
with check (
  assignee_id = auth.uid()
  or core.has_ops_role(array['install_lead', 'admin_owner'])
);

create policy "Read own operations notifications"
on core.notifications
for select
to authenticated
using (user_id = auth.uid());

create policy "Mark own operations notifications read"
on core.notifications
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "Leads and the owner read settings"
on core.settings
for select
to authenticated
using (core.has_ops_role(array['install_lead', 'admin_owner']));

create policy "Owner inserts the next settings version"
on core.settings
for insert
to authenticated
with check (core.is_ops_owner() and changed_by = auth.uid());

create policy "Leads read file metadata"
on core.files
for select
to authenticated
using (core.has_ops_role(array['install_lead', 'admin_owner']));

create policy "Leads read gate overrides"
on core.gate_overrides
for select
to authenticated
using (core.has_ops_role(array['install_lead', 'admin_owner']));

create policy "Owner inserts gate overrides"
on core.gate_overrides
for insert
to authenticated
with check (
  core.is_ops_owner()
  and overridden_by = auth.uid()
  and module_id = 'operations'
  and entity_schema in ('ops', 'core')
);

-- ---------------------------------------------------------------------------
-- Function privileges. Trigger helpers are executable by signed-in users so
-- writes can fire them. Token and audit writers stay on service_role / owner.
-- ---------------------------------------------------------------------------

revoke all on all functions in schema core from public, anon, authenticated;

grant execute on function core.has_ops_role(text[]) to authenticated, service_role;
grant execute on function core.is_ops_owner() to authenticated, service_role;
grant execute on function core.prevent_audit_mutation() to authenticated, service_role;
grant execute on function core.audit_row_change() to authenticated, service_role;
grant execute on function core.protect_task_update() to authenticated, service_role;
grant execute on function core.protect_notification_update() to authenticated, service_role;
grant execute on function core.enforce_settings_version() to authenticated, service_role;
grant execute on function core.prevent_settings_mutation() to authenticated, service_role;
grant execute on function core.audit_settings_version() to authenticated, service_role;
grant execute on function core.prevent_gate_override_mutation() to authenticated, service_role;
grant execute on function core.guard_ops_owner() to authenticated, service_role;
grant execute on function core.ensure_named_owner() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Public RPCs. These work before core is added to the Data API exposed schemas.
-- ---------------------------------------------------------------------------

create or replace function public.orbit_has_ops_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  select core.has_ops_role(p_roles);
$$;

create or replace function public.orbit_is_ops_owner()
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  select core.is_ops_owner();
$$;

create or replace function public.orbit_list_notifications(p_unread_only boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = core, public
as $$
declare
  v_rows jsonb;
begin
  if auth.uid() is null then
    raise exception 'app: You need to be signed in.';
  end if;

  select coalesce(jsonb_agg(row_data order by created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select
      jsonb_build_object(
        'id', n.id,
        'title', n.title,
        'body', n.body,
        'kind', n.kind,
        'channel', n.channel,
        'link', n.link,
        'read_at', n.read_at,
        'created_at', n.created_at
      ) as row_data,
      n.created_at
    from core.notifications n
    where n.user_id = auth.uid()
      and (not coalesce(p_unread_only, false) or n.read_at is null)
    order by n.created_at desc
    limit 100
  ) listed;

  return v_rows;
end;
$$;

create or replace function public.orbit_mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'app: You need to be signed in.';
  end if;

  update core.notifications
  set read_at = now()
  where user_id = auth.uid()
    and read_at is null
    and (p_ids is null or id = any (p_ids));

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.orbit_insert_notification(
  p_user_id uuid,
  p_title text,
  p_body text,
  p_kind text,
  p_channel text default 'in_app',
  p_link text default null,
  p_entity_schema text default null,
  p_entity_table text default null,
  p_entity_id uuid default null
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
    raise exception 'app: You cannot create notifications.';
  end if;

  if p_title is null or char_length(trim(p_title)) = 0 or p_body is null or char_length(trim(p_body)) = 0 then
    raise exception 'app: A notification needs a title and a body.';
  end if;

  if p_channel not in ('in_app', 'email', 'sms') then
    raise exception 'app: That notification channel is not valid.';
  end if;

  insert into core.notifications (
    user_id, title, body, kind, channel, link, entity_schema, entity_table, entity_id
  ) values (
    p_user_id,
    trim(p_title),
    trim(p_body),
    trim(p_kind),
    p_channel,
    nullif(trim(coalesce(p_link, '')), ''),
    p_entity_schema,
    p_entity_table,
    p_entity_id
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.orbit_list_tasks()
returns jsonb
language plpgsql
stable
security definer
set search_path = core, public
as $$
declare
  v_rows jsonb;
begin
  if auth.uid() is null then
    raise exception 'app: You need to be signed in.';
  end if;

  select coalesce(jsonb_agg(row_data order by created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select
      jsonb_build_object(
        'id', t.id,
        'module_id', t.module_id,
        'kind', t.kind,
        'title', t.title,
        'body', t.body,
        'status', t.status,
        'priority', t.priority,
        'due_at', t.due_at,
        'entity_schema', t.entity_schema,
        'entity_table', t.entity_table,
        'entity_id', t.entity_id,
        'assignee_id', t.assignee_id,
        'created_by', t.created_by,
        'created_at', t.created_at,
        'completed_at', t.completed_at
      ) as row_data,
      t.created_at
    from core.tasks t
    where t.assignee_id = auth.uid()
       or t.created_by = auth.uid()
       or core.has_ops_role(array['install_lead', 'admin_owner'])
    order by t.created_at desc
    limit 200
  ) listed;

  return v_rows;
end;
$$;

create or replace function public.orbit_create_task(
  p_kind text,
  p_title text,
  p_body text default null,
  p_priority text default 'normal',
  p_due_at timestamptz default null,
  p_assignee_id uuid default null,
  p_entity_schema text default null,
  p_entity_table text default null,
  p_entity_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_id uuid;
  v_row core.tasks%rowtype;
begin
  if auth.uid() is null then
    raise exception 'app: You need to be signed in.';
  end if;

  if not core.has_ops_role(array['install_lead', 'admin_owner', 'hq']) then
    raise exception 'app: You cannot create tasks.';
  end if;

  if p_kind not in ('fleet', 'countdown', 'exception', 'general') then
    raise exception 'app: That task kind is not valid.';
  end if;

  if p_priority is null or p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'app: That priority is not valid.';
  end if;

  if p_title is null or char_length(trim(p_title)) not between 1 and 200 then
    raise exception 'app: Give the task a title of 200 characters or fewer.';
  end if;

  if p_assignee_id is not null and not exists (
    select 1 from public.profiles where id = p_assignee_id and is_active and access_granted
  ) then
    raise exception 'app: That assignee could not be found.';
  end if;

  if p_entity_schema is not null and p_entity_schema not in ('ops', 'core') then
    raise exception 'app: That task cannot be linked to that record.';
  end if;

  insert into core.tasks (
    module_id, kind, title, body, priority, due_at,
    entity_schema, entity_table, entity_id, assignee_id, created_by
  ) values (
    'operations',
    p_kind,
    trim(p_title),
    nullif(trim(coalesce(p_body, '')), ''),
    p_priority,
    p_due_at,
    p_entity_schema,
    p_entity_table,
    p_entity_id,
    p_assignee_id,
    auth.uid()
  )
  returning id into v_id;

  select * into v_row from core.tasks where id = v_id;

  return jsonb_build_object(
    'id', v_row.id,
    'module_id', v_row.module_id,
    'kind', v_row.kind,
    'title', v_row.title,
    'body', v_row.body,
    'status', v_row.status,
    'priority', v_row.priority,
    'due_at', v_row.due_at,
    'assignee_id', v_row.assignee_id,
    'created_by', v_row.created_by,
    'created_at', v_row.created_at
  );
end;
$$;

create or replace function public.orbit_update_task(
  p_task_id uuid,
  p_status text default null,
  p_title text default null,
  p_body text default null,
  p_priority text default null,
  p_due_at timestamptz default null,
  p_assignee_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_row core.tasks%rowtype;
  v_lead boolean;
begin
  if auth.uid() is null then
    raise exception 'app: You need to be signed in.';
  end if;

  select * into v_row
  from core.tasks
  where id = p_task_id
  for update;

  if not found then
    raise exception 'app: That task could not be found.';
  end if;

  v_lead := core.has_ops_role(array['install_lead', 'admin_owner'])
    or coalesce(auth.role(), '') = 'service_role';

  if not v_lead and v_row.assignee_id is distinct from auth.uid() then
    raise exception 'app: That task could not be found.';
  end if;

  if p_status is not null and p_status not in ('open', 'in_progress', 'done', 'cancelled') then
    raise exception 'app: That status is not valid.';
  end if;

  if not v_lead then
    if p_title is not null or p_body is not null or p_priority is not null
       or p_due_at is not null or p_assignee_id is not null
    then
      raise exception 'app: You cannot change that task.';
    end if;
    if p_status is null then
      raise exception 'app: Choose a status.';
    end if;
  end if;

  if p_priority is not null and p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'app: That priority is not valid.';
  end if;

  if p_title is not null and char_length(trim(p_title)) not between 1 and 200 then
    raise exception 'app: Give the task a title of 200 characters or fewer.';
  end if;

  if p_assignee_id is not null and not exists (
    select 1 from public.profiles where id = p_assignee_id and is_active and access_granted
  ) then
    raise exception 'app: That assignee could not be found.';
  end if;

  update core.tasks
  set
    status = coalesce(p_status, status),
    title = coalesce(nullif(trim(p_title), ''), title),
    body = case when p_body is null then body else nullif(trim(p_body), '') end,
    priority = coalesce(p_priority, priority),
    due_at = coalesce(p_due_at, due_at),
    assignee_id = coalesce(p_assignee_id, assignee_id)
  where id = p_task_id
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'title', v_row.title,
    'body', v_row.body,
    'priority', v_row.priority,
    'due_at', v_row.due_at,
    'assignee_id', v_row.assignee_id,
    'completed_at', v_row.completed_at,
    'updated_at', v_row.updated_at
  );
end;
$$;

create or replace function public.orbit_store_token_link(
  p_purpose text,
  p_token_hash text,
  p_entity_schema text,
  p_entity_table text,
  p_entity_id uuid,
  p_expires_at timestamptz default null
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
    raise exception 'app: You cannot create a token link.';
  end if;

  if p_purpose not in ('access_form', 'portal', 'subcontractor_job', 'tc_accept') then
    raise exception 'app: That token purpose is not valid.';
  end if;

  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'app: Token hash is invalid.';
  end if;

  if p_entity_schema not in ('ops', 'core')
     or p_entity_table is null
     or p_entity_table !~ '^[a-z][a-z0-9_]{0,62}$'
  then
    raise exception 'app: That record cannot have a token link.';
  end if;

  insert into core.token_links (
    purpose, token_hash, entity_schema, entity_table, entity_id, expires_at
  ) values (
    p_purpose,
    decode(p_token_hash, 'hex'),
    p_entity_schema,
    p_entity_table,
    p_entity_id,
    p_expires_at
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.orbit_resolve_token(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_row core.token_links%rowtype;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: You cannot resolve a token link.';
  end if;

  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select * into v_row
  from core.token_links
  where token_hash = decode(p_token_hash, 'hex')
  for update;

  if not found
     or v_row.revoked_at is not null
     or (v_row.expires_at is not null and v_row.expires_at <= now())
  then
    return null;
  end if;

  update core.token_links
  set last_viewed_at = now()
  where id = v_row.id;

  return jsonb_build_object(
    'id', v_row.id,
    'purpose', v_row.purpose,
    'entity_schema', v_row.entity_schema,
    'entity_table', v_row.entity_table,
    'entity_id', v_row.entity_id,
    'expires_at', v_row.expires_at
  );
end;
$$;

create or replace function public.orbit_revoke_token_link(p_token_link_id uuid)
returns void
language plpgsql
security definer
set search_path = core, public
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: You cannot revoke a token link.';
  end if;

  update core.token_links
  set revoked_at = coalesce(revoked_at, now())
  where id = p_token_link_id;
end;
$$;

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
     or p_storage_path !~ '^[a-z0-9][a-z0-9_./-]{0,480}$'
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

create or replace function public.orbit_insert_gate_override(
  p_entity_schema text,
  p_entity_table text,
  p_entity_id uuid,
  p_gate text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_id uuid;
begin
  if not core.is_ops_owner() then
    raise exception 'app: Only the owner can override a gate.';
  end if;

  if p_entity_schema not in ('ops', 'core')
     or p_entity_table is null
     or p_entity_table !~ '^[a-z][a-z0-9_]{0,62}$'
  then
    raise exception 'app: That record cannot take a gate override.';
  end if;

  if p_gate is null or char_length(trim(p_gate)) not between 1 and 80 then
    raise exception 'app: Name the gate you are overriding.';
  end if;

  if p_reason is null or char_length(trim(p_reason)) not between 1 and 2000 then
    raise exception 'app: A reason is required.';
  end if;

  insert into core.gate_overrides (
    module_id, entity_schema, entity_table, entity_id, gate, reason, overridden_by
  ) values (
    'operations',
    p_entity_schema,
    p_entity_table,
    p_entity_id,
    trim(p_gate),
    trim(p_reason),
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.orbit_has_ops_role(text[]) from public, anon;
revoke all on function public.orbit_is_ops_owner() from public, anon;
revoke all on function public.orbit_list_notifications(boolean) from public, anon;
revoke all on function public.orbit_mark_notifications_read(uuid[]) from public, anon;
revoke all on function public.orbit_insert_notification(uuid, text, text, text, text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.orbit_list_tasks() from public, anon;
revoke all on function public.orbit_create_task(text, text, text, text, timestamptz, uuid, text, text, uuid) from public, anon;
revoke all on function public.orbit_update_task(uuid, text, text, text, text, timestamptz, uuid) from public, anon;
revoke all on function public.orbit_store_token_link(text, text, text, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.orbit_resolve_token(text) from public, anon, authenticated;
revoke all on function public.orbit_revoke_token_link(uuid) from public, anon, authenticated;
revoke all on function public.orbit_register_file(text, text, text, bigint, text, uuid, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.orbit_insert_gate_override(text, text, uuid, text, text) from public, anon;

grant execute on function public.orbit_has_ops_role(text[]) to authenticated, service_role;
grant execute on function public.orbit_is_ops_owner() to authenticated, service_role;
grant execute on function public.orbit_list_notifications(boolean) to authenticated, service_role;
grant execute on function public.orbit_mark_notifications_read(uuid[]) to authenticated, service_role;
grant execute on function public.orbit_insert_notification(uuid, text, text, text, text, text, text, text, uuid) to service_role;
grant execute on function public.orbit_list_tasks() to authenticated, service_role;
grant execute on function public.orbit_create_task(text, text, text, text, timestamptz, uuid, text, text, uuid) to authenticated, service_role;
grant execute on function public.orbit_update_task(uuid, text, text, text, text, timestamptz, uuid) to authenticated, service_role;
grant execute on function public.orbit_store_token_link(text, text, text, text, uuid, timestamptz) to service_role;
grant execute on function public.orbit_resolve_token(text) to service_role;
grant execute on function public.orbit_revoke_token_link(uuid) to service_role;
grant execute on function public.orbit_register_file(text, text, text, bigint, text, uuid, text, text, uuid, text) to service_role;
grant execute on function public.orbit_insert_gate_override(text, text, uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Named owner backfill, workflow seed, and non-secret settings.
-- Markups are not copied here. They are seeded on ops.pricing_settings.
-- ---------------------------------------------------------------------------

insert into public.module_access (profile_id, module_id, enabled)
select id, 'operations', true
from public.profiles
where lower(email) = 'alex.ives@jordanfitness.com'
on conflict (profile_id, module_id) do update
set enabled = true
where public.module_access.enabled is distinct from true;

insert into core.ops_roles (profile_id, ops_role, is_owner)
select id, 'admin_owner', true
from public.profiles
where lower(email) = 'alex.ives@jordanfitness.com'
on conflict (profile_id) do update
set ops_role = 'admin_owner',
    is_owner = true
where core.ops_roles.ops_role is distinct from 'admin_owner'
   or core.ops_roles.is_owner is distinct from true;

insert into core.workflow_definitions (module_id, name, entity_table)
values ('operations', 'install_job', 'ops.install_jobs');

insert into core.workflow_states (workflow_id, code, label, is_terminal, sort_order)
select d.id, s.code, s.label, s.is_terminal, s.sort_order
from core.workflow_definitions d
cross join (
  values
    ('priced', 'Priced', false, 10),
    ('sub_price_pending', 'Subcontractor price pending', false, 20),
    ('ordered', 'Ordered', false, 30),
    ('awaiting_access', 'Awaiting access', false, 40),
    ('variation', 'Variation', false, 50),
    ('ready_to_book', 'Ready to book', false, 60),
    ('booked', 'Booked', false, 70),
    ('in_build', 'In build', false, 80),
    ('ready_to_dispatch', 'Ready to dispatch', false, 90),
    ('on_site', 'On site', false, 100),
    ('completed', 'Completed', false, 110),
    ('closed', 'Closed', true, 120),
    ('on_hold', 'On hold', false, 130),
    ('lost_cancelled', 'Lost / cancelled', true, 140)
) as s(code, label, is_terminal, sort_order)
where d.module_id = 'operations'
  and d.name = 'install_job';

insert into core.workflow_transitions (
  workflow_id, from_state, to_state, event, guard_name, is_manual
)
select d.id, t.from_state, t.to_state, t.event, t.guard_name, t.is_manual
from core.workflow_definitions d
cross join (
  values
    ('priced', 'sub_price_pending', 'no_inhouse_date', 'no_inhouse_date', false),
    ('sub_price_pending', 'priced', 'customer_price_returned', 'customer_price_returned', false),
    ('priced', 'ordered', 'cin7_sales_order', 'cin7_sales_order', false),
    ('ordered', 'awaiting_access', 'access_form_sent', 'access_form_sent', false),
    ('awaiting_access', 'variation', 'access_declined', 'access_declined', false),
    ('awaiting_access', 'ready_to_book', 'gates_clear', 'gates_clear', false),
    ('variation', 'ready_to_book', 'variation_confirmed', 'variation_confirmed', false),
    ('ready_to_book', 'booked', 'booking_firmed', 'booking_firmed', false),
    ('booked', 'in_build', 'hq_build_started', 'hq_build_started', false),
    ('booked', 'ready_to_dispatch', 'site_dispatch_ready', 'site_dispatch_ready', false),
    ('in_build', 'ready_to_dispatch', 'qc_dispatch_ready', 'qc_dispatch_ready', false),
    ('ready_to_dispatch', 'on_site', 'dispatch_accepted', 'dispatch_accepted', false),
    ('on_site', 'completed', 'job_signed_off', 'job_signed_off', false),
    ('completed', 'closed', 'close_job', 'close_job', false),
    ('awaiting_access', 'awaiting_access', 'release_pencil', 'release_pencil', false),
    ('*', 'on_hold', 'place_on_hold', null, true),
    ('*', 'lost_cancelled', 'mark_lost_cancelled', null, true)
) as t(from_state, to_state, event, guard_name, is_manual)
where d.module_id = 'operations'
  and d.name = 'install_job';

insert into core.settings (key, module_id, value, version, change_reason)
values
  (
    'installs.pricing_home',
    'operations',
    '{"schema":"ops","table":"pricing_settings"}'::jsonb,
    1,
    'M0: markups, minimum job charge, and margin floor live on ops.pricing_settings.'
  ),
  (
    'installs.big_install_triggers',
    'operations',
    '{
      "kit_and_flooring": true,
      "weight_kg": {"enabled": true, "threshold_kg": 2000},
      "town_or_city_centre": true,
      "non_ground_or_stairs": true,
      "assembled_dhz": true
    }'::jsonb,
    1,
    'OPEN #6: all five big-install triggers stay on until Alex confirms the two added ones.'
  ),
  (
    'installs.access_reminder_days',
    'operations',
    '[1, 3, 5]'::jsonb,
    1,
    'Proposed access-form reminder days.'
  ),
  (
    'installs.subcontractor_insurance_warning_days',
    'operations',
    '30'::jsonb,
    1,
    'Warn when subcontractor insurance expires within 30 days.'
  );

notify pgrst, 'reload schema';
