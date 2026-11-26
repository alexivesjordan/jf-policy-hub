-- Read only. Run before 20261127110000_workspace_member_detail.sql.
-- Expected: the new functions are absent, and the counts are profiles and unused invites.
-- Ids and roles only in the role list. Do not apply to production.

select to_regprocedure('public.workspace_member(uuid)') as member_fn;

select workspace_role, count(*) as people
from public.profiles
group by workspace_role
order by workspace_role;

select count(*) as invites_without_a_profile
from public.access_grants g
where not exists (
  select 1 from public.profiles p where lower(p.email) = lower(g.email)
);
