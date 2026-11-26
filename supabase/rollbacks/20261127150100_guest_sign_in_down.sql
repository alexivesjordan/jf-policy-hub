-- Restores the previous sign-up function and drops invitations after copying member invites back.
-- Do not run on production.

insert into public.access_grants (email, full_name, role, people_enabled)
select i.email, null, 'staff', true
from core.invitations i
where i.kind = 'member'
  and not exists (select 1 from public.access_grants g where lower(g.email) = lower(i.email))
on conflict (email) do nothing;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned_email text := lower(trim(coalesce(new.email, '')));
  assigned_role text := 'staff';
  granted boolean := false;
  people_on boolean := false;
  v_first text := nullif(btrim(coalesce(new.raw_user_meta_data->>'first_name', '')), '');
  v_last text := nullif(btrim(coalesce(new.raw_user_meta_data->>'last_name', '')), '');
  display_name text := nullif(btrim(coalesce(new.raw_user_meta_data->>'full_name', '')), '');
  grant_row public.access_grants%rowtype;
begin
  if v_first is null and display_name is not null then
    if position(' ' in display_name) = 0 then
      v_first := display_name;
    else
      v_first := btrim(split_part(display_name, ' ', 1));
      v_last := coalesce(v_last, btrim(substring(display_name from position(' ' in display_name) + 1)));
    end if;
  end if;

  if cleaned_email = 'alex.ives@jordanfitness.com' then
    assigned_role := 'admin';
    granted := true;
    people_on := true;
    v_first := coalesce(v_first, 'Alex');
    v_last := coalesce(v_last, 'Ives');
  elsif cleaned_email ~ '^[^@[:space:]]+@jordanfitness\.com$' then
    select * into grant_row from public.access_grants where email = cleaned_email;
    if found then
      assigned_role := grant_row.role;
      granted := true;
      people_on := grant_row.people_enabled;
      v_first := coalesce(v_first, nullif(grant_row.first_name, ''));
      v_last := coalesce(v_last, nullif(grant_row.last_name, ''));
    end if;
  end if;

  insert into public.profiles (id, email, first_name, last_name, role, is_active, access_granted, last_sign_in_at)
  values (new.id, cleaned_email, coalesce(v_first, ''), coalesce(v_last, ''), assigned_role, true, granted, new.last_sign_in_at)
  on conflict (id) do nothing;

  perform private.seed_module_access(new.id, people_on);
  return new;
end;
$$;

drop function if exists public.guest_home_only();
drop function if exists public.guest_blocked();
drop function if exists public.revoke_invitation(uuid);
drop function if exists public.create_invitation(text, text, text, date);
drop function if exists public.invite_email_allowed(text, text);
drop table if exists core.invitations;
