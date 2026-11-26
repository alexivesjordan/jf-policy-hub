-- Read only. Expected: invitations are absent and access grants remain.
-- Do not apply to production.

select to_regclass('core.invitations') as invitations, to_regclass('public.access_grants') as grants;
