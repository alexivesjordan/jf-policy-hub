-- DESTRUCTIVE.
-- Rolling back 20261121100100 drops issued commercial invoices, their lines,
-- their numbers, and the year counter. Numbers are not reused after a drop
-- because the counter goes with them. This script refuses while any invoice
-- row exists unless you set the override in the same session:
--   select set_config('logistics.allow_invoice_rollback', 'yes', true);

do $$
begin
  if to_regclass('logistics.commercial_invoices') is not null
     and exists (select 1 from logistics.commercial_invoices)
     and coalesce(current_setting('logistics.allow_invoice_rollback', true), '') is distinct from 'yes'
  then
    raise exception 'Refusing to roll back: commercial invoices exist. Set logistics.allow_invoice_rollback to yes to drop issued invoices and numbers permanently.';
  end if;
end $$;

drop policy if exists "Logistics read commercial invoices" on storage.objects;
drop policy if exists "Logistics store commercial invoices" on storage.objects;
delete from storage.objects where bucket_id = 'commercial-invoices';
delete from storage.buckets where id = 'commercial-invoices';

drop function if exists public.logistics_invoice_file(uuid);
drop function if exists public.logistics_void_commercial_invoice(uuid, text);
drop function if exists public.logistics_attach_invoice_pdf(uuid, text, text);
drop function if exists public.logistics_issue_commercial_invoice(jsonb);
drop function if exists logistics.next_invoice_number(integer);
drop function if exists logistics.block_invoice_change();

drop table if exists logistics.commercial_invoice_events;
drop table if exists logistics.commercial_invoice_lines;
drop table if exists logistics.commercial_invoices;
drop table if exists logistics.invoice_counters;

drop function if exists public.logistics_product_customs(text[]);
drop table if exists logistics.product_customs;
drop function if exists logistics.can_use();
