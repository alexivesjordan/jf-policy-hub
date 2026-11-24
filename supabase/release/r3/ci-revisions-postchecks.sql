-- Read only. Run after 20261124140000_logistics_invoice_revisions.sql.
-- Expect three columns, a search function, and one latest row per issued family.

select column_name
from information_schema.columns
where table_schema = 'logistics'
  and table_name = 'commercial_invoices'
  and column_name in ('base_number', 'revision', 'is_latest')
order by column_name;

select to_regprocedure('public.logistics_search_commercial_invoices(text, date, date)') as search_invoices,
       to_regprocedure('public.logistics_issue_commercial_invoice(jsonb)') as issue_invoice;

select base_number, count(*) as latest_rows
from logistics.commercial_invoices
where status = 'issued' and is_latest
group by base_number
having count(*) > 1;
