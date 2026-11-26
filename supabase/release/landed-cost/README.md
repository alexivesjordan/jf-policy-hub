# Landed cost release

Apply `supabase/migrations/20261128300000_logistics_landed_cost.sql` on TEST only, after the logistics commercial-invoice migrations. It adds four tables in `logistics` and does not change commercial invoices.

`01-prechecks.sql` should show the four relations as null and `logistics.can_use()` present.
`03-postchecks.sql` should show RLS on, anon select false, authenticated insert on the tariff cache false, and no landed-cost views or functions.

`rollback.sql` is **DESTRUCTIVE**. It deletes saved calculations and stored duty rates, then drops the four tables and the migration version. It refuses while either table has rows unless `logistics.allow_landed_cost_rollback` is `yes`. The tariff cache is dropped with them. Commercial invoices, product customs and the `logistics` schema stay.

HMRC customs exchange rates are the monthly Trade Tariff file for the declaration month (units of foreign currency per £1), not a daily spot rate. A manual rate replaces that file for one calculation.

EU import duty is read from the public TARIC measure page when that page returns a third-country duty. EU VAT is not on that page, so an EU total needs a stored VAT rate and is marked Estimate. Any destination other than the UK is an estimate. UK duty and VAT come from the UK Trade Tariff API.
