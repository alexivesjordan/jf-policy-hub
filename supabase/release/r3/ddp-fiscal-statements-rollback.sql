-- Deletes only the six DDP fiscal-representation statements seeded by
-- 20261123160000_logistics_ddp_fiscal_statements.sql.
-- Issued invoices, product customs rows, and the earlier inactive seeds stay.

delete from logistics.customs_statement_rules
where id in (
  '4d4f0001-4e57-4a11-8be0-000000000001',
  '4d4f0002-4e57-4a11-8be0-000000000002',
  '4d4f0003-4e57-4a11-8be0-000000000003',
  '4d4f0004-4e57-4a11-8be0-000000000004',
  '4d4f0005-4e57-4a11-8be0-000000000005',
  '4d4f0006-4e57-4a11-8be0-000000000006'
);
