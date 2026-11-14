-- Store a customer email on a quote before it is booked, and give the
-- access-form sender the names it needs. New file only. Do not apply to production.

create or replace function public.install_prepare_quote_email(p_quote uuid, p_email text)
returns text
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_quote ops.install_quotes%rowtype;
  v_given text := lower(btrim(coalesce(p_email, '')));
  v_stored text;
begin
  if ops.is_field_engineer() then
    raise exception 'app: You cannot book an install.';
  end if;
  if not (public.workspace_can('sales', 'edit') or public.workspace_can('operations', 'edit')) then
    raise exception 'app: You cannot book an install.';
  end if;
  select * into v_quote from ops.install_quotes where id = p_quote for update;
  if v_quote.id is null then
    raise exception 'app: Price the order before booking.';
  end if;
  if v_quote.install_id is not null then
    raise exception 'app: That quote is already booked.';
  end if;
  if v_given <> '' then
    if v_given !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      raise exception 'app: Enter an email address.';
    end if;
    update ops.install_quotes
    set payload = jsonb_set(coalesce(payload, '{}'::jsonb), '{contactEmail}', to_jsonb(v_given), true)
    where id = p_quote;
    return v_given;
  end if;
  v_stored := lower(btrim(coalesce(v_quote.payload->>'contactEmail', '')));
  if v_stored = '' then
    return null;
  end if;
  if v_stored !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return null;
  end if;
  return v_stored;
end;
$$;

revoke all on function public.install_prepare_quote_email(uuid, text) from public, anon;
grant execute on function public.install_prepare_quote_email(uuid, text) to authenticated, service_role;

create or replace function public.install_access_email_context(p_install uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, public
as $$
declare
  v_row ops.installs%rowtype;
  v_name text;
  v_email text;
  v_postcode text;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: You cannot read that install.';
  end if;
  select * into v_row from ops.installs where id = p_install;
  if v_row.id is null then
    return null;
  end if;
  select full_name, email into v_name, v_email
  from public.profiles
  where id = v_row.booking_rep_id;
  select nullif(btrim(payload->>'postcode'), '') into v_postcode
  from ops.install_quotes
  where id = v_row.quote_id;
  return jsonb_build_object(
    'contactName', v_row.contact_name,
    'customerName', v_row.customer_name,
    'orderNumber', v_row.order_number,
    'siteAddress', v_row.site_address,
    'postcode', v_postcode,
    'repName', v_name,
    'repEmail', v_email
  );
end;
$$;

revoke all on function public.install_access_email_context(uuid) from public, anon, authenticated;
grant execute on function public.install_access_email_context(uuid) to service_role;
