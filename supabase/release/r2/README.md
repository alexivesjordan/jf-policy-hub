# R2 release checks (PR #51)

**What R2 does** (migrations `20261121090000`–`20261121090300`)
- Booking creates an HQ-build task (2 working days before start) and a vehicle check (start day); existing booked/in-progress installs are backfilled.
- Engineer briefing with a Start gate: in-house risk assessment and job sheet need Start (weekday, inside install dates); subcontractor token links are exempt and don't count as Start.
- Vehicle checks raise damage / not-fit flags for ops; sales no longer see `vehicle_damage` photos.
- Customer email checked before booking; non-confirmed Elite Cardio `sku_effort` rows move to the HQ-build profile.

**When:** only when `on_site_today_needing_start` in 01-prechecks is **0**. Between the apply and the deploy, the old app has no Start button, so in-house risk/job-sheet saves on unstarted jobs are refused.

**Order** (all files here are SQL; psql or the Supabase SQL Editor)
1. `01-prechecks.sql`: must pass with no `R2 REVIEW:` lines. Note `other_functions_md5`.
2. `02-capture-rollback.sql`: paste its single result over the `-- @@R2_CAPTURED_PROD_SECTION@@` line in a copy of `rollback.sql`. Save that filled file **outside the repo**.
3. Apply the 4 migrations in order through the normal migration route. Each runs in its own transaction with its `schema_migrations` row.
4. `03-postchecks.sql`: must pass, and `other_functions_md5` must equal step 1's.
5. `04-smoke-test.sql`: always ends with the error `R2 SMOKE TEST COMPLETE - ROLLED BACK ON PURPOSE`. Pass means failed=0.
6. Merge PR #51 **immediately**, then verify the Vercel production deploy and that Tasks, Ops Pulse and a job briefing load.

Any `STOP:` before step 3 means don't apply. A failure at step 3 or later means roll back.

**⚠ DESTRUCTIVE: rollback**
- `rollback.sql` drops the 6 R2 tables (`install_prep_tasks`, `install_prep_assignees`, `install_hq_photos`, `vehicle_checks`, `vehicle_check_files`, `vehicle_flags`) and `ops.installs.started_at`.
- **Prep tasks, vehicle checks, flags and Start times recorded since release are lost.** Photo files are kept.
- The Elite Cardio update is reversible: rows are restored from the captured snapshot, except rows edited since release, which are listed and left as they are.
- It runs as one transaction and verifies itself, so on any failure nothing changes. It also handles a partial apply.

**Rollback order:** Vercel Instant Rollback to the pre-#51 deployment first (the new app needs R2's functions), then the filled `rollback.sql` (`psql -1`, or the SQL Editor). Re-run 01-prechecks, which must pass. Revert #51 on `main` before the next deploy.

**TEST evidence (jqdhkrlopmgbwbjebgxy, 21 Nov 2026):** 75/75 database tests pass. These checks were rehearsed end to end: prechecks, capture, apply, postchecks, then smoke test (74/0/0). The rollback restored a snapshot identical to the 56-migration state, Elite Cardio `updated_at` included. A partial-apply rollback was identical too. TEST is left with all 4 applied.
