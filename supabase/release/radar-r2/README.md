# Opportunity Radar, round 2

Supersedes the behaviour shipped in #81. That migration is not edited.

## Source

Planning applications come from PlanIt (`www.planit.org.uk/api/applics/json`). It is a public JSON search with no key, and it can filter granted decisions (`app_state=Permitted,Conditions`) and a decided-from date in one request. planning.data.gov.uk is a dataset catalogue and does not offer that single search, so it was not used.

## What changed

- Opportunities stay in one table. `opportunity_type` is `tender` or `planning`.
- Each notice gets a deterministic extract: buyer or applicant, site address, postcode, value, dates, scope, facility types, and published contact details.
- Exclusion words are seeded and editable. Flooring, roofing, cleaning, catering, lighting, and householder knock a notice out unless an equipment keyword or CPV still matches.
- Push to HubSpot creates a deal at `POST /crm/v3/objects/deals` only when `HUBSPOT_PRIVATE_APP_TOKEN` is set and a pipeline and stage are saved. Otherwise the button says HubSpot isn't connected and does nothing.
- After a successful push, Pulse deletes that opportunity's reminders. HubSpot owns follow-up.
- `radar_hubspot_intents` is now a push log (succeeded or failed, deal id, error). It is not dropped.

## Pre-checks

`supabase/release/radar-r2/01-prechecks.sql`. Expect `radar_present`, `type_absent`, and `exclusions_absent` all true. Confirmed on TEST before apply.

## Rollback

`supabase/rollbacks/20261128600000_radar_planning_hubspot_down.sql` is destructive. It deletes the push log and drops the planning, extraction, exclusion, and HubSpot columns. Tested on TEST inside a transaction, then rolled back. The forward columns and the seeded exclusions were still present afterwards.

## Verdict

NOT READY to create real HubSpot deals. The token, pipeline id, stage id, and owner mapping are not set. The disconnected button, planning ingest, and exclusions are in place.
