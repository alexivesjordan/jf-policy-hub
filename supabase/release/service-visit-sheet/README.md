# Service visit job sheet

Migration `20261128520000_service_visit_sheet.sql`.

A service visit is completed on the same job sheet as an install: kit lines (Installed / To follow), handover checks, parts, photos, signatures, and the PDF. The sheet is stored on `ops.visit_sheets` with `service_visit_id` set and `install_id` empty. The PDF title is Service visit.

Service visits do not ask for a risk assessment before the sheet. Install visits still go through RAMS and `ops.assert_visit_started` before their sheet can be saved.

The short completion note and the extra photo button are gone. Notes and photos already stored on a visit stay on the visit and can still be read.

Marking a visit Done through the old status button is refused. En route, on site, and couldn't complete stay.

## Apply

1. Run `prechecks.sql`. It only reads.
2. Apply `supabase/migrations/20261128520000_service_visit_sheet.sql`.

Nothing is written to Cin7 or HubSpot.

## Rollback

`rollback.sql` deletes service job sheets and the kit follow-up tasks that belong to them. That is destructive for those sheets. Visits, older completion notes, and older visit photos stay. Install sheets stay. `install_id` is required again. The old progress function, including Done and the completion note, is restored, and engineers can attach the old photo type again.

Try the rollback on TEST inside a transaction before using it anywhere else.

## Verdict

READY for review. Not applied to production.

Prechecks passed on TEST. The role script finished `ok=48 fail=0`. The rollback was run inside a transaction: the service sheet column and functions disappeared, install sheets still require the risk gate, and `svc.visits` stayed. After that transaction rolled back, TEST still had the forward migration.

The rollback deletes service job sheets and their kit follow-up tasks. That is the destructive step. It does not delete visits, older completion notes, or older visit photos.
