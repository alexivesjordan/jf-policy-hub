-- RLS on tables the app only reaches through security-definer functions.
-- No new table grants. Direct reads stay closed. New file only. Do not apply to production.

alter table core.companies enable row level security;
alter table core.pulses enable row level security;
alter table core.invitations enable row level security;
alter table core.email_challenges enable row level security;
alter table core.verified_sessions enable row level security;
alter table core.trusted_devices enable row level security;
alter table hr.positions enable row level security;
alter table hr.position_holders enable row level security;

revoke all on table core.companies from public, anon, authenticated;
revoke all on table core.pulses from public, anon, authenticated;
revoke all on table core.invitations from public, anon, authenticated;
revoke all on table core.email_challenges from public, anon, authenticated;
revoke all on table core.verified_sessions from public, anon, authenticated;
revoke all on table core.trusted_devices from public, anon, authenticated;
revoke all on table hr.positions from public, anon, authenticated;
revoke all on table hr.position_holders from public, anon, authenticated;

drop policy if exists companies_read on core.companies;
create policy companies_read on core.companies
  for select to authenticated
  using (public.is_active_user());

drop policy if exists pulses_read on core.pulses;
create policy pulses_read on core.pulses
  for select to authenticated
  using (public.is_active_user());

drop policy if exists positions_read on hr.positions;
create policy positions_read on hr.positions
  for select to authenticated
  using (public.is_active_user());

drop policy if exists position_holders_read on hr.position_holders;
create policy position_holders_read on hr.position_holders
  for select to authenticated
  using (public.is_active_user());

drop policy if exists invitations_read on core.invitations;
create policy invitations_read on core.invitations
  for select to authenticated
  using (public.workspace_is_admin());

drop policy if exists email_challenges_own on core.email_challenges;
create policy email_challenges_own on core.email_challenges
  for select to authenticated
  using (profile_id = auth.uid());

drop policy if exists verified_sessions_own on core.verified_sessions;
create policy verified_sessions_own on core.verified_sessions
  for select to authenticated
  using (profile_id = auth.uid());

drop policy if exists trusted_devices_own on core.trusted_devices;
create policy trusted_devices_own on core.trusted_devices
  for select to authenticated
  using (profile_id = auth.uid());
