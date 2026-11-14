-- Jordan Elite Cardio is built at HQ and ships assembled.
-- New file only. Do not apply this to production.

create or replace function ops.elite_cardio_item(p_sku text, p_name text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_sku, '') ~* '^JF-EC-'
      or coalesce(p_name, '') ~* 'elite[[:space:]]+cardio';
$$;

revoke all on function ops.elite_cardio_item(text, text) from public, anon, authenticated;

update ops.sku_effort
set needs_assembly = true,
    crew = 2,
    build_minutes = 120,
    build_location = 'hq',
    hq_build_minutes = 120,
    hq_build_crew = 2,
    site_position_minutes = 45,
    suggestion_rule = case when status = 'suggested' then 'elite-cardio' else suggestion_rule end,
    updated_at = now()
where ops.elite_cardio_item(sku, product_name);

comment on function ops.elite_cardio_item(text, text) is
  'Default HQ profile for Jordan Elite Cardio. A confirmed SKU row can still override it in the pricer.';
