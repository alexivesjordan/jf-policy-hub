# Pulse Sales — Opportunity Radar pilot

## Access and current implementation
Protected pilot route: `/sales/radar`. Only existing Sales-authorised Pulse users can call the feed preview API.

The pilot has deterministic, explainable UK tender scoring and OCDS release parsing, release deduplication, a bounded official-source feed fetcher, and a searchable scoring/review **preview**. No supplier contact enrichment, external AI, CRM writes, personal data scraping or persistent reviewer decisions.

## Configuration
- Configure `RADAR_OCDS_FEED_URL` server-side only with a verified `https://www.find-tender.service.gov.uk/api/...` OCDS JSON release-package URL.
- Confirm the exact working endpoint, query parameter names, pagination and rate limits using the official Find a Tender developer documentation before enabling a live pilot.
- The worker has strict limits on response size and number of releases; initial preview does not paginate.
- No Azure subscription is yet connected to ChatGPT; no resources were provisioned.

## Next production milestones
1. Confirm exact official feed and support pagination/cursors. Never assume missing data indicates zero opportunities.
2. Design and apply Supabase migrations through the repository's migration workflow: source releases, unique key, opportunity projects, scoring/evidence versions, watch/dismiss decisions, handoff state, and user audit trail. RLS on every exposed table.
3. Build an Azure Container Apps Job for daily ingestion with checkpointed lookback, durable source error handling, alarms and retries.
4. For per-opportunity research add queue workers, idempotency keys, bounded concurrency and monitored retries. Consider Azure Service Bus dead-lettering for critical handoff processing.
5. Implement a human review queue (pursue/watch/dismiss), stable HubSpot mapping, duplicate checks and consent-compliant contact handling. **Do not auto-create HubSpot deals.**
6. Add planning authority feeds after official tender collection stabilises.
7. Add source discovery links only where the official notice URL is verified.
8. Integration: register the Radar navigation item after Balthazar merges pending shared navigation changes.
9. Build and test in preview before shipping to production. No migrations or production data were changed by this branch.

## Local test
`npx vitest run src/features/radar/domain.test.ts src/features/radar/feed.test.ts`

The scoring rules are preliminary transparent heuristics, not a substitute for salesperson judgement. A score must never be described as probability of winning.
