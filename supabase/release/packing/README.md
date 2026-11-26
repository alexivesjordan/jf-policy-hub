# Packaging and pack estimate

Additive. Logistics only. Cin7 stays GET-only. No commercial invoice rows are rewritten by the migration.

## Release notes

- `logistics.sku_packages` holds one or more shipping boxes per SKU: L×W×H cm, gross kg, stackable, max stack, can be on its side, ships on a pallet only. Empty dimensions stay empty.
- Packaging has search, a missing-dimensions filter, per-row save, CSV import and export, and a Cin7 product sync that inserts SKUs and refreshes names. It does not copy Cin7 product length, width, height or weight, and it does not overwrite dimensions already entered.
- Pack estimate takes a Cin7 sale or quote number, or SKUs typed in. A box under the parcel weight and longest-side limits is a parcel. Anything heavier, longer, or marked pallet-only is packed onto a pallet.
- The packer is an extreme-point, first-fit decreasing heuristic in `src/lib/packing`. It fills the pallet floor before it stacks, refuses overhang, and honours stackable, max stack and on-side. It is not a guaranteed optimum. The same `LoadSpace` shape is what a later container or vehicle planner should call.
- `logistics.load_spaces` stores UK and Euro pallets plus starting internal sizes for a 20ft, a 40ft, a 40ft high cube, an LWB panel van and a 7.5t rigid. There is no UI for those yet.
- Use in commercial invoice writes the estimate and opens the invoice form with those dimension rows filled. They stay editable. The handoff is refused when a line has no dimensions, a box does not fit, or the invoice would need more than 30 rows.
- Defaults, until Alex confirms them: UK pallet 120×100 cm, deck 15 cm, tare 25 kg; Euro 120×80 cm, deck 14 cm, tare 20 kg; overall height 180 cm; gross 1000 kg; parcel 30 kg and 120 cm on the longest side. Overall height includes the deck.

## Off the shelf

Checked 26 Nov 2026.

| Tool | Cost | API | Why not this time |
| --- | --- | --- | --- |
| CubeMaster | Web plans from $49/user/month. The calculation API is the multi-client platform: $290/month for 5 clients and 500 loads, or $490/month for 25 clients and 1,000 loads. Diagrams are a further add-on. | REST at `api.cubemaster.net`. A load is one pallet, container or truck. | A second catalogue, a per-load fee, and no write-back into the commercial invoice. |
| EasyCargo | $9.70 per 24-hour ticket (packs of at least 10), $79/user/month, or $799/user/year, prices without VAT. | REST can push a load list. The vendor states the load calculation cannot be run through the API. Someone has to open EasyCargo. | Cannot fill an invoice from Pulse. |
| Cargo-Planner | Lite $99/month or $59/month billed annually. Standard $139/month or $99/month annually, up to 5 users. Enterprise is a quote. | REST load API, including palletisation, is an Enterprise feature. | The plan that can actually calculate is unpriced, and the result still has to be copied into the invoice. |

Pulse needs the dimensions next to the invoice, a missing-dimension flag instead of a guess, and one click into the existing dimension rows. None of the three do that. The in-app packer is the right first step. If a later planner needs axle weights, a guaranteed optimum, or a 3D PDF, Cargo-Planner's API or CubeMaster are the ones that calculate remotely. EasyCargo does not.

## Pre-checks

`01-prechecks.sql` should show `load_spaces`, `sku_packages`, `packing_settings`, `pack_estimates` and the three functions as null. `logistics.commercial_invoices` must already exist.

On TEST (`jqdhkrlopmgbwbjebgxy`) before apply, all four new objects were null and commercial invoices were present. Production was not touched.

## Post-checks

`02-postchecks.sql`.

On TEST after apply:

- RLS on for all four tables.
- The three functions are security invoker, not security definer.
- `anon` select is false on packages, load spaces and estimates.
- `authenticated` can select packages, cannot insert load spaces, cannot delete estimates.
- 7 load spaces, 2 of them pallets, default pallet `uk-standard`.
- 5 policies. No views in `logistics`.
- Security advisors did not flag the new tables. New indexes are unused only because the tables are empty, which is expected.
- `supabase/tests/logistics_packing.sql`: `RESULTS: passed=11 failed=0` (the script then rolls back). An office user can write a package, a re-sync does not wipe dimensions, a bad weight is rejected, and an installer and `anon` cannot read or write.

## Rollback

`rollback.sql` is **DESTRUCTIVE** for the new data only. It drops packaging dimensions, saved estimates, packing defaults, and the pallet, container and vehicle catalogue. It does not drop commercial invoices, customs rows, or anything in Cin7.

Tested on TEST inside a transaction: after the drops, all four tables and the seed function were null; after rollback of that transaction, `sku_packages`, `load_spaces` (7 rows), the default pallet and the import function were back.

When this file is applied by the migration runner, the version is `20261128200000` and the rollback deletes that version. The TEST apply through the management API recorded version `20261126201120` / name `logistics_packing` instead. Do not delete `20261128200000` on TEST unless that version row exists.

## Verdict

**READY** for review. Not a production deploy. Confirm the courier limits and the pallet height, deck and tare before anyone treats a live estimate as the shipping plan. The numbers are editable in Pack estimate and can be saved as the shared defaults without another migration.
