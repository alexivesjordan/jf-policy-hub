# Opportunity Radar

Supersedes draft PR #44. That branch is left open and unchanged.

## What ships

Sales users with module access can review public UK tender notices at `/sales/radar`. Admins edit keywords, CPV codes, and value bands at `/sales/radar/settings`. A daily cron, `GET /api/sales/radar/ingest`, reads Find a Tender and Contracts Finder. It dedupes on source plus notice id and does not reset a review, an owner, or a dismiss reason. Push to HubSpot records an intent row and marks the notice. It does not call HubSpot. Reminders are in-app bell items only.

## Pre-checks

Run `supabase/release/radar/01-prechecks.sql` before the migration. Every radar relation should be absent, and `notifications_kind_check` should not mention `radar`.

## Release notes

- New tables: `radar_settings`, `radar_opportunities`, `radar_hubspot_intents`, `radar_reminders`. RLS is on. There are no views.
- `notifications.kind` accepts `radar`.
- Cron path `/api/sales/radar/ingest` at 06:15 UTC. It uses the existing `CRON_SECRET`. Optional `RADAR_LOOKBACK_DAYS` defaults to 2 and is capped at 14.
- The first runs only see the lookback window, up to three pages of 100 notices per source.
- Default keywords, CPV prefixes `3742` and `3744`, and three value bands are seeded. They need Alex's sign-off. A live 45-day read kept one Contracts Finder notice because the title contained "sports hall". It is flooring work, not gym equipment.

## Rollback

`supabase/rollbacks/20261128100000_radar_down.sql` is destructive. It deletes radar bell rows and drops the four radar tables, including review decisions and HubSpot intent rows. It restores the previous notification kind check.

Tested on the TEST project `jqdhkrlopmgbwbjebgxy` inside a transaction: the tables dropped and the kind check lost `radar`, then the transaction rolled back and the tables and seed were still there.

## Test results

- `npx tsc --noEmit` passed.
- `npm test` passed after the final edits: 55 files, 222 tests. That includes scoring, dedupe, reminders, and the official-host allowlist.
- TEST project `jqdhkrlopmgbwbjebgxy`: migration applied, RLS on all four tables, anon select denied, a sales user can read the row, seeded 18 keywords and 3 bands.
- Live read: Find a Tender 256 releases over 3 pages, Contracts Finder 299 releases over 3 pages, 45-day window. One notice kept and stored. A repeat upsert left the review status as Worth pursuing, then it was set back to New. One row remains.
- Rollback SQL ran inside a transaction on TEST and was rolled back. The tables and the seed were still present afterwards.
- UI checked in fixture mode: New, Dismissed, Worth pursuing, settings, and a 390px layout. Dismiss without a reason shows "Add a reason." Dismiss with a reason and Worth pursuing move the card.

## Verdict

NOT READY for production. The review queue, access rules, and ingest path are in place on TEST. Do not merge until the keyword list is signed off, and do not apply this migration to production from this branch.
