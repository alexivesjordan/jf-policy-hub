-- Read only. Run before the role migrations.
-- Expected: guest is not a workspace role yet, and logistics is not its own team grant.
-- Do not apply to production.

select workspace_role, count(*) as people
from public.profiles
group by workspace_role
order by workspace_role;

select count(*) as logistics_team_grants
from public.workspace_team_access
where module_id = 'logistics';
