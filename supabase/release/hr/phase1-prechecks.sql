-- Read only. Run before the HR Pulse migrations.
-- New file only. Do not apply to production.

do $$
begin
  if to_regprocedure('public.is_active_user()') is null then
    raise exception 'PRECHECK FAILED: public.is_active_user() is missing.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'workspace_role'
  ) then
    raise exception 'PRECHECK FAILED: profiles.workspace_role is missing.';
  end if;
  if to_regclass('public.calendar_entries') is null then
    raise exception 'PRECHECK FAILED: public.calendar_entries is missing.';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'PRECHECK FAILED: public.is_admin() is missing.';
  end if;
end
$$;
