-- Saved container and vehicle load plans, and admin edits of measured load spaces.
-- Pallet catalogue rows stay read-only. Container and vehicle rows can be added,
-- edited, or deactivated by a logistics admin.
-- Depends on logistics.can_use() and logistics.load_spaces from earlier logistics migrations.
-- New file only. Do not apply to production.

create or replace function logistics.can_admin_spaces()
returns boolean
language sql
stable
security definer
set search_path = public, ops
as $$
  select exists (
    select 1
    from public.profiles as profile
    where profile.id = (select auth.uid())
      and profile.is_active
      and profile.access_granted
      and profile.deleted_at is null
      and not ops.is_field_engineer()
      and (
        public.workspace_is_admin()
        or public.workspace_level(profile.id, 'logistics') = 'admin'
      )
  );
$$;

comment on function logistics.can_admin_spaces() is
  'True for a workspace admin or a logistics admin who is not a field engineer.';

revoke all on function logistics.can_admin_spaces() from public, anon;
grant execute on function logistics.can_admin_spaces() to authenticated, service_role;

create or replace function public.logistics_can_admin_spaces()
returns boolean
language sql
stable
security invoker
set search_path = logistics, public
as $$
  select logistics.can_admin_spaces();
$$;

revoke all on function public.logistics_can_admin_spaces() from public, anon;
grant execute on function public.logistics_can_admin_spaces() to authenticated, service_role;

alter table logistics.load_spaces
  drop constraint if exists load_spaces_code_format;

alter table logistics.load_spaces
  add constraint load_spaces_code_format
  check (code ~ '^[a-z0-9][a-z0-9-]{0,39}$');

grant insert, update on logistics.load_spaces to authenticated;

create policy load_spaces_admin_insert
on logistics.load_spaces
for insert
to authenticated
with check (
  (select logistics.can_admin_spaces())
  and kind in ('container', 'vehicle')
);

create policy load_spaces_admin_update
on logistics.load_spaces
for update
to authenticated
using (
  (select logistics.can_admin_spaces())
  and kind in ('container', 'vehicle')
)
with check (
  (select logistics.can_admin_spaces())
  and kind in ('container', 'vehicle')
);

create table logistics.load_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  space_code text not null references logistics.load_spaces (code),
  reference text not null default '' check (char_length(reference) <= 200),
  pieces jsonb not null check (
    jsonb_typeof(pieces) = 'array'
    and jsonb_array_length(pieces) <= 500
    and octet_length(pieces::text) <= 200000
  ),
  summary jsonb not null check (
    jsonb_typeof(summary) = 'object'
    and octet_length(summary::text) <= 800000
  ),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table logistics.load_plans is
  'A saved container or vehicle load. pieces is the item list. summary is the pack result. No customer contact details.';
comment on column logistics.load_plans.reference is
  'Sale, purchase, or supplier reference. Not a customer name or email.';
comment on column logistics.load_plans.summary is
  'Pack result at save time, including placements. Reopening shows this snapshot.';

create index load_plans_space_code_idx on logistics.load_plans (space_code);
create index load_plans_created_by_idx on logistics.load_plans (created_by);
create index load_plans_updated_at_idx on logistics.load_plans (updated_at desc);

create or replace function logistics.load_plans_keep_author()
returns trigger
language plpgsql
security invoker
set search_path = logistics
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'app: The author of a load plan stays as it was.';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'app: The created time of a load plan stays as it was.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function logistics.load_plans_keep_author() from public, anon;
grant execute on function logistics.load_plans_keep_author() to authenticated, service_role;

create trigger load_plans_keep_author
before update on logistics.load_plans
for each row execute function logistics.load_plans_keep_author();

alter table logistics.load_plans enable row level security;

revoke all on logistics.load_plans from public, anon;
grant select, insert, update on logistics.load_plans to authenticated;
grant all on logistics.load_plans to service_role;

create policy load_plans_select
on logistics.load_plans
for select
to authenticated
using ((select logistics.can_use()));

create policy load_plans_insert
on logistics.load_plans
for insert
to authenticated
with check (
  (select logistics.can_use())
  and created_by = (select auth.uid())
);

create policy load_plans_update
on logistics.load_plans
for update
to authenticated
using ((select logistics.can_use()))
with check ((select logistics.can_use()));
