-- Read only. Run before 20261127100000_hr_director_only.sql.
-- Expected: hr.is_director() exists, and the lists below are ids and roles only.
-- New file only. Do not apply to production.

select to_regprocedure('hr.is_director()') as director_fn;

select id, workspace_role
from public.profiles
where workspace_role in ('owner', 'admin')
  and is_active
order by workspace_role, id;

select profile_id
from hr.directors
order by profile_id;
