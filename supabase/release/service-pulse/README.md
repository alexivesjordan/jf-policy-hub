# Pulse Service

Migration `20261128500000_service_pulse.sql`.

Pulse Service is its own module (`service`). Visits, sites, contacts, and assets are in the `svc` schema. Crew, leave, and install bookings stay where they are.

A person can have several service stops on one day. They cannot also be on an install, or on leave, that day. `ops.person_day_conflicts` is the shared check. `ops.resource_free_for_days` now uses it, so an install booking will not pick someone who already has a service visit or confirmed calendar leave.

## Apply

1. Run `prechecks.sql` on the target database. It only reads.
2. Apply `supabase/migrations/20261128500000_service_pulse.sql`.
3. Owners and admins can open Pulse Service. Everyone else needs the service module.

Cin7 is read-only, and only when an order number is looked up. HubSpot is a text reference. Nothing is written to either system.

## Rollback

`rollback.sql` drops `svc` and every service visit. That is destructive for service data only. It puts install availability back to install bookings and `ops.unavailability`, and marks the service pulse coming soon again. Try it on TEST inside a transaction before using it anywhere else.

Storage objects for visit photos are not deleted.

## Not in this release

Route planning, DHZ, USAEON, proactive maintenance, and the asset system of record. Sites, assets (`external_ref`), visit source, and the timestamps `reported_at`, `scheduled_for`, `arrived_at`, and `completed_at` are stored for that later work.
