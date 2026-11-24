-- Commercial invoice revisions. Does not edit an applied migration.
-- A regeneration inserts a new issued row. The original number is kept and
-- revision 2+ is printed as CI-YYYY-NNNN-R2. Older rows and their PDFs stay.
-- Only the latest revision counts towards shipped quantity.

alter table logistics.commercial_invoices
  add column if not exists base_number text,
  add column if not exists revision integer not null default 1,
  add column if not exists is_latest boolean not null default true;

update logistics.commercial_invoices
set base_number = number
where base_number is null;

alter table logistics.commercial_invoices
  alter column base_number set not null;

alter table logistics.commercial_invoices
  drop constraint if exists commercial_invoices_base_number_check;
alter table logistics.commercial_invoices
  add constraint commercial_invoices_base_number_check
  check (base_number ~ '^CI-[0-9]{4}-[0-9]{4}$');

alter table logistics.commercial_invoices
  drop constraint if exists commercial_invoices_revision_check;
alter table logistics.commercial_invoices
  add constraint commercial_invoices_revision_check
  check (revision >= 1);

create unique index if not exists commercial_invoices_latest_family
  on logistics.commercial_invoices (base_number)
  where is_latest and status = 'issued';

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
     and new.base_number is not distinct from old.base_number
     and new.revision is not distinct from old.revision
     and new.is_latest is not distinct from old.is_latest
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
     and new.base_number is not distinct from old.base_number
     and new.revision is not distinct from old.revision
     and new.is_latest is not distinct from old.is_latest
  then
    return new;
  end if;
  if old.status = 'issued' and new.status = 'issued'
     and old.is_latest and not new.is_latest
     and new.base_number is not distinct from old.base_number
     and new.revision is not distinct from old.revision
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
     and new.void_reason is not distinct from old.void_reason
     and new.voided_by is not distinct from old.voided_by
     and new.voided_at is not distinct from old.voided_at
     and new.document = old.document
     and new.shipment = old.shipment
  then
    return new;
  end if;
  raise exception 'app: An issued invoice cannot be changed.';
end;
$$;

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
  v_families text[];
  v_family text;
  v_revision integer := 1;
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
  v_families := null;
  v_family := null;
  v_revision := 1;
  select array_agg(distinct invoice.base_number) into v_families
  from logistics.commercial_invoices invoice
  where invoice.status = 'issued'
    and invoice.is_latest
    and exists (
      select 1
      from jsonb_array_elements(invoice.cin7_orders) existing_order
      join jsonb_array_elements(coalesce(p_payload->'orders', '[]'::jsonb)) requested_order
        on requested_order->>'number' = existing_order->>'number'
       and coalesce(requested_order->>'number', '') <> ''
    );
  if v_families is not null then
    perform pg_advisory_xact_lock(hashtext('ci-family:' || family))
    from unnest(v_families) as family;
    select array_agg(distinct invoice.base_number) into v_families
    from logistics.commercial_invoices invoice
    where invoice.status = 'issued'
      and invoice.is_latest
      and exists (
        select 1
        from jsonb_array_elements(invoice.cin7_orders) existing_order
        join jsonb_array_elements(coalesce(p_payload->'orders', '[]'::jsonb)) requested_order
          on requested_order->>'number' = existing_order->>'number'
         and coalesce(requested_order->>'number', '') <> ''
      );
  end if;
  if v_families is not null then
    select invoice.base_number,
           coalesce((
             select max(later.revision)
             from logistics.commercial_invoices later
             where later.base_number = invoice.base_number
           ), 0) + 1
      into v_family, v_revision
    from logistics.commercial_invoices invoice
    where invoice.revision = 1
      and invoice.base_number = any (v_families)
    order by invoice.issued_at asc
    limit 1;
    if v_family is null then
      v_family := v_families[1];
      select coalesce(max(revision), 0) + 1 into v_revision
      from logistics.commercial_invoices
      where base_number = v_family;
    end if;
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
        and invoice.is_latest
        and (v_families is null or invoice.base_number <> all (v_families))
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
      and invoice.is_latest
      and (v_families is null or invoice.base_number <> all (v_families))
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
      and invoice.is_latest
      and (v_families is null or invoice.base_number <> all (v_families))
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
  if v_family is null then
    v_number := logistics.next_invoice_number(v_year);
    v_family := v_number;
    v_revision := 1;
  else
    if v_revision < 2 then
      raise exception 'app: That invoice could not be saved.';
    end if;
    update logistics.commercial_invoices
    set is_latest = false
    where status = 'issued'
      and is_latest
      and base_number = any (v_families);
    v_number := v_family || '-R' || v_revision::text;
  end if;
  v_invoice_total := v_total + v_delivery + v_surcharge + v_vat;
  v_filename := 'Commercial Invoice - ' || regexp_replace(coalesce(p_payload#>>'{buyer,name}', 'Buyer'), '[/\\:*?"<>|]', '', 'g') || ' - ' || v_number || ' - ' || regexp_replace(coalesce(p_payload->>'incoterm', ''), '[/\\:*?"<>|]', '', 'g') || '.pdf';
  v_document := coalesce(p_payload->'document', '{}'::jsonb)
    || jsonb_build_object('reference', v_number, 'lines', v_doc_lines, 'totalPence', v_invoice_total);
  insert into logistics.commercial_invoices (
    number, status, seller, buyer, currency, incoterm, totals_pence, total_pence,
    net_weight_kg, gross_weight_kg, cin7_orders, pdf_filename, issued_by, idempotency_key, document, shipment,
    base_number, revision, is_latest
  ) values (
    v_number, 'issued', v_seller, p_payload->'buyer',
    p_payload->>'currency', p_payload->>'incoterm', v_total, v_invoice_total,
    v_net, v_gross, p_payload->'orders',
    v_filename, v_actor, v_key, v_document,
    coalesce(p_payload->'shipment', p_payload->'document'->'shipment', '{}'::jsonb),
    v_family, v_revision, true
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
  values (v_id, 'issued', v_actor, jsonb_build_object('number', v_number, 'baseNumber', v_family, 'revision', v_revision));
  return jsonb_build_object(
    'id', v_id, 'number', v_number, 'replayed', false,
    'document', v_document, 'pdfPath', null, 'pdfFilename', v_filename, 'issuedBy', v_actor
  );
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
      and invoice.is_latest
      and line.cin7_sale_id = any (p_sales)
    group by line.cin7_sale_id, line.sku, line.line_key
  ) saved;
$$;


create or replace function public.logistics_search_commercial_invoices(p_query text, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = logistics, public
as $$
declare
  v_q text := trim(coalesce(p_query, ''));
  v_like text;
begin
  if not logistics.can_use() then
    raise exception 'app: You cannot open that invoice.';
  end if;
  v_like := replace(replace(replace(v_q, '!', '!!'), '%', '!%'), '_', '!_');
  return coalesce((
    select jsonb_agg(found.payload order by found.issued_at desc)
    from (
      select invoice.issued_at, jsonb_build_object(
        'id', invoice.id,
        'number', invoice.number,
        'revision', invoice.revision,
        'issuedAt', invoice.issued_at,
        'customer', coalesce(invoice.buyer->>'name', ''),
        'destination', coalesce(invoice.document->>'destinationCountry', ''),
        'issuedBy', coalesce(profile.full_name, ''),
        'orders', coalesce((
          select jsonb_agg(item->>'number')
          from jsonb_array_elements(invoice.cin7_orders) item
        ), '[]'::jsonb)
      ) as payload
      from logistics.commercial_invoices invoice
      left join public.profiles profile on profile.id = invoice.issued_by
      where invoice.status = 'issued'
        and invoice.is_latest
        and (
          v_q = ''
          or invoice.number ilike '%' || v_like || '%' escape '!'
          or invoice.base_number ilike '%' || v_like || '%' escape '!'
          or coalesce(invoice.buyer->>'name', '') ilike '%' || v_like || '%' escape '!'
          or exists (
            select 1
            from jsonb_array_elements(invoice.cin7_orders) item
            where item->>'number' ilike '%' || v_like || '%' escape '!'
          )
        )
        and (p_from is null or (invoice.issued_at at time zone 'Europe/London')::date >= p_from)
        and (p_to is null or (invoice.issued_at at time zone 'Europe/London')::date <= p_to)
      order by invoice.issued_at desc
      limit 100
    ) found
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.logistics_search_commercial_invoices(text, date, date) from public, anon;
grant execute on function public.logistics_search_commercial_invoices(text, date, date) to authenticated, service_role;
