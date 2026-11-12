-- Cin7 Load Quote refreshes the saved read and records when the order was fetched.
-- 20261111100000 may already be applied. Do not edit it.

alter table ops.quote_ingest_cache
  add column if not exists fetched_at timestamptz;

alter table ops.service_quotes
  add column if not exists source_fetched_at timestamptz;

comment on column ops.quote_ingest_cache.fetched_at is
  'When this Cin7 order was last fetched. Null for a PDF read. The payload is only a fallback.';

comment on column ops.service_quotes.source_fetched_at is
  'When the Cin7 order behind this price was fetched. Later reads can compare it if the order changes.';

create or replace function public.service_put_ingest(
  p_source text,
  p_key text,
  p_quote_number text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_id uuid;
begin
  if not (public.workspace_can('sales', 'view') or public.workspace_can('operations', 'view')) then
    raise exception 'app: You cannot read a quote.';
  end if;
  insert into ops.quote_ingest_cache (source, cache_key, quote_number, payload, created_by, fetched_at)
  values (
    p_source,
    p_key,
    p_quote_number,
    p_payload,
    auth.uid(),
    nullif(p_payload->>'fetchedAt', '')::timestamptz
  )
  on conflict (cache_key) do update
    set quote_number = excluded.quote_number,
        payload = excluded.payload,
        fetched_at = excluded.fetched_at
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.service_save_quote(
  p_ingest_id uuid,
  p_rate_version_id uuid,
  p_quote_number text,
  p_customer_name text,
  p_prices jsonb,
  p_audit jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_id uuid;
begin
  if not (public.workspace_can('sales', 'edit') or public.workspace_can('operations', 'edit')) then
    raise exception 'app: You cannot save a service quote.';
  end if;
  insert into ops.service_quotes (
    ingest_id, rate_version_id, quote_number, customer_name, prices, audit, created_by, source_fetched_at
  )
  values (
    p_ingest_id,
    p_rate_version_id,
    p_quote_number,
    p_customer_name,
    p_prices,
    p_audit,
    auth.uid(),
    nullif(p_prices->>'fetchedAt', '')::timestamptz
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.service_read_quote(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, public
as $$
declare
  v_row ops.service_quotes%rowtype;
begin
  select * into v_row from ops.service_quotes where id = p_id;
  if v_row.id is null then
    return null;
  end if;
  if v_row.created_by is distinct from auth.uid()
     and not public.workspace_is_admin()
     and not public.workspace_can('operations', 'edit') then
    raise exception 'app: That quote was not found.';
  end if;
  return jsonb_build_object(
    'id', v_row.id,
    'quote_number', v_row.quote_number,
    'customer_name', v_row.customer_name,
    'prices', v_row.prices,
    'source_fetched_at', v_row.source_fetched_at,
    'proposal_path', v_row.proposal_path,
    'audit', case when public.service_can_see_flags() then v_row.audit else null end
  );
end;
$$;
