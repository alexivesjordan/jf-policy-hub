-- Packaging catalogue, pallet estimate handoff, and load-space catalogue.
-- Depends on logistics.can_use() from 20261121100000.
-- Cin7 product Length/Width/Height are not copied: they are not the shipping carton.
-- New file only.

create table logistics.load_spaces (
  code text primary key,
  kind text not null check (kind in ('pallet', 'container', 'vehicle')),
  name text not null,
  length_cm integer not null check (length_cm between 1 and 2000),
  width_cm integer not null check (width_cm between 1 and 500),
  height_cm integer not null check (height_cm between 1 and 400),
  max_weight_kg numeric(10,1) not null check (max_weight_kg > 0 and max_weight_kg <= 40000),
  tare_kg numeric(8,1) not null default 0 check (tare_kg >= 0),
  deck_cm integer not null default 0 check (deck_cm >= 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  check (deck_cm < height_cm),
  check (tare_kg < max_weight_kg)
);

comment on table logistics.load_spaces is
  'Interior of a pallet, container, or vehicle. The packer reads this shape for a later load planner.';
comment on column logistics.load_spaces.height_cm is
  'Pallet: default overall height, including deck_cm. Container or vehicle: internal height.';
comment on column logistics.load_spaces.max_weight_kg is
  'Pallet: maximum gross weight, including tare_kg. Container or vehicle: maximum cargo weight.';
comment on column logistics.load_spaces.deck_cm is
  'Pallet deck thickness. Zero when the floor is already inside the internal height.';

-- Starting figures, not a carrier contract. Pallet deck and tare are typical timber pallets.
-- Container figures are published internal sizes rounded to whole centimetres.
-- Vehicle figures are typical UK load beds, not a measured Jordan Fitness vehicle.
insert into logistics.load_spaces
  (code, kind, name, length_cm, width_cm, height_cm, max_weight_kg, tare_kg, deck_cm, sort_order)
values
  ('uk-standard', 'pallet', 'UK standard', 120, 100, 180, 1000, 25, 15, 10),
  ('euro', 'pallet', 'Euro', 120, 80, 180, 1000, 20, 14, 20),
  ('container-20dc', 'container', '20ft dry', 590, 235, 239, 21700, 0, 0, 30),
  ('container-40dc', 'container', '40ft dry', 1203, 235, 239, 26500, 0, 0, 40),
  ('container-40hc', 'container', '40ft high cube', 1203, 235, 270, 26400, 0, 0, 50),
  ('van-lwb', 'vehicle', 'LWB panel van', 350, 178, 189, 1200, 0, 0, 60),
  ('rigid-7-5', 'vehicle', '7.5t rigid', 610, 240, 220, 2500, 0, 0, 70);

create table logistics.packing_settings (
  id text primary key default 'default' check (id = 'default'),
  pallet_code text not null references logistics.load_spaces (code),
  max_pallet_height_cm integer not null default 180 check (max_pallet_height_cm between 50 and 300),
  max_pallet_weight_kg numeric(8,1) not null default 1000 check (max_pallet_weight_kg between 50 and 2000),
  max_parcel_weight_kg numeric(6,1) not null default 30 check (max_parcel_weight_kg between 0.1 and 100),
  max_parcel_length_cm integer not null default 120 check (max_parcel_length_cm between 10 and 300),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table logistics.packing_settings is
  'Shared starting limits for the pack estimator. A run can override them without saving.';

insert into logistics.packing_settings (id, pallet_code)
values ('default', 'uk-standard');

create index packing_settings_updated_by_idx on logistics.packing_settings (updated_by);
create index packing_settings_pallet_code_idx on logistics.packing_settings (pallet_code);

create table logistics.sku_packages (
  id bigint generated always as identity primary key,
  sku text not null check (char_length(sku) between 1 and 80),
  product_name text not null check (char_length(product_name) between 1 and 200),
  cin7_category text check (cin7_category is null or char_length(cin7_category) <= 200),
  cin7_product_id text check (cin7_product_id is null or char_length(cin7_product_id) <= 80),
  package_no integer not null check (package_no between 1 and 20),
  length_cm integer check (length_cm is null or length_cm between 1 and 1000),
  width_cm integer check (width_cm is null or width_cm between 1 and 1000),
  height_cm integer check (height_cm is null or height_cm between 1 and 1000),
  gross_weight_kg numeric(8,1) check (gross_weight_kg is null or (gross_weight_kg > 0 and gross_weight_kg <= 2000)),
  stackable boolean not null default true,
  max_stack integer check (max_stack is null or max_stack between 1 and 20),
  can_be_on_side boolean not null default false,
  ships_on_pallet_only boolean not null default false,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (sku, package_no)
);

comment on table logistics.sku_packages is
  'Shipping packages for one SKU. An item may have several boxes. Empty dimensions stay empty.';

create index sku_packages_updated_by_idx on logistics.sku_packages (updated_by);
create index sku_packages_missing_idx on logistics.sku_packages (sku, package_no)
  where length_cm is null or width_cm is null or height_cm is null or gross_weight_kg is null;

create table logistics.pack_estimates (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  order_numbers text not null default '' check (char_length(order_numbers) <= 500),
  lines jsonb not null check (jsonb_typeof(lines) = 'array'),
  settings jsonb not null check (jsonb_typeof(settings) = 'object'),
  result jsonb not null check (jsonb_typeof(result) = 'object')
);

comment on table logistics.pack_estimates is
  'A saved pack estimate. The commercial invoice reads its dimension rows. No customer contact details.';

create index pack_estimates_created_by_idx on logistics.pack_estimates (created_by);

alter table logistics.load_spaces enable row level security;
alter table logistics.packing_settings enable row level security;
alter table logistics.sku_packages enable row level security;
alter table logistics.pack_estimates enable row level security;

revoke all on logistics.load_spaces, logistics.packing_settings, logistics.sku_packages, logistics.pack_estimates
  from public, anon;

grant select on logistics.load_spaces to authenticated;
grant select, update on logistics.packing_settings to authenticated;
grant select, insert, update, delete on logistics.sku_packages to authenticated;
grant usage, select on sequence logistics.sku_packages_id_seq to authenticated;
grant select, insert on logistics.pack_estimates to authenticated;

grant all on logistics.load_spaces, logistics.packing_settings, logistics.sku_packages, logistics.pack_estimates to service_role;
grant usage, select on sequence logistics.sku_packages_id_seq to service_role;

create policy load_spaces_logistics
on logistics.load_spaces
for select
to authenticated
using (logistics.can_use());

create policy packing_settings_logistics
on logistics.packing_settings
for all
to authenticated
using (logistics.can_use())
with check (logistics.can_use());

create policy sku_packages_logistics
on logistics.sku_packages
for all
to authenticated
using (logistics.can_use())
with check (logistics.can_use());

create policy pack_estimates_logistics
on logistics.pack_estimates
for select
to authenticated
using (logistics.can_use());

create policy pack_estimates_insert
on logistics.pack_estimates
for insert
to authenticated
with check (logistics.can_use());

create or replace function public.logistics_list_sku_packages(
  p_search text,
  p_missing boolean,
  p_limit integer,
  p_offset integer
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = logistics, public
as $$
declare
  v_search text := left(replace(replace(replace(coalesce(p_search, ''), '\', ''), '%', ''), '_', ''), 80);
  v_missing boolean := coalesce(p_missing, false);
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 1000);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not logistics.can_use() then
    raise exception 'app: You cannot read packaging.';
  end if;
  return (
    with matched as (
      select *
      from logistics.sku_packages as package
      where (
        v_search = ''
        or package.sku ilike '%' || v_search || '%'
        or package.product_name ilike '%' || v_search || '%'
        or coalesce(package.cin7_category, '') ilike '%' || v_search || '%'
      )
      and (
        not v_missing
        or package.length_cm is null
        or package.width_cm is null
        or package.height_cm is null
        or package.gross_weight_kg is null
      )
    )
    select jsonb_build_object(
      'total', (select count(*) from matched),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', picked.id,
          'sku', picked.sku,
          'product_name', picked.product_name,
          'cin7_category', picked.cin7_category,
          'package_no', picked.package_no,
          'length_cm', picked.length_cm,
          'width_cm', picked.width_cm,
          'height_cm', picked.height_cm,
          'gross_weight_kg', picked.gross_weight_kg,
          'stackable', picked.stackable,
          'max_stack', picked.max_stack,
          'can_be_on_side', picked.can_be_on_side,
          'ships_on_pallet_only', picked.ships_on_pallet_only
        ) order by picked.sku, picked.package_no)
        from (
          select *
          from matched
          order by sku, package_no
          limit v_limit
          offset v_offset
        ) as picked
      ), '[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.logistics_seed_sku_packages(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = logistics, public
as $$
declare
  v_row jsonb;
  v_count integer := 0;
  v_sku text;
  v_name text;
  v_category text;
  v_product text;
begin
  if not logistics.can_use() then
    raise exception 'app: You cannot edit packaging.';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'app: Product sync must be a list.';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'app: Sync batch is too large.';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_sku := trim(coalesce(v_row->>'sku', ''));
    if v_sku = '' or char_length(v_sku) > 80 or v_sku ~ '[[:cntrl:]]' then
      continue;
    end if;
    v_name := left(trim(coalesce(nullif(v_row->>'product_name', ''), v_sku)), 200);
    v_category := nullif(left(trim(coalesce(v_row->>'cin7_category', '')), 200), '');
    v_product := nullif(left(trim(coalesce(v_row->>'cin7_product_id', '')), 80), '');
    insert into logistics.sku_packages (sku, product_name, cin7_category, cin7_product_id, package_no, updated_by)
    select v_sku, v_name, v_category, v_product, 1, auth.uid()
    where not exists (
      select 1 from logistics.sku_packages as existing where existing.sku = v_sku
    );
    update logistics.sku_packages
    set product_name = v_name,
        cin7_category = v_category,
        cin7_product_id = v_product
    where sku = v_sku
      and (
        product_name is distinct from v_name
        or cin7_category is distinct from v_category
        or cin7_product_id is distinct from v_product
      );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.logistics_import_sku_packages(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = logistics, public
as $$
declare
  v_row jsonb;
  v_index integer := 0;
  v_count integer := 0;
  v_sku text;
  v_name text;
  v_text text;
  v_package integer;
  v_length integer;
  v_width integer;
  v_height integer;
  v_weight numeric(8,1);
  v_stackable boolean;
  v_max integer;
  v_side boolean;
  v_pallet boolean;
begin
  if not logistics.can_use() then
    raise exception 'app: You cannot edit packaging.';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'app: Packaging import must be a list.';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'app: That CSV has too many rows.';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_index := v_index + 1;
    v_sku := trim(coalesce(v_row->>'sku', ''));
    if v_sku = '' or char_length(v_sku) > 80 or v_sku ~ '[[:cntrl:]]' then
      raise exception 'app: Row %: SKU must be 1 to 80 characters.', v_index;
    end if;
    v_name := left(trim(coalesce(v_row->>'product_name', '')), 200);
    v_text := nullif(trim(coalesce(v_row->>'package_no', '')), '');
    if v_text is null or v_text !~ '^[0-9]+$' then
      raise exception 'app: Row %: box must be a whole number.', v_index;
    end if;
    v_package := v_text::integer;
    if v_package < 1 or v_package > 20 then
      raise exception 'app: Row %: box must be from 1 to 20.', v_index;
    end if;

    v_text := nullif(trim(coalesce(v_row->>'length_cm', '')), '');
    if v_text is null then v_length := null;
    elsif v_text !~ '^[0-9]+$' then raise exception 'app: Row %: length must be whole centimetres.', v_index;
    else
      v_length := v_text::integer;
      if v_length < 1 or v_length > 1000 then
        raise exception 'app: Row %: length must be from 1 to 1000 cm.', v_index;
      end if;
    end if;

    v_text := nullif(trim(coalesce(v_row->>'width_cm', '')), '');
    if v_text is null then v_width := null;
    elsif v_text !~ '^[0-9]+$' then raise exception 'app: Row %: width must be whole centimetres.', v_index;
    else
      v_width := v_text::integer;
      if v_width < 1 or v_width > 1000 then
        raise exception 'app: Row %: width must be from 1 to 1000 cm.', v_index;
      end if;
    end if;

    v_text := nullif(trim(coalesce(v_row->>'height_cm', '')), '');
    if v_text is null then v_height := null;
    elsif v_text !~ '^[0-9]+$' then raise exception 'app: Row %: height must be whole centimetres.', v_index;
    else
      v_height := v_text::integer;
      if v_height < 1 or v_height > 1000 then
        raise exception 'app: Row %: height must be from 1 to 1000 cm.', v_index;
      end if;
    end if;

    v_text := nullif(trim(coalesce(v_row->>'gross_weight_kg', '')), '');
    if v_text is null then v_weight := null;
    elsif v_text !~ '^[0-9]+(\.[0-9])?$' then
      raise exception 'app: Row %: weight must have at most one decimal.', v_index;
    else
      v_weight := v_text::numeric;
      if v_weight <= 0 or v_weight > 2000 then
        raise exception 'app: Row %: weight must be greater than 0 and at most 2000 kg.', v_index;
      end if;
    end if;

    v_text := lower(trim(coalesce(v_row->>'stackable', 'true')));
    if v_text in ('true', 'yes', 'y', '1') then v_stackable := true;
    elsif v_text in ('false', 'no', 'n', '0') then v_stackable := false;
    else raise exception 'app: Row %: stackable must be yes or no.', v_index;
    end if;

    v_text := lower(trim(coalesce(v_row->>'can_be_on_side', 'false')));
    if v_text in ('true', 'yes', 'y', '1') then v_side := true;
    elsif v_text in ('false', 'no', 'n', '0', '') then v_side := false;
    else raise exception 'app: Row %: on side must be yes or no.', v_index;
    end if;

    v_text := lower(trim(coalesce(v_row->>'ships_on_pallet_only', 'false')));
    if v_text in ('true', 'yes', 'y', '1') then v_pallet := true;
    elsif v_text in ('false', 'no', 'n', '0', '') then v_pallet := false;
    else raise exception 'app: Row %: pallet only must be yes or no.', v_index;
    end if;

    v_text := nullif(trim(coalesce(v_row->>'max_stack', '')), '');
    if v_text is null then v_max := null;
    elsif v_text !~ '^[0-9]+$' then raise exception 'app: Row %: max stack must be a whole number.', v_index;
    else
      v_max := v_text::integer;
      if v_max < 1 or v_max > 20 then
        raise exception 'app: Row %: max stack must be from 1 to 20.', v_index;
      end if;
    end if;

    insert into logistics.sku_packages (
      sku, product_name, package_no, length_cm, width_cm, height_cm, gross_weight_kg,
      stackable, max_stack, can_be_on_side, ships_on_pallet_only, updated_by
    )
    values (
      v_sku, coalesce(nullif(v_name, ''), v_sku), v_package, v_length, v_width, v_height, v_weight,
      v_stackable, v_max, v_side, v_pallet, auth.uid()
    )
    on conflict (sku, package_no) do update
    set product_name = coalesce(nullif(v_name, ''), logistics.sku_packages.product_name),
        length_cm = excluded.length_cm,
        width_cm = excluded.width_cm,
        height_cm = excluded.height_cm,
        gross_weight_kg = excluded.gross_weight_kg,
        stackable = excluded.stackable,
        max_stack = excluded.max_stack,
        can_be_on_side = excluded.can_be_on_side,
        ships_on_pallet_only = excluded.ships_on_pallet_only,
        updated_by = auth.uid(),
        updated_at = now();
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.logistics_list_sku_packages(text, boolean, integer, integer) from public, anon;
revoke all on function public.logistics_seed_sku_packages(jsonb) from public, anon;
revoke all on function public.logistics_import_sku_packages(jsonb) from public, anon;
grant execute on function public.logistics_list_sku_packages(text, boolean, integer, integer) to authenticated, service_role;
grant execute on function public.logistics_seed_sku_packages(jsonb) to authenticated, service_role;
grant execute on function public.logistics_import_sku_packages(jsonb) to authenticated, service_role;
