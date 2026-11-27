-- Customer order tracker. Staff manage links; customers read one hashed token.
-- Public reads go through security-definer functions. Tables are closed to anon and authenticated.
-- New file only. Do not apply to production.

create table ops.order_trackers (
  id uuid primary key default gen_random_uuid(),
  order_number text not null,
  cin7_sale_id text,
  token_hash text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_on timestamptz not null default (now() + interval '180 days'),
  revoked_at timestamptz,
  view_count integer not null default 0,
  last_viewed_at timestamptz,
  snapshot jsonb,
  snapshot_at timestamptz,
  check (order_number ~ '^[A-Za-z0-9-]{1,40}$'),
  check (cin7_sale_id is null or cin7_sale_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  check (token_hash ~ '^[0-9a-f]{64}$'),
  check (view_count >= 0),
  check (revoked_at is null or revoked_at >= created_at),
  check (snapshot is null or jsonb_typeof(snapshot) = 'object')
);

comment on table ops.order_trackers is
  'Customer tracking link for one Cin7 order. The token is stored as a SHA-256 hash. The snapshot has no prices.';

create unique index order_trackers_token_hash_uidx on ops.order_trackers (token_hash);
create index order_trackers_order_number_idx on ops.order_trackers (lower(order_number));
create unique index order_trackers_one_active_uidx
  on ops.order_trackers (lower(order_number))
  where revoked_at is null;

create table ops.order_tracker_photos (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references ops.order_trackers (id) on delete cascade,
  file_id uuid not null unique references core.files (id) on delete restrict,
  caption text,
  sort_order integer not null default 0,
  visible boolean not null default false,
  created_at timestamptz not null default now(),
  check (caption is null or char_length(caption) <= 200),
  check (sort_order >= 0)
);

comment on table ops.order_tracker_photos is
  'QC photo on a tracking link. file_id must be a core.files row in the private qc bucket. Hidden until a member shows it.';

create index order_tracker_photos_tracker_idx
  on ops.order_tracker_photos (tracker_id, sort_order, id);

create or replace function ops.tracker_photo_file()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, core
as $$
begin
  if not exists (
    select 1
    from core.files
    where id = new.file_id
      and bucket = 'qc'
  ) then
    raise exception 'app: That photo is not in the QC bucket.';
  end if;
  return new;
end;
$$;

create trigger order_tracker_photos_qc_file
before insert or update of file_id on ops.order_tracker_photos
for each row execute function ops.tracker_photo_file();

alter table ops.order_trackers enable row level security;
alter table ops.order_trackers force row level security;
alter table ops.order_tracker_photos enable row level security;
alter table ops.order_tracker_photos force row level security;

revoke all on ops.order_trackers, ops.order_tracker_photos from public, anon, authenticated;
grant all on ops.order_trackers, ops.order_tracker_photos to service_role;

revoke all on function ops.tracker_photo_file() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Snapshot shape. Prices, notes, emails, and staff names are not accepted.
-- ---------------------------------------------------------------------------

create or replace function ops.tracker_snapshot_ok(p_snapshot jsonb)
returns void
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_key text;
  v_item jsonb;
  v_track jsonb;
  v_qty numeric;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'app: That order snapshot is not valid.';
  end if;
  if octet_length(p_snapshot::text) > 24000 then
    raise exception 'app: That order snapshot is too large.';
  end if;

  for v_key in select jsonb_object_keys(p_snapshot)
  loop
    if v_key not in (
      'orderNumber', 'saleId', 'customerName', 'status', 'orderStatus',
      'pickingStatus', 'packingStatus', 'shippingStatus', 'fulfilmentStatus',
      'shipBy', 'requiredBy', 'carrier', 'trackingNumbers', 'items'
    ) then
      raise exception 'app: That order snapshot is not valid.';
    end if;
  end loop;

  if coalesce(p_snapshot->>'orderNumber', '') !~ '^[A-Za-z0-9-]{1,40}$' then
    raise exception 'app: That order snapshot is not valid.';
  end if;
  if coalesce(p_snapshot->>'saleId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'app: That order snapshot is not valid.';
  end if;
  if char_length(coalesce(p_snapshot->>'customerName', '')) > 160 then
    raise exception 'app: That order snapshot is not valid.';
  end if;
  if char_length(btrim(coalesce(p_snapshot->>'status', ''))) not between 1 and 40 then
    raise exception 'app: That order snapshot is not valid.';
  end if;

  for v_key in
    select unnest(array['orderStatus', 'pickingStatus', 'packingStatus', 'shippingStatus', 'fulfilmentStatus', 'shipBy', 'requiredBy', 'carrier'])
  loop
    if p_snapshot ? v_key and jsonb_typeof(p_snapshot->v_key) not in ('string', 'null') then
      raise exception 'app: That order snapshot is not valid.';
    end if;
    if p_snapshot ? v_key and jsonb_typeof(p_snapshot->v_key) = 'string' and char_length(p_snapshot->>v_key) > 80 then
      raise exception 'app: That order snapshot is not valid.';
    end if;
  end loop;

  if jsonb_typeof(p_snapshot->'trackingNumbers') is distinct from 'array'
     or jsonb_array_length(p_snapshot->'trackingNumbers') > 20 then
    raise exception 'app: That order snapshot is not valid.';
  end if;
  for v_track in select value from jsonb_array_elements(p_snapshot->'trackingNumbers')
  loop
    if jsonb_typeof(v_track) <> 'string' or char_length(v_track #>> '{}') > 80 or char_length(btrim(v_track #>> '{}')) = 0 then
      raise exception 'app: That order snapshot is not valid.';
    end if;
  end loop;

  if jsonb_typeof(p_snapshot->'items') is distinct from 'array'
     or jsonb_array_length(p_snapshot->'items') > 200 then
    raise exception 'app: That order snapshot is not valid.';
  end if;
  for v_item in select value from jsonb_array_elements(p_snapshot->'items')
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'app: That order snapshot is not valid.';
    end if;
    for v_key in select jsonb_object_keys(v_item)
    loop
      if v_key not in ('name', 'quantity') then
        raise exception 'app: That order snapshot is not valid.';
      end if;
    end loop;
    if char_length(btrim(coalesce(v_item->>'name', ''))) not between 1 and 200 then
      raise exception 'app: That order snapshot is not valid.';
    end if;
    if jsonb_typeof(v_item->'quantity') is distinct from 'number' then
      raise exception 'app: That order snapshot is not valid.';
    end if;
    v_qty := (v_item->>'quantity')::numeric;
    if v_qty is null or v_qty < 0 or v_qty > 100000 then
      raise exception 'app: That order snapshot is not valid.';
    end if;
  end loop;
end;
$$;

revoke all on function ops.tracker_snapshot_ok(jsonb) from public, anon, authenticated;

create or replace function ops.tracker_require_staff()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    raise exception 'app: You need to be signed in.';
  end if;
  if not (public.workspace_can('sales', 'view') or public.workspace_can('operations', 'view')) then
    raise exception 'app: You cannot manage order tracking.';
  end if;
end;
$$;

revoke all on function ops.tracker_require_staff() from public, anon, authenticated;

create or replace function ops.tracker_public_snapshot(p_snapshot jsonb)
returns jsonb
language plpgsql
stable
set search_path = pg_catalog
as $$
declare
  v_items jsonb;
  v_tracking jsonb;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    return null;
  end if;

  select coalesce(jsonb_agg(to_jsonb(entry)), '[]'::jsonb)
    into v_tracking
  from (
    select btrim(value #>> '{}') as entry
    from jsonb_array_elements(case when jsonb_typeof(p_snapshot->'trackingNumbers') = 'array' then p_snapshot->'trackingNumbers' else '[]'::jsonb end) value
    where jsonb_typeof(value) = 'string'
      and btrim(value #>> '{}') <> ''
  ) numbers;

  select coalesce(jsonb_agg(jsonb_build_object(
    'name', btrim(item->>'name'),
    'quantity', item->'quantity'
  )), '[]'::jsonb)
    into v_items
  from jsonb_array_elements(case when jsonb_typeof(p_snapshot->'items') = 'array' then p_snapshot->'items' else '[]'::jsonb end) item
  where jsonb_typeof(item) = 'object'
    and btrim(coalesce(item->>'name', '')) <> ''
    and jsonb_typeof(item->'quantity') = 'number';

  return jsonb_build_object(
    'orderNumber', p_snapshot->>'orderNumber',
    'saleId', p_snapshot->>'saleId',
    'customerName', coalesce(p_snapshot->>'customerName', ''),
    'status', coalesce(p_snapshot->>'status', ''),
    'orderStatus', p_snapshot->>'orderStatus',
    'pickingStatus', p_snapshot->>'pickingStatus',
    'packingStatus', p_snapshot->>'packingStatus',
    'shippingStatus', p_snapshot->>'shippingStatus',
    'fulfilmentStatus', p_snapshot->>'fulfilmentStatus',
    'shipBy', p_snapshot->>'shipBy',
    'requiredBy', p_snapshot->>'requiredBy',
    'carrier', p_snapshot->>'carrier',
    'trackingNumbers', coalesce(v_tracking, '[]'::jsonb),
    'items', coalesce(v_items, '[]'::jsonb)
  );
end;
$$;

revoke all on function ops.tracker_public_snapshot(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Staff. Sales or Operations. The plaintext token never lands in the database.
-- ---------------------------------------------------------------------------

create or replace function public.order_tracker_list(p_order_number text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, ops, core
as $$
declare
  v_number text := btrim(coalesce(p_order_number, ''));
begin
  perform ops.tracker_require_staff();
  if v_number !~ '^[A-Za-z0-9-]{1,40}$' then
    raise exception 'app: Enter an order number such as SO-00490.';
  end if;

  return coalesce((
    select jsonb_agg(payload order by created_at desc)
    from (
      select
        t.created_at,
        jsonb_build_object(
          'id', t.id,
          'orderNumber', t.order_number,
          'saleId', t.cin7_sale_id,
          'createdAt', t.created_at,
          'expiresOn', t.expires_on,
          'revokedAt', t.revoked_at,
          'viewCount', t.view_count,
          'lastViewedAt', t.last_viewed_at,
          'status', case
            when t.revoked_at is not null then 'revoked'
            when t.expires_on <= now() then 'expired'
            else 'active'
          end,
          'photos', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', p.id,
              'caption', p.caption,
              'visible', p.visible,
              'sortOrder', p.sort_order,
              'path', f.storage_path,
              'mime', f.mime_type
            ) order by p.sort_order, p.created_at)
            from ops.order_tracker_photos p
            join core.files f on f.id = p.file_id
            where p.tracker_id = t.id
              and f.bucket = 'qc'
          ), '[]'::jsonb)
        ) as payload
      from ops.order_trackers t
      where lower(t.order_number) = lower(v_number)
    ) rows
  ), '[]'::jsonb);
end;
$$;

create or replace function public.order_tracker_create(
  p_order_number text,
  p_cin7_sale_id text,
  p_token_hash text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, ops
as $$
declare
  v_number text := btrim(coalesce(p_order_number, ''));
  v_sale text := btrim(coalesce(p_cin7_sale_id, ''));
  v_hash text := lower(btrim(coalesce(p_token_hash, '')));
  v_id uuid;
begin
  perform ops.tracker_require_staff();
  if v_number !~ '^[A-Za-z0-9-]{1,40}$' then
    raise exception 'app: Enter an order number such as SO-00490.';
  end if;
  if v_sale !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'app: That order was not found.';
  end if;
  if v_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'app: That tracking link could not be created.';
  end if;
  if exists (
    select 1 from ops.order_trackers
    where lower(order_number) = lower(v_number)
      and revoked_at is null
  ) then
    raise exception 'app: That order already has a tracking link.';
  end if;

  begin
    insert into ops.order_trackers (order_number, cin7_sale_id, token_hash, created_by)
    values (v_number, v_sale, v_hash, auth.uid())
    returning id into v_id;
  exception when unique_violation then
    if sqlerrm ilike '%token_hash%' then
      raise exception 'app: That tracking link could not be created.';
    end if;
    raise exception 'app: That order already has a tracking link.';
  end;

  return v_id;
end;
$$;

create or replace function public.order_tracker_revoke(p_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, ops
as $$
declare
  v_count integer;
begin
  perform ops.tracker_require_staff();
  if p_id is null then
    raise exception 'app: That tracking link was not found.';
  end if;
  update ops.order_trackers
  set revoked_at = now()
  where id = p_id
    and revoked_at is null;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    if not exists (select 1 from ops.order_trackers where id = p_id) then
      raise exception 'app: That tracking link was not found.';
    end if;
  end if;
end;
$$;

create or replace function public.order_tracker_regenerate(p_id uuid, p_token_hash text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, ops
as $$
declare
  v_hash text := lower(btrim(coalesce(p_token_hash, '')));
  v_count integer;
begin
  perform ops.tracker_require_staff();
  if p_id is null then
    raise exception 'app: That tracking link was not found.';
  end if;
  if v_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'app: That tracking link could not be created.';
  end if;

  begin
    update ops.order_trackers
    set token_hash = v_hash,
        revoked_at = null,
        expires_on = now() + interval '180 days',
        view_count = 0,
        last_viewed_at = null
    where id = p_id;
  exception when unique_violation then
    raise exception 'app: That tracking link could not be created.';
  end;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'app: That tracking link was not found.';
  end if;
end;
$$;

create or replace function public.order_tracker_add_photo(
  p_tracker_id uuid,
  p_file_id uuid,
  p_caption text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, ops, core
as $$
declare
  v_caption text := nullif(btrim(coalesce(p_caption, '')), '');
  v_id uuid;
  v_sort integer;
begin
  perform ops.tracker_require_staff();
  if p_tracker_id is null or not exists (
    select 1 from ops.order_trackers where id = p_tracker_id and revoked_at is null
  ) then
    raise exception 'app: That tracking link was not found.';
  end if;
  if v_caption is not null and char_length(v_caption) > 200 then
    raise exception 'app: Keep the caption under 200 characters.';
  end if;
  if not exists (
    select 1
    from core.files
    where id = p_file_id
      and bucket = 'qc'
      and entity_schema = 'ops'
      and entity_table = 'order_trackers'
      and entity_id = p_tracker_id
  ) then
    raise exception 'app: That photo is not on this order.';
  end if;

  select coalesce(max(sort_order), 0) + 1 into v_sort
  from ops.order_tracker_photos
  where tracker_id = p_tracker_id;

  insert into ops.order_tracker_photos (tracker_id, file_id, caption, sort_order, visible)
  values (p_tracker_id, p_file_id, v_caption, v_sort, false)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.order_tracker_photo_visible(p_id uuid, p_visible boolean)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, ops
as $$
declare
  v_count integer;
begin
  perform ops.tracker_require_staff();
  if p_id is null or p_visible is null then
    raise exception 'app: That photo was not found.';
  end if;
  update ops.order_tracker_photos
  set visible = p_visible
  where id = p_id;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'app: That photo was not found.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Customer read. Service role only. A bad, expired, or revoked hash returns null.
-- ---------------------------------------------------------------------------

create or replace function public.order_tracker_open(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, ops, core
as $$
declare
  v_hash text := lower(btrim(coalesce(p_token_hash, '')));
  v_row ops.order_trackers%rowtype;
  v_install jsonb;
  v_photos jsonb;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: You cannot open that tracking link.';
  end if;
  if v_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select * into v_row
  from ops.order_trackers
  where token_hash = v_hash
  for update;

  if not found or v_row.revoked_at is not null or v_row.expires_on <= now() then
    return null;
  end if;

  update ops.order_trackers
  set view_count = view_count + 1,
      last_viewed_at = now()
  where id = v_row.id;

  select jsonb_build_object('status', i.status, 'startOn', i.start_on)
    into v_install
  from ops.installs i
  where lower(i.order_number) = lower(v_row.order_number)
    and i.status in ('booked', 'scheduled', 'in_progress', 'completed')
    and i.archived_at is null
  order by case i.status
    when 'in_progress' then 0
    when 'scheduled' then 1
    when 'booked' then 2
    when 'completed' then 3
    else 4
  end, i.start_on desc nulls last
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'caption', p.caption,
    'path', f.storage_path,
    'mime', coalesce(f.mime_type, 'image/jpeg'),
    'sortOrder', p.sort_order
  ) order by p.sort_order, p.created_at), '[]'::jsonb)
    into v_photos
  from ops.order_tracker_photos p
  join core.files f on f.id = p.file_id
  where p.tracker_id = v_row.id
    and p.visible
    and f.bucket = 'qc';

  return jsonb_build_object(
    'orderNumber', v_row.order_number,
    'saleId', v_row.cin7_sale_id,
    'expiresOn', v_row.expires_on,
    'snapshot', ops.tracker_public_snapshot(v_row.snapshot),
    'snapshotAt', v_row.snapshot_at,
    'install', v_install,
    'photos', coalesce(v_photos, '[]'::jsonb)
  );
end;
$$;

create or replace function public.order_tracker_save_snapshot(p_token_hash text, p_snapshot jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, ops
as $$
declare
  v_hash text := lower(btrim(coalesce(p_token_hash, '')));
  v_number text;
  v_count integer;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: You cannot update that order.';
  end if;
  if v_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'app: That tracking link was not found.';
  end if;
  perform ops.tracker_snapshot_ok(p_snapshot);

  select order_number into v_number
  from ops.order_trackers
  where token_hash = v_hash
    and revoked_at is null
    and expires_on > now();

  if v_number is null then
    raise exception 'app: That tracking link was not found.';
  end if;
  if lower(p_snapshot->>'orderNumber') is distinct from lower(v_number) then
    raise exception 'app: That order snapshot is not valid.';
  end if;

  update ops.order_trackers
  set snapshot = ops.tracker_public_snapshot(p_snapshot),
      snapshot_at = now()
  where token_hash = v_hash
    and revoked_at is null
    and expires_on > now();
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'app: That tracking link was not found.';
  end if;
end;
$$;

create or replace function public.order_tracker_media(p_token_hash text, p_photo_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, ops, core
as $$
declare
  v_hash text := lower(btrim(coalesce(p_token_hash, '')));
  v_row jsonb;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: You cannot open that photo.';
  end if;
  if v_hash !~ '^[0-9a-f]{64}$' or p_photo_id is null then
    return null;
  end if;

  select jsonb_build_object(
    'bucket', f.bucket,
    'path', f.storage_path,
    'mime', coalesce(f.mime_type, 'image/jpeg')
  )
    into v_row
  from ops.order_trackers t
  join ops.order_tracker_photos p on p.tracker_id = t.id
  join core.files f on f.id = p.file_id
  where t.token_hash = v_hash
    and t.revoked_at is null
    and t.expires_on > now()
    and p.id = p_photo_id
    and p.visible
    and f.bucket = 'qc';

  return v_row;
end;
$$;

revoke all on function public.order_tracker_list(text) from public, anon, authenticated;
revoke all on function public.order_tracker_create(text, text, text) from public, anon, authenticated;
revoke all on function public.order_tracker_revoke(uuid) from public, anon, authenticated;
revoke all on function public.order_tracker_regenerate(uuid, text) from public, anon, authenticated;
revoke all on function public.order_tracker_add_photo(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.order_tracker_photo_visible(uuid, boolean) from public, anon, authenticated;
revoke all on function public.order_tracker_open(text) from public, anon, authenticated;
revoke all on function public.order_tracker_save_snapshot(text, jsonb) from public, anon, authenticated;
revoke all on function public.order_tracker_media(text, uuid) from public, anon, authenticated;

grant execute on function public.order_tracker_list(text) to authenticated, service_role;
grant execute on function public.order_tracker_create(text, text, text) to authenticated, service_role;
grant execute on function public.order_tracker_revoke(uuid) to authenticated, service_role;
grant execute on function public.order_tracker_regenerate(uuid, text) to authenticated, service_role;
grant execute on function public.order_tracker_add_photo(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.order_tracker_photo_visible(uuid, boolean) to authenticated, service_role;
grant execute on function public.order_tracker_open(text) to service_role;
grant execute on function public.order_tracker_save_snapshot(text, jsonb) to service_role;
grant execute on function public.order_tracker_media(text, uuid) to service_role;

comment on function public.order_tracker_open(text) is
  'Customer read of one tracking link. Returns null when the hash is unknown, expired, or revoked.';
