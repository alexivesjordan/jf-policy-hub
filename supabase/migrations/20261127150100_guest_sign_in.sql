-- Guests can join from any email domain. Alex's bootstrap stays first.
-- New file only. Do not apply to production.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = core, public
as $$
declare
  cleaned_email text := lower(trim(coalesce(new.email, '')));
  assigned_role text := 'staff';
  granted boolean := false;
  people_on boolean := false;
  v_guest boolean := false;
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
  elsif exists (
    select 1 from core.invitations i
    where lower(i.email) = cleaned_email
      and i.kind = 'guest'
      and i.revoked_at is null
      and i.expires_at > now()
      and (i.ends_on is null or i.ends_on >= current_date)
  ) then
    granted := true;
    v_guest := true;
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

  if v_guest then
    update public.profiles set workspace_role = 'guest', access_granted = true where id = new.id;
    update core.invitations set accepted_at = now()
    where lower(email) = cleaned_email and kind = 'guest' and accepted_at is null;
  end if;

  perform private.seed_module_access(new.id, people_on);
  return new;
end;
$$;
