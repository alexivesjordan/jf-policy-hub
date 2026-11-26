-- Drops two-step tables and helpers. Do not run on production.

drop function if exists public.revoke_trusted_devices();
drop function if exists public.device_trusted(text);
drop function if exists public.trust_device(text);
drop function if exists public.email_code_verify(text);
drop function if exists public.email_code_start(text);
drop function if exists public.two_step_due();
drop function if exists core.session_verified();
drop function if exists core.code_hash(text);
drop table if exists core.trusted_devices;
drop table if exists core.verified_sessions;
drop table if exists core.email_challenges;
drop table if exists core.security_policy;
