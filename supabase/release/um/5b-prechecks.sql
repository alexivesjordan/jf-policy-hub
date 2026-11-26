-- Read only. Expected: the two-step tables are absent.
-- Do not apply to production.

select to_regclass('core.security_policy') as policy, to_regclass('core.email_challenges') as challenges;
