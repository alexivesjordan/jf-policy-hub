# Partial kit on the job sheet

The engineer marks each order line as installed or still to follow. Lines still to follow open one task on the job, titled Kit still to follow, assigned to the booking rep. The job page and the job sheet PDF list both groups.

## Apply

1. Run `supabase/release/partial-kit/prechecks.sql`. It stops if the job sheet tables or `core.tasks` are missing, or if these columns already exist.
2. Apply `supabase/migrations/20261128400000_partial_kit_follow_up.sql`.

## Rollback

`supabase/release/partial-kit/rollback.sql` deletes those follow-up tasks, drops the new columns, and restores the previous job sheet save. Deleting the tasks is destructive. Sheet rows and the rest of the job stay.
