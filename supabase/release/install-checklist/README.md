# Install handover checks

Three checks on the engineer job sheet: floor sheeting laid from the vehicle to the install spot, a signed built-and-checked tag on each machine, and a dust cover at handover. The checklist is the fixed list on the form. Each answer is yes or no, stored on the sheet, and printed on the job sheet PDF.

## Apply

1. `20261128400000_partial_kit_follow_up.sql` must already be applied.
2. Run `supabase/release/install-checklist/prechecks.sql`.
3. Apply `supabase/migrations/20261128410000_install_handover_checks.sql`.

## Rollback

`supabase/release/install-checklist/rollback.sql` drops the three columns and restores the previous job sheet save. The answers in those columns are removed. Kit follow-up data stays.
