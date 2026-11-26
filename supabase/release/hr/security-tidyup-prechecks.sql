-- Read only. Run before 20261126110000_hr_security_tidyup.sql.
-- New file only. Do not apply to production.

do $$
begin
  if to_regclass('public.hr_employees') is null
     or to_regclass('public.hr_leave_requests') is null
     or to_regclass('public.hr_settings') is null
     or to_regclass('public.hr_cases') is null
     or to_regclass('public.hr_change_requests') is null
     or to_regclass('public.hr_sickness') is null
  then
    raise exception 'PRECHECK FAILED: a public HR view is missing. Apply 20261126100100 first.';
  end if;
  if to_regprocedure('hr.mask_row(text, jsonb)') is null
     or to_regprocedure('hr.mask_value(text, text, jsonb)') is null
     or to_regprocedure('hr.prevent_audit_mutation()') is null
     or to_regprocedure('hr.prevent_append_change()') is null
     or to_regprocedure('hr.aal_ok()') is null
     or to_regprocedure('hr.require_mfa()') is null
  then
    raise exception 'PRECHECK FAILED: an HR helper is missing.';
  end if;
  if to_regclass('public.calendar_entries_visible') is null then
    raise exception 'PRECHECK FAILED: public.calendar_entries_visible is missing.';
  end if;
end
$$;
