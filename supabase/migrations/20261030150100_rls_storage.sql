-- Row level security for every application table, plus the document bucket.
-- Direct writes to policies, versions, amendments, and the audit log are
-- blocked. Use the functions in 20261030150000_schema.sql.

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.policies enable row level security;
alter table public.policy_versions enable row level security;
alter table public.amendments enable row level security;
alter table public.audit_log enable row level security;
alter table public.notifications enable row level security;

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.categories from anon, authenticated;
revoke all on table public.policies from anon, authenticated;
revoke all on table public.policy_versions from anon, authenticated;
revoke all on table public.amendments from anon, authenticated;
revoke all on table public.audit_log from anon, authenticated;
revoke all on table public.notifications from anon, authenticated;

grant select, update on table public.profiles to authenticated;
grant select, insert, update on table public.categories to authenticated;
grant select on table public.policies to authenticated;
grant select on table public.policy_versions to authenticated;
grant select on table public.amendments to authenticated;
grant select on table public.audit_log to authenticated;
grant select, update on table public.notifications to authenticated;

grant all on all tables in schema public to service_role;

-- Profiles -------------------------------------------------------------------

create policy "Read own profile"
on public.profiles
for select
to authenticated
using (id = auth.uid());

create policy "Active users read colleague profiles"
on public.profiles
for select
to authenticated
using (public.is_active_user());

create policy "Admins update profiles"
on public.profiles
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Users update their own name"
on public.profiles
for update
to authenticated
using (id = auth.uid() and public.is_active_user())
with check (
  id = auth.uid()
  and is_active = true
  and role = public.current_role()
  and email = public.current_email()
);

-- Categories -----------------------------------------------------------------

create policy "Active users read categories"
on public.categories
for select
to authenticated
using (public.is_active_user());

create policy "Admins add categories"
on public.categories
for insert
to authenticated
with check (public.is_admin());

create policy "Admins update categories"
on public.categories
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Library --------------------------------------------------------------------

create policy "Active users read policies"
on public.policies
for select
to authenticated
using (public.is_active_user());

create policy "Active users read policy versions"
on public.policy_versions
for select
to authenticated
using (public.is_active_user());

create policy "Active users read amendments"
on public.amendments
for select
to authenticated
using (public.is_active_user());

create policy "Active users read the audit log"
on public.audit_log
for select
to authenticated
using (public.is_active_user());

-- Notifications --------------------------------------------------------------

create policy "Users read their notifications"
on public.notifications
for select
to authenticated
using (user_id = auth.uid());

create policy "Users mark their notifications read"
on public.notifications
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Storage --------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('policy-documents', 'policy-documents', false, 12582912)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;

create policy "Active users read policy documents"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'policy-documents'
  and public.is_active_user()
);

create policy "Active users upload policy documents"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'policy-documents'
  and public.is_active_user()
);

create policy "Active users replace policy documents"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'policy-documents'
  and public.is_active_user()
)
with check (
  bucket_id = 'policy-documents'
  and public.is_active_user()
);
