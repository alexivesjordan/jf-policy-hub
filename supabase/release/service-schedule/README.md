# Service visits on the operations schedule

Migration `20261127490000_ops_schedule_service_visits.sql`.

`public.ops_schedule` gains one extra event list. An assigned service visit appears on that engineer's weekday, labelled `Service HH:MM · Customer`, and links to the booking page. Saturday and Sunday stay off the Monday–Friday grid, the same as installs.

This does not change overlap. Two service windows still warn until someone confirms. A service day still blocks install auto-pick. Leave still blocks install auto-pick.

## Apply

1. Run `prechecks.sql`. It only reads.
2. Apply `supabase/migrations/20261127490000_ops_schedule_service_visits.sql`.

Nothing is written to Cin7 or HubSpot. No rows are inserted or deleted.

## Rollback

`rollback.sql` replaces `public.ops_schedule` with the previous body. Service visits disappear from the schedule. Install jobs, absences, van bookings, visits, and job sheets stay.

## Classification

Additive. The only destructive step is the rollback, which drops the service lines from the schedule function. It does not delete data.
