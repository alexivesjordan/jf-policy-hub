-- Issued commercial invoices. Previews are not stored.
-- New file only.

create table logistics.invoice_counters (
  year integer primary key,
  last_number integer not null
);

create table logistics.commercial_invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  status text not null default 'issued' check (status in ('issued', 'void')),
  seller jsonb not null,
  buyer jsonb not null,
  currency text not null,
  incoterm text not null,
  totals_pence integer not null,
  total_pence integer not null,
  net_weight_kg numeric(12,3) not null,
  gross_weight_kg numeric(12,3) not null,
  cin7_orders jsonb not null,
  pdf_path text,
  pdf_filename text,
  issued_by uuid references public.profiles (id) on delete restrict,
  issued_at timestamptz not null default now(),
  idempotency_key uuid not null unique,
  void_reason text,
  voided_by uuid,
  voided_at timestamptz,
  document jsonb not null,
  shipment jsonb not null default '{}'::jsonb
);

create table logistics.commercial_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references logistics.commercial_invoices (id) on delete restrict,
  position integer not null,
  order_number text not null,
  cin7_sale_id text not null,
  line_key text not null,
  sku text not null,
  description text not null,
  ordered_qty numeric(12,3) not null,
  shipped_qty numeric(12,3) not null,
  line_net_pence integer not null,
  shipped_pence integer not null,
  hs_code text not null,
  origin text not null,
  unit_weight_kg numeric(12,3) not null,
  line_weight_kg numeric(12,3) not null,
  unique (invoice_id, position)
);

create table logistics.commercial_invoice_events (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references logistics.commercial_invoices (id) on delete restrict,
  action text not null,
  actor_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table logistics.invoice_counters enable row level security;
alter table logistics.commercial_invoices enable row level security;
alter table logistics.commercial_invoice_lines enable row level security;
alter table logistics.commercial_invoice_events enable row level security;

revoke all on logistics.invoice_counters, logistics.commercial_invoices,
  logistics.commercial_invoice_lines, logistics.commercial_invoice_events
  from public, anon;
grant select on logistics.commercial_invoices, logistics.commercial_invoice_lines,
  logistics.commercial_invoice_events to authenticated;
grant all on logistics.invoice_counters, logistics.commercial_invoices,
  logistics.commercial_invoice_lines, logistics.commercial_invoice_events to service_role;

create policy commercial_invoices_read on logistics.commercial_invoices
for select to authenticated using (logistics.can_use());
create policy commercial_invoice_lines_read on logistics.commercial_invoice_lines
for select to authenticated using (logistics.can_use());
create policy commercial_invoice_events_read on logistics.commercial_invoice_events
for select to authenticated using (logistics.can_use());

insert into storage.buckets (id, name, public, file_size_limit)
values ('commercial-invoices', 'commercial-invoices', false, 20971520)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;

create policy "Logistics read commercial invoices"
on storage.objects for select to authenticated
using (bucket_id = 'commercial-invoices' and logistics.can_use());

create or replace function logistics.next_invoice_number(p_year integer)
returns text
language plpgsql
security definer
set search_path = logistics, public
as $$
declare
  v_next integer;
begin
  insert into logistics.invoice_counters (year, last_number)
  values (p_year, 0)
  on conflict (year) do nothing;
  select last_number into v_next
  from logistics.invoice_counters
  where year = p_year
  for update;
  v_next := v_next + 1;
  update logistics.invoice_counters set last_number = v_next where year = p_year;
  return 'CI-' || p_year::text || '-' || lpad(v_next::text, 4, '0');
end;
$$;

revoke all on function logistics.next_invoice_number(integer) from public, anon, authenticated;

create or replace function logistics.block_invoice_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'app: An issued invoice cannot be deleted.';
  end if;
  if old.status = 'void' then
    raise exception 'app: A void invoice cannot be changed.';
  end if;
  if old.status = 'issued' and new.status = 'issued'
     and old.pdf_path is null and new.pdf_path is not null
     and new.id = old.id
     and new.number = old.number
     and new.seller = old.seller
     and new.buyer = old.buyer
     and new.currency = old.currency
     and new.incoterm = old.incoterm
     and new.totals_pence = old.totals_pence
     and new.total_pence = old.total_pence
     and new.net_weight_kg = old.net_weight_kg
     and new.gross_weight_kg = old.gross_weight_kg
     and new.cin7_orders = old.cin7_orders
     and new.issued_by is not distinct from old.issued_by
     and new.issued_at = old.issued_at
     and new.idempotency_key = old.idempotency_key
     and new.void_reason is not distinct from old.void_reason
     and new.voided_by is not distinct from old.voided_by
     and new.voided_at is not distinct from old.voided_at
     and new.document = old.document
     and new.shipment = old.shipment
  then
    return new;
  end if;
  if old.status = 'issued' and new.status = 'void'
     and new.void_reason is not null
     and public.workspace_is_admin()
     and new.id = old.id
     and new.number = old.number
     and new.seller = old.seller
     and new.buyer = old.buyer
     and new.currency = old.currency
     and new.incoterm = old.incoterm
     and new.totals_pence = old.totals_pence
     and new.total_pence = old.total_pence
     and new.net_weight_kg = old.net_weight_kg
     and new.gross_weight_kg = old.gross_weight_kg
     and new.cin7_orders = old.cin7_orders
     and new.pdf_path is not distinct from old.pdf_path
     and new.pdf_filename is not distinct from old.pdf_filename
     and new.issued_by is not distinct from old.issued_by
     and new.issued_at = old.issued_at
     and new.idempotency_key = old.idempotency_key
     and new.document = old.document
     and new.shipment = old.shipment
  then
    return new;
  end if;
  raise exception 'app: An issued invoice cannot be changed.';
end;
$$;

create trigger commercial_invoices_immutable
before update or delete on logistics.commercial_invoices
for each row execute function logistics.block_invoice_change();

create or replace function logistics.block_child_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'app: An issued invoice cannot be changed.';
end;
$$;

create trigger commercial_invoice_lines_immutable
before update or delete on logistics.commercial_invoice_lines
for each row execute function logistics.block_child_change();

create trigger commercial_invoice_events_immutable
before update or delete on logistics.commercial_invoice_events
for each row execute function logistics.block_child_change();

create or replace function public.logistics_issue_commercial_invoice(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = logistics, public
as $$
declare
  v_key uuid;
  v_actor uuid;
  v_existing logistics.commercial_invoices%rowtype;
  v_id uuid;
  v_number text;
  v_year integer := extract(year from timezone('Europe/London', now()))::integer;
  v_seller jsonb := jsonb_build_object(
    'name', 'Jordan Fitness Ltd',
    'address', '56 Oldmedow Road, Hardwick Industrial Estate, King''s Lynn, PE30 4JJ',
    'vat', 'GB385438070',
    'eoriGb', 'GB385438070001',
    'eoriFr', 'FRGB1215443160001',
    'companyNumber', '12798165'
  );
  v_group record;
  v_keyed record;
  v_line jsonb;
  v_pos integer := 0;
  v_total integer := 0;
  v_invoice_total integer := 0;
  v_delivery integer;
  v_surcharge integer;
  v_vat integer;
  v_gross numeric;
  v_pallet jsonb;
  v_pallet_kg numeric := 0;
  v_pallet_count integer := 0;
  v_w numeric;
  v_net numeric := 0;
  v_ordered numeric;
  v_shipped numeric;
  v_already numeric;
  v_seen numeric;
  v_base integer;
  v_extra integer;
  v_pence integer;
  v_i integer;
  v_doc_lines jsonb := '[]'::jsonb;
  v_document jsonb;
  v_filename text;
begin
  if coalesce(p_payload->>'issuedBy', '') !~ '^[0-9a-f-]{36}$' then
    raise exception 'app: That invoice could not be saved.';
  end if;
  v_actor := (p_payload->>'issuedBy')::uuid;
  if coalesce(p_payload->>'idempotencyKey', '') !~ '^[0-9a-f-]{36}$' then
    raise exception 'app: That invoice could not be saved.';
  end if;
  v_key := (p_payload->>'idempotencyKey')::uuid;
  select * into v_existing from logistics.commercial_invoices where idempotency_key = v_key;
  if v_existing.id is not null then
    if v_existing.issued_by is distinct from v_actor
       and not exists (
         select 1 from public.profiles p
         where p.id = v_actor
           and p.is_active
           and p.access_granted
           and (p.role = 'admin' or p.workspace_role in ('owner', 'admin'))
       )
    then
      raise exception 'app: You cannot open that invoice.';
    end if;
    return jsonb_build_object(
      'id', v_existing.id,
      'number', v_existing.number,
      'replayed', true,
      'document', v_existing.document,
      'pdfPath', v_existing.pdf_path,
      'pdfFilename', v_existing.pdf_filename,
      'issuedBy', v_existing.issued_by
    );
  end if;
  if jsonb_typeof(p_payload->'lines') <> 'array' or jsonb_array_length(p_payload->'lines') < 1 then
    raise exception 'app: No goods selected for shipment.';
  end if;

  for v_keyed in
    select
      line->>'cin7SaleId' as sale,
      line->>'sku' as sku,
      line->>'id' as line_key,
      count(*) as copies,
      min((line->>'orderedQty')::numeric) as ordered_min,
      max((line->>'orderedQty')::numeric) as ordered_max,
      sum((line->>'shippedQty')::numeric) as shipped
    from jsonb_array_elements(p_payload->'lines') as line
    group by 1, 2, 3
  loop
    if coalesce(v_keyed.line_key, '') = ''
       or v_keyed.copies > 1
       or v_keyed.ordered_min is distinct from v_keyed.ordered_max
       or v_keyed.ordered_max <= 0
       or v_keyed.shipped < 0
       or v_keyed.shipped > v_keyed.ordered_max
    then
      raise exception 'app: Shipped quantity is invalid.';
    end if;
    if v_keyed.shipped > 0 then
      perform pg_advisory_xact_lock(hashtext(coalesce(v_keyed.sale, '') || ':' || coalesce(v_keyed.sku, '')));
      select coalesce(sum(saved.shipped_qty), 0) into v_already
      from logistics.commercial_invoice_lines saved
      join logistics.commercial_invoices invoice on invoice.id = saved.invoice_id
      where invoice.status = 'issued'
        and saved.line_key = v_keyed.line_key;
      if v_already + v_keyed.shipped > v_keyed.ordered_max then
        raise exception 'app: That quantity is already on an issued invoice.';
      end if;
    end if;
  end loop;

  for v_group in
    select sale, sku, sum(ordered_max) as ordered, sum(shipped) as shipped
    from (
      select
        line->>'cin7SaleId' as sale,
        line->>'sku' as sku,
        line->>'id' as line_key,
        max((line->>'orderedQty')::numeric) as ordered_max,
        sum((line->>'shippedQty')::numeric) as shipped
      from jsonb_array_elements(p_payload->'lines') as line
      group by 1, 2, 3
    ) keyed
    group by sale, sku
  loop
    if v_group.shipped <= 0 then
      continue;
    end if;
    perform pg_advisory_xact_lock(hashtext(coalesce(v_group.sale, '') || ':' || coalesce(v_group.sku, '')));
    select coalesce(sum(saved.shipped_qty), 0) into v_already
    from logistics.commercial_invoice_lines saved
    join logistics.commercial_invoices invoice on invoice.id = saved.invoice_id
    where invoice.status = 'issued'
      and saved.cin7_sale_id = v_group.sale
      and saved.sku = v_group.sku;
    if v_already + v_group.shipped > v_group.ordered then
      raise exception 'app: That quantity is already on an issued invoice.';
    end if;
  end loop;

  for v_line in select value from jsonb_array_elements(p_payload->'lines') loop
    v_ordered := (v_line->>'orderedQty')::numeric;
    v_shipped := (v_line->>'shippedQty')::numeric;
    if v_shipped <= 0 then
      v_pos := v_pos + 1;
      continue;
    end if;
    select coalesce(sum(saved.shipped_qty), 0) into v_already
    from logistics.commercial_invoice_lines saved
    join logistics.commercial_invoices invoice on invoice.id = saved.invoice_id
    where invoice.status = 'issued'
      and saved.line_key = v_line->>'id';
    select coalesce(sum((item.value->>'shippedQty')::numeric), 0) into v_seen
    from jsonb_array_elements(p_payload->'lines') with ordinality as item(value, ord)
    where item.ord <= v_pos
      and item.value->>'id' = v_line->>'id';
    v_already := v_already + v_seen;
    v_pence := 0;
    if v_ordered = trunc(v_ordered) and v_shipped = trunc(v_shipped) and v_already = trunc(v_already) then
      v_base := (v_line->>'lineNetPence')::integer / v_ordered::integer;
      v_extra := (v_line->>'lineNetPence')::integer - v_base * v_ordered::integer;
      for v_i in v_already::integer .. (v_already + v_shipped)::integer - 1 loop
        v_pence := v_pence + v_base + case when v_i < v_extra then 1 else 0 end;
      end loop;
    elsif v_already + v_shipped = v_ordered then
      v_pence := (v_line->>'lineNetPence')::integer - round((v_line->>'lineNetPence')::numeric * v_already / v_ordered)::integer;
    else
      v_pence := round((v_line->>'lineNetPence')::numeric * v_shipped / v_ordered)::integer;
    end if;
    v_total := v_total + v_pence;
    v_net := v_net + (v_line->>'lineWeightKg')::numeric;
    v_pos := v_pos + 1;
    v_line := v_line || jsonb_build_object('shippedPence', v_pence, 'position', v_pos);
    v_doc_lines := v_doc_lines || jsonb_build_array(jsonb_build_object(
      'id', coalesce(v_line->>'id', v_pos::text),
      'orderNumber', v_line->>'orderNumber',
      'sku', v_line->>'sku',
      'productName', v_line->>'description',
      'orderedQuantity', v_ordered,
      'shippedQuantity', v_shipped,
      'unitNetValue', coalesce((v_line->>'unitNetValue')::numeric, 0),
      'lineNetPence', (v_line->>'lineNetPence')::integer,
      'shippedPence', v_pence,
      'hsCode', v_line->>'hsCode',
      'originCountry', v_line->>'origin',
      'unitWeightKg', (v_line->>'unitWeightKg')::numeric,
      'cin7SaleId', v_line->>'cin7SaleId',
      'lineWeightKg', (v_line->>'lineWeightKg')::numeric
    ));
  end loop;

  if jsonb_array_length(v_doc_lines) < 1 then
    raise exception 'app: No goods selected for shipment.';
  end if;

  v_delivery := coalesce((p_payload#>>'{shipment,deliveryPence}')::integer, 0);
  v_surcharge := coalesce((p_payload#>>'{shipment,surchargePence}')::integer, 0);
  v_vat := coalesce((p_payload#>>'{shipment,vatPence}')::integer, 0);
  v_gross := (p_payload->>'grossWeightKg')::numeric;
  if v_delivery < 0 or v_surcharge < 0 or v_vat < 0 or v_gross is null or v_gross < 0 then
    raise exception 'app: Shipment charges or weight are invalid.';
  end if;
  if jsonb_typeof(p_payload->'shipment'->'palletLines') = 'array' then
    v_pallet_count := jsonb_array_length(p_payload->'shipment'->'palletLines');
  end if;
  if v_pallet_count < 1 or v_pallet_count > 30 then
    raise exception 'app: Shipment charges or weight are invalid.';
  end if;
  for v_pallet in select value from jsonb_array_elements(p_payload->'shipment'->'palletLines') loop
    if (v_pallet->>'lengthCm')::numeric is null
       or (v_pallet->>'lengthCm')::numeric < 1 or (v_pallet->>'lengthCm')::numeric > 1000
       or (v_pallet->>'lengthCm')::numeric <> trunc((v_pallet->>'lengthCm')::numeric)
       or (v_pallet->>'widthCm')::numeric is null
       or (v_pallet->>'widthCm')::numeric < 1 or (v_pallet->>'widthCm')::numeric > 1000
       or (v_pallet->>'widthCm')::numeric <> trunc((v_pallet->>'widthCm')::numeric)
       or (v_pallet->>'depthCm')::numeric is null
       or (v_pallet->>'depthCm')::numeric < 1 or (v_pallet->>'depthCm')::numeric > 1000
       or (v_pallet->>'depthCm')::numeric <> trunc((v_pallet->>'depthCm')::numeric)
    then
      raise exception 'app: Shipment charges or weight are invalid.';
    end if;
    v_w := (v_pallet->>'weightKg')::numeric;
    if v_w is null or v_w <= 0 or v_w > 2000 or v_w * 10 <> trunc(v_w * 10) then
      raise exception 'app: Shipment charges or weight are invalid.';
    end if;
    v_pallet_kg := v_pallet_kg + v_w;
  end loop;
  if v_pallet_kg > 100000 or abs(v_gross - v_pallet_kg) > 0.05 then
    raise exception 'app: Shipment charges or weight are invalid.';
  end if;
  v_gross := v_pallet_kg;
  v_number := logistics.next_invoice_number(v_year);
  v_invoice_total := v_total + v_delivery + v_surcharge + v_vat;
  v_filename := 'Commercial Invoice - ' || regexp_replace(coalesce(p_payload#>>'{buyer,name}', 'Buyer'), '[/\\:*?"<>|]', '', 'g') || ' - ' || v_number || ' - ' || regexp_replace(coalesce(p_payload->>'incoterm', ''), '[/\\:*?"<>|]', '', 'g') || '.pdf';
  v_document := coalesce(p_payload->'document', '{}'::jsonb)
    || jsonb_build_object('reference', v_number, 'lines', v_doc_lines, 'totalPence', v_invoice_total);
  insert into logistics.commercial_invoices (
    number, status, seller, buyer, currency, incoterm, totals_pence, total_pence,
    net_weight_kg, gross_weight_kg, cin7_orders, pdf_filename, issued_by, idempotency_key, document, shipment
  ) values (
    v_number, 'issued', v_seller, p_payload->'buyer',
    p_payload->>'currency', p_payload->>'incoterm', v_total, v_invoice_total,
    v_net, v_gross, p_payload->'orders',
    v_filename, v_actor, v_key, v_document,
    coalesce(p_payload->'shipment', p_payload->'document'->'shipment', '{}'::jsonb)
  ) returning id into v_id;

  v_pos := 0;
  for v_line in select value from jsonb_array_elements(v_doc_lines) loop
    v_pos := v_pos + 1;
    insert into logistics.commercial_invoice_lines (
      invoice_id, position, order_number, cin7_sale_id, line_key, sku, description,
      ordered_qty, shipped_qty, line_net_pence, shipped_pence, hs_code, origin,
      unit_weight_kg, line_weight_kg
    ) values (
      v_id, v_pos, v_line->>'orderNumber', v_line->>'cin7SaleId', v_line->>'id',
      v_line->>'sku', v_line->>'productName',
      (v_line->>'orderedQuantity')::numeric, (v_line->>'shippedQuantity')::numeric,
      (v_line->>'lineNetPence')::integer, (v_line->>'shippedPence')::integer,
      v_line->>'hsCode', v_line->>'originCountry',
      (v_line->>'unitWeightKg')::numeric, (v_line->>'lineWeightKg')::numeric
    );
    insert into logistics.product_customs (sku, hs_code, country_of_origin, net_weight_kg, updated_by, updated_at)
    values (v_line->>'sku', v_line->>'hsCode', v_line->>'originCountry', (v_line->>'unitWeightKg')::numeric, v_actor, now())
    on conflict (sku) do update
    set hs_code = excluded.hs_code,
        country_of_origin = excluded.country_of_origin,
        net_weight_kg = excluded.net_weight_kg,
        updated_by = excluded.updated_by,
        updated_at = now();
  end loop;

  insert into logistics.commercial_invoice_events (invoice_id, action, actor_id, detail)
  values (v_id, 'issued', v_actor, jsonb_build_object('number', v_number));
  return jsonb_build_object(
    'id', v_id, 'number', v_number, 'replayed', false,
    'document', v_document, 'pdfPath', null, 'pdfFilename', v_filename, 'issuedBy', v_actor
  );
end;
$$;

create or replace function public.logistics_attach_invoice_pdf(p_id uuid, p_path text, p_filename text, p_issued_by uuid)
returns void
language plpgsql
security definer
set search_path = logistics, public
as $$
begin
  update logistics.commercial_invoices
  set pdf_path = p_path, pdf_filename = p_filename
  where id = p_id and pdf_path is null and issued_by = p_issued_by and status = 'issued';
  if not found then
    raise exception 'app: That invoice could not be saved.';
  end if;
end;
$$;

create or replace function public.logistics_issued_quantities(p_sales text[])
returns jsonb
language sql
stable
security definer
set search_path = logistics, public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'cin7SaleId', saved.cin7_sale_id,
    'sku', saved.sku,
    'lineKey', saved.line_key,
    'qty', saved.qty,
    'pence', saved.pence
  )), '[]'::jsonb)
  from (
    select line.cin7_sale_id, line.sku, line.line_key, sum(line.shipped_qty) as qty, sum(line.shipped_pence) as pence
    from logistics.commercial_invoice_lines line
    join logistics.commercial_invoices invoice on invoice.id = line.invoice_id
    where logistics.can_use()
      and invoice.status = 'issued'
      and line.cin7_sale_id = any (p_sales)
    group by line.cin7_sale_id, line.sku, line.line_key
  ) saved;
$$;

create or replace function public.logistics_void_commercial_invoice(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = logistics, public
as $$
begin
  if ops.is_field_engineer() or not public.workspace_is_admin() then
    raise exception 'app: You cannot void that invoice.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'app: Add a reason.';
  end if;
  update logistics.commercial_invoices
  set status = 'void', void_reason = btrim(p_reason), voided_by = auth.uid(), voided_at = now()
  where id = p_id and status = 'issued';
  if not found then
    raise exception 'app: That invoice could not be voided.';
  end if;
  insert into logistics.commercial_invoice_events (invoice_id, action, actor_id, detail)
  values (p_id, 'void', auth.uid(), jsonb_build_object('reason', btrim(p_reason)));
end;
$$;

create or replace function public.logistics_invoice_file(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = logistics, public
as $$
declare
  v_row logistics.commercial_invoices%rowtype;
begin
  if not logistics.can_use() then
    raise exception 'app: You cannot issue a commercial invoice.';
  end if;
  select * into v_row from logistics.commercial_invoices where id = p_id;
  if v_row.id is null or v_row.pdf_path is null then
    return null;
  end if;
  return jsonb_build_object('path', v_row.pdf_path, 'filename', v_row.pdf_filename);
end;
$$;

revoke all on function public.logistics_issue_commercial_invoice(jsonb) from public, anon, authenticated;
revoke all on function public.logistics_invoice_file(uuid) from public, anon;
revoke all on function public.logistics_attach_invoice_pdf(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.logistics_void_commercial_invoice(uuid, text) from public, anon;
revoke all on function public.logistics_issued_quantities(text[]) from public, anon;
grant execute on function public.logistics_issue_commercial_invoice(jsonb) to service_role;
grant execute on function public.logistics_attach_invoice_pdf(uuid, text, text, uuid) to service_role;
grant execute on function public.logistics_void_commercial_invoice(uuid, text) to authenticated, service_role;
grant execute on function public.logistics_invoice_file(uuid) to authenticated, service_role;
grant execute on function public.logistics_issued_quantities(text[]) to authenticated, service_role;

create table logistics.customs_statement_rules (
  id uuid primary key default gen_random_uuid(),
  incoterm text,
  destination_country text,
  carrier text,
  statement_text text not null,
  extra_line text,
  priority integer not null default 0,
  active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (incoterm is null or incoterm ~ '^[A-Z0-9]{2,12}$'),
  check (destination_country is null or destination_country ~ '^[A-Z]{2}$' or destination_country = 'EU'),
  check (char_length(statement_text) between 1 and 2000),
  check (extra_line is null or char_length(extra_line) between 1 and 200)
);

alter table logistics.customs_statement_rules enable row level security;
revoke all on logistics.customs_statement_rules from public, anon;
grant select, insert, update on logistics.customs_statement_rules to authenticated;
grant all on logistics.customs_statement_rules to service_role;

create policy customs_statement_rules_logistics
on logistics.customs_statement_rules
for all
to authenticated
using (logistics.can_use())
with check (logistics.can_use());

-- DDP to any EU country uses the VAT-postponed wording. Regime 42 needs French
-- clearance and a different EU destination, which these columns cannot express,
-- so that preset is seeded inactive until the full rule list arrives.
insert into logistics.customs_statement_rules
  (incoterm, destination_country, carrier, statement_text, extra_line, priority, active)
values
  (
    'DDP', 'EU', null,
    'Goods cleared regime 40 00 DDP VAT postponed by Frictionless Trade Services SAS, 70 Rue Mollien 62100 Calais, France',
    'DDP – VAT Postponed',
    10, true
  ),
  (
    null, 'EU', null,
    'Regime 42 Statement: ''Goods transported under Regime 42-00, intra-community supply, Article 138 EU VAT Directive''',
    null,
    0, false
  );
