# R3 logistics release

Apply, in order, on TEST only:

1. `supabase/migrations/20261121100000_logistics_product_customs.sql`
2. `supabase/migrations/20261121100100_logistics_commercial_invoices.sql`

`01-prechecks.sql` should show both invoice tables as null.
`03-postchecks.sql` should show RLS on, anon privileges false, and bucket `commercial-invoices` with `public` false.

`supabase/tests/logistics_ci.sql` raises `RESULTS:` and rolls back. It does not need a separate database.

`rollback.sql` drops the invoice tables and the year counter. It refuses while any invoice row exists unless `logistics.allow_invoice_rollback` is `yes`. That drop is permanent.
