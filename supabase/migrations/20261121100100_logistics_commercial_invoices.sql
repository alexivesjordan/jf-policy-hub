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
  voided_at timestamptz
);

create table logistics.commercial_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references logistics.commercial_invoices (id) on delete restrict,
  position integer not null,
  order_number text not null,
  cin7_sale_id text not null,
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

create policy "Logistics store commercial invoices"
on storage.objects for insert to authenticated
with check (bucket_id = 'commercial-invoices' and logistics.can_use());

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
  if new.pdf_path is not null and old.pdf_path is null
     and new.number = old.number
     and new.status = old.status
     and new.seller = old.seller
     and new.buyer = old.buyer
     and new.totals_pence = old.totals_pence
  then
    return new;
  end if;
  if new.status = 'void' and old.status = 'issued'
     and new.void_reason is not null
     and public.workspace_is_admin()
  then
    return new;
  end if;
  raise exception 'app: An issued invoice cannot be changed.';
end;
$$;

create trigger commercial_invoices_immutable
before update or delete on logistics.commercial_invoices
for each row execute function logistics.block_invoice_change();

create or replace function public.logistics_issue_commercial_invoice(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = logistics, public
as $$
declare
  v_key uuid;
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
  v_line jsonb;
  v_pos integer := 0;
  v_total integer := 0;
  v_net numeric := 0;
  v_ordered numeric;
  v_shipped numeric;
  v_already numeric;
begin
  if not logistics.can_use() then
    raise exception 'app: You cannot issue a commercial invoice.';
  end if;
  if coalesce(p_payload->>'idempotencyKey', '') !~ '^[0-9a-f-]{36}$' then
    raise exception 'app: That invoice could not be saved.';
  end if;
  v_key := (p_payload->>'idempotencyKey')::uuid;
  select * into v_existing from logistics.commercial_invoices where idempotency_key = v_key;
  if v_existing.id is not null then
    return jsonb_build_object('id', v_existing.id, 'number', v_existing.number, 'replayed', true);
  end if;
  if jsonb_typeof(p_payload->'lines') <> 'array' or jsonb_array_length(p_payload->'lines') < 1 then
    raise exception 'app: No goods selected for shipment.';
  end if;

  for v_line in select value from jsonb_array_elements(p_payload->'lines') loop
    perform pg_advisory_xact_lock(hashtext(coalesce(v_line->>'cin7SaleId', '') || ':' || coalesce(v_line->>'sku', '')));
    v_ordered := (v_line->>'orderedQty')::numeric;
    v_shipped := (v_line->>'shippedQty')::numeric;
    if v_shipped <= 0 or v_shipped > v_ordered then
      raise exception 'app: Shipped quantity is invalid.';
    end if;
    select coalesce(sum(line.shipped_qty), 0) into v_already
    from logistics.commercial_invoice_lines line
    join logistics.commercial_invoices invoice on invoice.id = line.invoice_id
    where invoice.status = 'issued'
      and line.cin7_sale_id = v_line->>'cin7SaleId'
      and line.sku = v_line->>'sku';
    if v_already + v_shipped > v_ordered then
      raise exception 'app: That quantity is already on an issued invoice.';
    end if;
    v_total := v_total + (v_line->>'shippedPence')::integer;
    v_net := v_net + (v_line->>'lineWeightKg')::numeric;
  end loop;

  v_number := logistics.next_invoice_number(v_year);
  insert into logistics.commercial_invoices (
    number, status, seller, buyer, currency, incoterm, totals_pence,
    net_weight_kg, gross_weight_kg, cin7_orders, pdf_filename, issued_by, idempotency_key
  ) values (
    v_number, 'issued', v_seller, p_payload->'buyer',
    p_payload->>'currency', p_payload->>'incoterm', v_total,
    v_net, (p_payload->>'grossWeightKg')::numeric, p_payload->'orders',
    'Commercial Invoice - ' || regexp_replace(coalesce(p_payload#>>'{buyer,name}', 'Buyer'), '[/\\:*?"<>|]', '', 'g') || ' - ' || v_number || ' - ' || regexp_replace(coalesce(p_payload->>'incoterm', ''), '[/\\:*?"<>|]', '', 'g') || '.pdf',
    auth.uid(), v_key
  ) returning id into v_id;

  for v_line in select value from jsonb_array_elements(p_payload->'lines') loop
    v_pos := v_pos + 1;
    insert into logistics.commercial_invoice_lines (
      invoice_id, position, order_number, cin7_sale_id, sku, description,
      ordered_qty, shipped_qty, line_net_pence, shipped_pence, hs_code, origin,
      unit_weight_kg, line_weight_kg
    ) values (
      v_id, v_pos, v_line->>'orderNumber', v_line->>'cin7SaleId', v_line->>'sku', v_line->>'description',
      (v_line->>'orderedQty')::numeric, (v_line->>'shippedQty')::numeric,
      (v_line->>'lineNetPence')::integer, (v_line->>'shippedPence')::integer,
      v_line->>'hsCode', v_line->>'origin',
      (v_line->>'unitWeightKg')::numeric, (v_line->>'lineWeightKg')::numeric
    );
    insert into logistics.product_customs (sku, hs_code, country_of_origin, net_weight_kg, updated_by, updated_at)
    values (v_line->>'sku', v_line->>'hsCode', v_line->>'origin', (v_line->>'unitWeightKg')::numeric, auth.uid(), now())
    on conflict (sku) do update
    set hs_code = excluded.hs_code,
        country_of_origin = excluded.country_of_origin,
        net_weight_kg = excluded.net_weight_kg,
        updated_by = excluded.updated_by,
        updated_at = now();
  end loop;

  insert into logistics.commercial_invoice_events (invoice_id, action, actor_id, detail)
  values (v_id, 'issued', auth.uid(), jsonb_build_object('number', v_number));
  return jsonb_build_object('id', v_id, 'number', v_number, 'replayed', false);
end;
$$;

create or replace function public.logistics_attach_invoice_pdf(p_id uuid, p_path text, p_filename text)
returns void
language plpgsql
security definer
set search_path = logistics, public
as $$
begin
  if not logistics.can_use() then
    raise exception 'app: You cannot issue a commercial invoice.';
  end if;
  update logistics.commercial_invoices
  set pdf_path = p_path, pdf_filename = p_filename
  where id = p_id and pdf_path is null and issued_by = auth.uid();
  if not found then
    raise exception 'app: That invoice could not be saved.';
  end if;
end;
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

revoke all on function public.logistics_issue_commercial_invoice(jsonb) from public, anon;
revoke all on function public.logistics_invoice_file(uuid) from public, anon;
revoke all on function public.logistics_attach_invoice_pdf(uuid, text, text) from public, anon;
revoke all on function public.logistics_void_commercial_invoice(uuid, text) from public, anon;
grant execute on function public.logistics_issue_commercial_invoice(jsonb) to authenticated, service_role;
grant execute on function public.logistics_attach_invoice_pdf(uuid, text, text) to authenticated, service_role;
grant execute on function public.logistics_void_commercial_invoice(uuid, text) to authenticated, service_role;
grant execute on function public.logistics_invoice_file(uuid) to authenticated, service_role;
