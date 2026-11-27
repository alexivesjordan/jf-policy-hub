-- Lets an import resolve Orderwise codes against aliases and known SKUs.
-- New file only. Do not apply to production.

create or replace function public.supply_match_codes(p_source text, p_codes jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = supply, public
as $$
declare
  v_source text := case when p_source in ('orderwise', 'cin7') then p_source else 'orderwise' end;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' and not supply.can_read() then
    raise exception 'app: You cannot see supply records.';
  end if;
  return coalesce((
    select jsonb_object_agg(code, sku)
    from (
      select c.code,
        coalesce(
          (select a.sku from supply.sku_aliases a where a.source = v_source and a.external_code = c.code),
          (select k.sku from supply.sku_settings k where k.sku = c.code)
        ) as sku
      from jsonb_array_elements_text(coalesce(p_codes, '[]'::jsonb)) as c(code)
    ) matched
    where sku is not null
  ), '{}'::jsonb);
end;
$$;

revoke all on function public.supply_match_codes(text, jsonb) from public, anon;
grant execute on function public.supply_match_codes(text, jsonb) to authenticated, service_role;
