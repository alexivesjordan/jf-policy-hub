# R3 logistics release

Apply, in order, on TEST only:

1. `supabase/migrations/20261121100000_logistics_product_customs.sql`
2. `supabase/migrations/20261121100100_logistics_commercial_invoices.sql`

The invoice pages and the statement editor call `supabase.schema("logistics")`. On each hosted project, TEST and production, add `logistics` under Supabase → Integrations → Data API → Exposed schemas before those screens are used. Table grants and RLS do not expose the schema. `supabase/config.toml` lists it for the local CLI only and does not change a hosted project. This repository cannot read that dashboard setting.

`01-prechecks.sql` should show both invoice tables as null.
`03-postchecks.sql` should show RLS on, anon select false, issue and attach not executable by `authenticated`, and bucket `commercial-invoices` with `public` false.

`supabase/tests/logistics_ci.sql` raises `RESULTS:` and rolls back.

`rollback.sql` is **DESTRUCTIVE**. It drops issued invoices, their numbers, product customs rows and customs statement rules, then drops the `logistics` schema and removes the two versions from `supabase_migrations.schema_migrations`. It refuses while any invoice, customs row or statement rule exists unless `logistics.allow_invoice_rollback` is `yes`. After the guard it sets `storage.allow_delete_query` so the storage tables can be cleared. Delete uploaded files with the Storage API first; leftovers in the storage backend are not removed here.
