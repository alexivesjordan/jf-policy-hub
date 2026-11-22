-- Run after both logistics migrations. Read only.

select
  c.relname,
  c.relrowsecurity as rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'logistics'
  and c.relname in ('product_customs', 'customs_statement_rules', 'commercial_invoices', 'commercial_invoice_lines', 'commercial_invoice_events', 'invoice_counters')
order by c.relname;

select
  has_table_privilege('anon', 'logistics.product_customs', 'select') as anon_customs,
  has_table_privilege('anon', 'logistics.customs_statement_rules', 'select') as anon_rules,
  has_table_privilege('anon', 'logistics.commercial_invoices', 'select') as anon_invoices,
  has_function_privilege('authenticated', 'public.logistics_issue_commercial_invoice(jsonb)', 'execute') as issue_authenticated,
  has_function_privilege('service_role', 'public.logistics_issue_commercial_invoice(jsonb)', 'execute') as issue_service,
  has_function_privilege('authenticated', 'public.logistics_attach_invoice_pdf(uuid, text, text, uuid)', 'execute') as attach_authenticated,
  has_function_privilege('authenticated', 'public.logistics_product_customs(text[])', 'execute') as customs_fn;

select id, public, file_size_limit
from storage.buckets
where id = 'commercial-invoices';
