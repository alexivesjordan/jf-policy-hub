-- SKU effort is the pricing operator. Cin7 category names are stored as Cin7 sends them.
-- A sync may refresh suggested rows. It must not change a confirmed row.
-- TODO: segment will later come from HubSpot. Until then a quote's segment is remembered per Cin7 customer.

create table ops.cin7_category_defaults (
  category text primary key,
  needs_assembly boolean,
  crew integer check (crew is null or crew between 1 and 6),
  build_minutes integer check (build_minutes is null or build_minutes between 0 and 480),
  status text not null default 'suggested' check (status in ('suggested', 'confirmed')),
  notes text,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table ops.cin7_category_defaults is
  'Suggested build for a Cin7 product category. needs_assembly null means unknown.';

create table ops.sku_effort (
  sku text primary key,
  product_name text not null,
  cin7_category text,
  cin7_product_id text,
  needs_assembly boolean,
  crew integer check (crew is null or crew between 1 and 6),
  build_minutes integer check (build_minutes is null or build_minutes between 0 and 480),
  status text not null default 'suggested' check (status in ('suggested', 'confirmed')),
  notes text,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create index sku_effort_category_idx on ops.sku_effort (cin7_category);
create index sku_effort_status_idx on ops.sku_effort (status);

comment on table ops.sku_effort is
  'One row per Cin7 SKU. Confirmed rows are not overwritten by product sync.';

alter table ops.cin7_category_defaults enable row level security;
alter table ops.sku_effort enable row level security;
revoke all on ops.cin7_category_defaults from public, anon, authenticated;
revoke all on ops.sku_effort from public, anon, authenticated;
grant select on ops.cin7_category_defaults, ops.sku_effort to service_role;

create or replace function ops.can_price()
returns boolean
language sql
stable
as $$
  select core.is_ops_owner()
    or core.has_ops_role(array['sales', 'install_lead', 'admin_owner', 'ops_manager', 'hq']);
$$;

revoke all on function ops.can_price() from public, anon, authenticated;

create or replace function public.orbit_cin7_category_defaults()
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, core, public
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' and not ops.can_price() then
    raise exception 'app: You cannot read category defaults.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'category', category,
      'needs_assembly', needs_assembly,
      'crew', crew,
      'build_minutes', build_minutes,
      'status', status,
      'notes', notes
    ) order by category)
    from ops.cin7_category_defaults
  ), '[]'::jsonb);
end;
$$;

create or replace function public.orbit_save_cin7_category_defaults(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_row jsonb;
begin
  if not core.is_ops_owner() then
    raise exception 'app: Only the owner can edit category defaults.';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'app: Category defaults must be a list.';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    update ops.cin7_category_defaults
    set needs_assembly = case
          when v_row->>'needs_assembly' is null or v_row->>'needs_assembly' = '' then null
          else (v_row->>'needs_assembly')::boolean
        end,
        crew = nullif(v_row->>'crew', '')::integer,
        build_minutes = nullif(v_row->>'build_minutes', '')::integer,
        status = coalesce(nullif(v_row->>'status', ''), status),
        notes = v_row->>'notes',
        updated_by = auth.uid(),
        updated_at = now()
    where category = v_row->>'category';
  end loop;
  return public.orbit_cin7_category_defaults();
end;
$$;

create or replace function public.orbit_sku_effort_for_pricing(p_skus text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, core, public
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' and not ops.can_price() then
    raise exception 'app: You cannot read the effort table.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'sku', sku,
      'product_name', product_name,
      'cin7_category', cin7_category,
      'needs_assembly', needs_assembly,
      'crew', crew,
      'build_minutes', build_minutes,
      'status', status
    ))
    from ops.sku_effort
    where sku = any(p_skus)
  ), '[]'::jsonb);
end;
$$;

create or replace function public.orbit_list_sku_effort(
  p_search text,
  p_category text,
  p_status text,
  p_needs_assembly text,
  p_limit integer,
  p_offset integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, core, public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 5000);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(trim(coalesce(p_search, '')), '');
begin
  if not core.is_ops_owner() then
    raise exception 'app: Only the owner can open the effort table.';
  end if;
  return jsonb_build_object(
    'review_count', (
      select count(*) from ops.sku_effort
      where status = 'suggested' or cin7_category = 'Other'
    ),
    'total', (
      select count(*) from ops.sku_effort e
      where (v_search is null or e.sku ilike '%' || v_search || '%' or e.product_name ilike '%' || v_search || '%')
        and (coalesce(p_category, '') = '' or e.cin7_category = p_category)
        and (coalesce(p_status, '') = '' or e.status = p_status)
        and (coalesce(p_needs_assembly, '') = '' or (p_needs_assembly = 'yes' and e.needs_assembly is true) or (p_needs_assembly = 'no' and e.needs_assembly is false) or (p_needs_assembly = 'unknown' and e.needs_assembly is null))
    ),
    'categories', coalesce((
      select jsonb_agg(category order by category)
      from (
        select category from ops.cin7_category_defaults
        union
        select cin7_category from ops.sku_effort where cin7_category is not null
      ) names(category)
    ), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(row_to_json(hit))
      from (
        select sku, product_name, cin7_category, needs_assembly, crew, build_minutes, status, notes
        from ops.sku_effort e
        where (v_search is null or e.sku ilike '%' || v_search || '%' or e.product_name ilike '%' || v_search || '%')
          and (coalesce(p_category, '') = '' or e.cin7_category = p_category)
          and (coalesce(p_status, '') = '' or e.status = p_status)
          and (coalesce(p_needs_assembly, '') = '' or (p_needs_assembly = 'yes' and e.needs_assembly is true) or (p_needs_assembly = 'no' and e.needs_assembly is false) or (p_needs_assembly = 'unknown' and e.needs_assembly is null))
        order by e.cin7_category nulls last, e.sku
        limit v_limit offset v_offset
      ) hit
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.orbit_update_sku_effort(
  p_skus text[],
  p_needs_assembly text,
  p_crew integer,
  p_minutes integer,
  p_status text,
  p_notes text
)
returns integer
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_count integer;
begin
  if not core.is_ops_owner() then
    raise exception 'app: Only the owner can edit the effort table.';
  end if;
  if p_status is not null and p_status not in ('suggested', 'confirmed') then
    raise exception 'app: Status must be suggested or confirmed.';
  end if;
  update ops.sku_effort
  set needs_assembly = case
        when p_needs_assembly is null or p_needs_assembly = '' then needs_assembly
        when p_needs_assembly = 'unknown' then null
        else p_needs_assembly = 'yes'
      end,
      crew = coalesce(p_crew, crew),
      build_minutes = coalesce(p_minutes, build_minutes),
      status = coalesce(p_status, status),
      notes = coalesce(p_notes, notes),
      updated_by = auth.uid(),
      updated_at = now()
  where sku = any(p_skus);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.orbit_import_sku_effort(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_row jsonb;
  v_count integer := 0;
  v_sku text;
begin
  if not core.is_ops_owner() then
    raise exception 'app: Only the owner can import the effort table.';
  end if;
  for v_row in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_sku := nullif(trim(v_row->>'sku'), '');
    if v_sku is null then
      continue;
    end if;
    insert into ops.sku_effort (
      sku, product_name, cin7_category, needs_assembly, crew, build_minutes, status, notes, updated_by
    ) values (
      v_sku,
      coalesce(nullif(trim(v_row->>'product_name'), ''), v_sku),
      nullif(trim(v_row->>'cin7_category'), ''),
      case
        when v_row->>'needs_assembly' is null or v_row->>'needs_assembly' = '' then null
        else lower(v_row->>'needs_assembly') in ('true', 'yes', '1', 'y')
      end,
      nullif(v_row->>'crew', '')::integer,
      nullif(v_row->>'build_minutes', '')::integer,
      case when lower(coalesce(v_row->>'status', '')) = 'confirmed' then 'confirmed' else 'suggested' end,
      v_row->>'notes',
      auth.uid()
    )
    on conflict (sku) do update
    set product_name = coalesce(nullif(trim(excluded.product_name), ''), ops.sku_effort.product_name),
        cin7_category = coalesce(excluded.cin7_category, ops.sku_effort.cin7_category),
        needs_assembly = coalesce(excluded.needs_assembly, ops.sku_effort.needs_assembly),
        crew = coalesce(excluded.crew, ops.sku_effort.crew),
        build_minutes = coalesce(excluded.build_minutes, ops.sku_effort.build_minutes),
        status = excluded.status,
        notes = coalesce(excluded.notes, ops.sku_effort.notes),
        updated_by = auth.uid(),
        updated_at = now();
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Product sync. Confirmed rows are left untouched. Suggested rows keep crew and minutes unless the category changed.
create or replace function public.orbit_sync_sku_effort(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_row jsonb;
  v_count integer := 0;
  v_sku text;
  v_category text;
  v_assembly boolean;
  v_crew integer;
  v_minutes integer;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' and not core.is_ops_owner() then
    raise exception 'app: Only the owner can sync products.';
  end if;
  for v_row in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_sku := nullif(trim(v_row->>'sku'), '');
    if v_sku is null then
      continue;
    end if;
    v_category := nullif(trim(v_row->>'cin7_category'), '');
    select needs_assembly, crew, build_minutes
      into v_assembly, v_crew, v_minutes
    from ops.cin7_category_defaults
    where category = v_category;
    insert into ops.sku_effort (
      sku, product_name, cin7_category, cin7_product_id, needs_assembly, crew, build_minutes, status
    ) values (
      v_sku,
      coalesce(nullif(trim(v_row->>'product_name'), ''), v_sku),
      v_category,
      nullif(trim(v_row->>'cin7_product_id'), ''),
      v_assembly,
      v_crew,
      v_minutes,
      'suggested'
    )
    on conflict (sku) do update
    set product_name = excluded.product_name,
        cin7_product_id = excluded.cin7_product_id,
        needs_assembly = case
          when ops.sku_effort.cin7_category is distinct from excluded.cin7_category then excluded.needs_assembly
          else ops.sku_effort.needs_assembly
        end,
        crew = case
          when ops.sku_effort.cin7_category is distinct from excluded.cin7_category then excluded.crew
          else ops.sku_effort.crew
        end,
        build_minutes = case
          when ops.sku_effort.cin7_category is distinct from excluded.cin7_category then excluded.build_minutes
          else ops.sku_effort.build_minutes
        end,
        cin7_category = excluded.cin7_category,
        updated_at = now()
    where ops.sku_effort.status <> 'confirmed';
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.orbit_customer_segment(p_cin7_id text)
returns text
language plpgsql
stable
security definer
set search_path = ops, core, public
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' and not ops.can_price() then
    raise exception 'app: You cannot read that customer.';
  end if;
  return (
    select segment::text from ops.customers
    where cin7_id = nullif(trim(p_cin7_id), '')
  );
end;
$$;

-- TODO: replace this memory with the HubSpot segment when that source is connected.
create or replace function public.orbit_remember_segment(
  p_cin7_id text,
  p_name text,
  p_segment text
)
returns void
language plpgsql
security definer
set search_path = ops, core, public
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' and not ops.can_price() then
    raise exception 'app: You cannot save that segment.';
  end if;
  if nullif(trim(p_cin7_id), '') is null then
    return;
  end if;
  if p_segment is not null and p_segment not in ('independent', 'franchisee', 'trade', 'big_corporate') then
    raise exception 'app: That segment is not valid.';
  end if;
  insert into ops.customers (cin7_id, name, segment)
  values (trim(p_cin7_id), coalesce(nullif(trim(p_name), ''), 'Customer'), nullif(p_segment, '')::ops.customer_segment)
  on conflict (cin7_id) do update
  set name = coalesce(nullif(trim(excluded.name), ''), ops.customers.name),
      segment = coalesce(excluded.segment, ops.customers.segment);
end;
$$;

create or replace function public.orbit_record_cin7_sale(
  p_order_number text,
  p_sale_id text,
  p_customer_id text,
  p_customer_name text,
  p_segment text,
  p_postcode text,
  p_mode text,
  p_inputs jsonb,
  p_finality text,
  p_provisional jsonb,
  p_internal_cost numeric,
  p_customer_price numeric,
  p_markup numeric,
  p_lines jsonb,
  p_big_install boolean,
  p_triggers text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_customer uuid;
  v_site uuid;
  v_job uuid;
  v_quote uuid;
  v_version uuid;
  v_line jsonb;
  v_key text;
begin
  if auth.uid() is null then
    raise exception 'app: You need to be signed in.';
  end if;
  if not ops.can_price() then
    raise exception 'app: You cannot price a quote.';
  end if;
  if p_order_number is null or p_order_number !~ '^[A-Za-z0-9-]{1,40}$' then
    raise exception 'app: That order number cannot be stored.';
  end if;
  if p_mode not in ('A', 'B') or p_finality not in ('final', 'provisional') then
    raise exception 'app: That quote cannot be stored.';
  end if;
  if p_segment is not null and p_segment not in ('independent', 'franchisee', 'trade', 'big_corporate') then
    raise exception 'app: Choose a customer segment.';
  end if;

  v_key := coalesce(nullif(trim(p_customer_id), ''), 'SALE-' || p_order_number);
  insert into ops.customers (cin7_id, name, segment, owner_rep_id)
  values (
    v_key,
    coalesce(nullif(trim(p_customer_name), ''), 'Customer'),
    nullif(p_segment, '')::ops.customer_segment,
    case when core.has_ops_role(array['sales']) and not core.has_ops_role(array['install_lead', 'admin_owner', 'ops_manager']) and not core.is_ops_owner() then auth.uid() else null end
  )
  on conflict (cin7_id) do update
  set name = excluded.name,
      segment = coalesce(excluded.segment, ops.customers.segment)
  returning id into v_customer;

  select id into v_site
  from ops.sites
  where customer_id = v_customer and postcode = upper(trim(p_postcode))
  limit 1;
  if v_site is null then
    insert into ops.sites (customer_id, name, postcode)
    values (v_customer, 'Site', upper(trim(p_postcode)))
    returning id into v_site;
  end if;

  select id into v_job from ops.install_jobs where cin7_number = p_order_number;
  if v_job is null then
    insert into ops.install_jobs (
      cin7_number, cin7_order_number, cin7_quote_number, customer_id, site_id, owner_rep_id, status,
      big_install, big_install_triggers, pricer_version
    ) values (
      p_order_number,
      p_order_number,
      nullif(trim(p_sale_id), ''),
      v_customer,
      v_site,
      case when core.has_ops_role(array['sales']) and not core.has_ops_role(array['install_lead', 'admin_owner', 'ops_manager']) and not core.is_ops_owner() then auth.uid() else null end,
      'priced',
      coalesce(p_big_install, false),
      coalesce(p_triggers, '{}'),
      'v2.5'
    )
    returning id into v_job;
  else
    update ops.install_jobs
    set cin7_order_number = p_order_number,
        cin7_quote_number = coalesce(nullif(trim(p_sale_id), ''), cin7_quote_number),
        big_install = coalesce(p_big_install, big_install),
        big_install_triggers = coalesce(p_triggers, big_install_triggers),
        pricer_version = 'v2.5',
        site_id = coalesce(site_id, v_site)
    where id = v_job;
  end if;

  delete from ops.job_lines where job_id = v_job;
  for v_line in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    insert into ops.job_lines (job_id, cin7_sku, description, qty, category, provisional)
    values (
      v_job,
      coalesce(v_line->>'sku', ''),
      v_line->>'productName',
      greatest((v_line->>'qty')::numeric, 0.01),
      v_line->>'category',
      coalesce((v_line->>'provisional')::boolean, false)
    );
  end loop;

  select id into v_version from ops.effort_table_versions where version_label = 'v2.5' limit 1;
  insert into ops.quote_versions (
    job_id, mode, inputs, pricer_version, effort_table_version_id,
    pricing_settings_version, internal_cost, customer_price, markup_applied,
    segment, finality, provisional_items, created_by
  ) values (
    v_job,
    p_mode::ops.quote_mode,
    coalesce(p_inputs, '{}'::jsonb),
    'v2.5',
    v_version,
    (select max(version) from ops.pricing_settings),
    p_internal_cost,
    p_customer_price,
    p_markup,
    nullif(p_segment, '')::ops.customer_segment,
    p_finality,
    coalesce(p_provisional, '[]'::jsonb),
    auth.uid()
  )
  returning id into v_quote;

  if p_internal_cost is not null then
    insert into ops.quote_costs (quote_version_id, cost_breakdown, margin_floor_price)
    values (v_quote, jsonb_build_object('internal_cost', p_internal_cost), null);
  end if;

  return jsonb_build_object('job_id', v_job, 'quote_id', v_quote, 'customer_price', p_customer_price);
end;
$$;

revoke all on function public.orbit_cin7_category_defaults() from public, anon;
revoke all on function public.orbit_save_cin7_category_defaults(jsonb) from public, anon;
revoke all on function public.orbit_sku_effort_for_pricing(text[]) from public, anon;
revoke all on function public.orbit_list_sku_effort(text, text, text, text, integer, integer) from public, anon;
revoke all on function public.orbit_update_sku_effort(text[], text, integer, integer, text, text) from public, anon;
revoke all on function public.orbit_import_sku_effort(jsonb) from public, anon;
revoke all on function public.orbit_sync_sku_effort(jsonb) from public, anon;
revoke all on function public.orbit_customer_segment(text) from public, anon;
revoke all on function public.orbit_remember_segment(text, text, text) from public, anon;
revoke all on function public.orbit_record_cin7_sale(text, text, text, text, text, text, text, jsonb, text, jsonb, numeric, numeric, numeric, jsonb, boolean, text[]) from public, anon;

grant execute on function public.orbit_cin7_category_defaults() to authenticated, service_role;
grant execute on function public.orbit_save_cin7_category_defaults(jsonb) to authenticated, service_role;
grant execute on function public.orbit_sku_effort_for_pricing(text[]) to authenticated, service_role;
grant execute on function public.orbit_list_sku_effort(text, text, text, text, integer, integer) to authenticated, service_role;
grant execute on function public.orbit_update_sku_effort(text[], text, integer, integer, text, text) to authenticated, service_role;
grant execute on function public.orbit_import_sku_effort(jsonb) to authenticated, service_role;
grant execute on function public.orbit_sync_sku_effort(jsonb) to authenticated, service_role;
grant execute on function public.orbit_customer_segment(text) to authenticated, service_role;
grant execute on function public.orbit_remember_segment(text, text, text) to authenticated, service_role;
grant execute on function public.orbit_record_cin7_sale(text, text, text, text, text, text, text, jsonb, text, jsonb, numeric, numeric, numeric, jsonb, boolean, text[]) to authenticated, service_role;

insert into ops.cin7_category_defaults (category, needs_assembly, crew, build_minutes, status, notes)
values
  ('Kettlebells', false, 1, 0, 'suggested', 'Small kit. Handling and carry only.'),
  ('Dumbbells', false, 1, 0, 'suggested', 'Small kit. Handling and carry only.'),
  ('Bumper Plates', false, 1, 0, 'suggested', 'Small kit. Handling and carry only.'),
  ('Functional Training Balls', false, 1, 0, 'suggested', 'Small kit. Handling and carry only.'),
  ('Bars', false, 1, 0, 'suggested', 'Small kit. Handling and carry only.'),
  ('Fixed Barbells', false, 1, 0, 'suggested', 'Small kit. Handling and carry only.'),
  ('Resistance', false, 1, 0, 'suggested', 'Small kit. Handling and carry only.'),
  ('Rope Trainers', false, 1, 0, 'suggested', 'Small kit. Handling and carry only.'),
  ('Treadmills', true, 2, 120, 'suggested', 'Each machine: 2-man, 2-hour build.'),
  ('Bikes', true, 2, 120, 'suggested', 'Each machine: 2-man, 2-hour build.'),
  ('Rowers', true, 2, 120, 'suggested', 'Each machine: 2-man, 2-hour build.'),
  ('Ski Machines', true, 2, 120, 'suggested', 'Each machine: 2-man, 2-hour build.'),
  ('Elliptical Trainers', true, 2, 120, 'suggested', 'Each machine: 2-man, 2-hour build.'),
  ('Rigs & Racks', true, 2, 120, 'suggested', 'Each machine: 2-man, 2-hour build.'),
  ('Weight Benches', true, 2, 120, 'suggested', 'Each machine: 2-man, 2-hour build.'),
  ('Gym Storage', true, 2, 120, 'suggested', 'Each machine: 2-man, 2-hour build.'),
  ('Other', null, null, null, 'suggested', 'Unknown. Priced as a conservative 2-man, 2-hour assembly until a SKU is confirmed.');
