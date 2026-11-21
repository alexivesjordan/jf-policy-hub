-- Run before 20261121100000 and 20261121100100. Read only.

select
  to_regclass('logistics.product_customs') as product_customs,
  to_regclass('logistics.commercial_invoices') as commercial_invoices,
  to_regclass('logistics.commercial_invoice_lines') as commercial_invoice_lines,
  to_regnamespace('logistics') is not null as logistics_schema;

select id, public
from storage.buckets
where id = 'commercial-invoices';
