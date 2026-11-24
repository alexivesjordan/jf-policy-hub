-- Read only. Run before 20261124140000_logistics_invoice_revisions.sql.
-- Expect zero rows from the column check, and the issue function present.

select column_name
from information_schema.columns
where table_schema = 'logistics'
  and table_name = 'commercial_invoices'
  and column_name in ('base_number', 'revision', 'is_latest');

select to_regprocedure('public.logistics_issue_commercial_invoice(jsonb)') as issue_invoice,
       to_regprocedure('public.logistics_search_commercial_invoices(text, date, date)') as search_invoices;
