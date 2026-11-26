-- Drops the member detail functions added in 20261127110000.
-- Do not run on production.

drop function if exists public.workspace_revoke_invite(text);
drop function if exists public.workspace_pending_invites();
drop function if exists public.workspace_member_list();
drop function if exists public.workspace_member(uuid);
drop function if exists public.workspace_access_row(uuid, text);
