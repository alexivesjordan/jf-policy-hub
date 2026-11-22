-- DESTRUCTIVE.
-- Rolling back 20261121100000 and 20261121100100 drops issued commercial
-- invoices, their numbers, and saved product customs rows (HS code, origin,
-- weight). Numbers are not reused after a drop because the counter goes with
-- them. This script refuses while any invoice or customs row exists unless
-- you set the override in the same session:
--   select set_config('logistics.allow_invoice_rollback', 'yes', true);
--
-- Storage rows are removed only after that guard, by allowing the storage
-- delete trigger for this session. Delete uploaded files with the Storage API
-- first. Anything left in the storage backend is not removed by this script.

do $$
declare
  v_rel regclass;
  v_exists boolean;
  v_name text;
begin
  if coalesce(current_setting('logistics.allow_invoice_rollback', true), '') = 'yes' then
    return;
  end if;
  foreach v_name in array array['logistics.commercial_invoices', 'logistics.product_customs', 'logistics.customs_statement_rules'] loop
    v_rel := to_regclass(v_name);
    if v_rel is null then
      continue;
    end if;
    execute format('select exists (select 1 from %s)', v_rel) into v_exists;
    if v_exists then
      raise exception 'Refusing to roll back: commercial invoices or saved customs data exist. Set logistics.allow_invoice_rollback to yes to drop issued invoices, numbers and product customs permanently.';
    end if;
  end loop;
end $$;

select set_config('storage.allow_delete_query', 'true', true);

drop policy if exists "Logistics read commercial invoices" on storage.objects;
drop policy if exists "Logistics store commercial invoices" on storage.objects;
delete from storage.objects where bucket_id = 'commercial-invoices';
delete from storage.buckets where id = 'commercial-invoices';

drop function if exists public.logistics_issued_quantities(text[]);
drop function if exists public.logistics_invoice_file(uuid);
drop function if exists public.logistics_void_commercial_invoice(uuid, text);
drop function if exists public.logistics_attach_invoice_pdf(uuid, text, text, uuid);
drop function if exists public.logistics_attach_invoice_pdf(uuid, text, text);
drop function if exists public.logistics_issue_commercial_invoice(jsonb);
drop function if exists logistics.next_invoice_number(integer);

drop table if exists logistics.commercial_invoice_events;
drop table if exists logistics.commercial_invoice_lines;
drop table if exists logistics.commercial_invoices;
drop table if exists logistics.invoice_counters;
drop function if exists logistics.block_invoice_change();
drop function if exists logistics.block_child_change();

drop function if exists public.logistics_product_customs(text[]);
drop table if exists logistics.customs_statement_rules;
drop table if exists logistics.product_customs;
drop function if exists logistics.can_use();
drop schema if exists logistics;

delete from supabase_migrations.schema_migrations
where version in ('20261121100000', '20261121100100');
