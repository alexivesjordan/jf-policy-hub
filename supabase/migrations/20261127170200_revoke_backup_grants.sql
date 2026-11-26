-- Backup tables keep their rows. Signed-in and anonymous roles lose every privilege.
-- Missing tables are skipped, so this is a no-op where a backup was never taken.
-- New file only. Do not apply to production. Do not drop these tables.

do $$
declare
  v_schema text;
  v_table text;
begin
  for v_schema, v_table in
    select schema_name, table_name
    from (values
      ('public', 'profiles_backup_20261127'),
      ('public', 'module_access_backup_20261127'),
      ('public', 'access_snapshot_before_20261127'),
      ('public', 'profiles_adminrole_backup_20261126'),
      ('hr', 'seatload_employees_backup_20261126'),
      ('hr', 'seatload_positions_backup_20261126'),
      ('hr', 'seatload_holders_backup_20261126')
    ) as listed(schema_name, table_name)
  loop
    if to_regclass(format('%I.%I', v_schema, v_table)) is not null then
      execute format('revoke all on table %I.%I from public, anon, authenticated', v_schema, v_table);
    end if;
  end loop;
end
$$;
