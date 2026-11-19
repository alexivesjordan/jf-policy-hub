# Pulse Logistics — commercial invoice pilot

## Access
Pilot route: `/sales/commercial-invoices` (uses existing Sales access as a temporary guard; dedicated Logistics authorisation has not been migrated). **Do not deploy/enable for general users yet.**

## What is implemented
- Read-only Cin7 lookup for up to 10 specified sales orders, using the existing server-side allowlisted integration.
- Protects API lookup and preview routes with authenticated Sales access checks.
- Rejects missing sale order lines and unresolved pricing flags.
- Requires review of buyer/consignee details, currency, SKU HS codes, country of origin, quantities, Incoterm, shipping and customs details.
- Separates carrier, Incoterm, clearance country and customs procedure; none is inferred from the destination.
- Validated multi-page **PREVIEW** PDF, including line provenance and totals. No AI or customs-statement invention.
- Unit tests for merging, mismatched addresses, unconfirmed procedures, DDP and Procedure 42 safeguards.

## Known limitations / blocking release work
1. **NOT an issued commercial invoice**: must implement a transactional number allocator, immutable snapshots, private PDF archive, versioning and controlled correction workflow before adding Issue.
2. **Source data completeness**: the existing Cin7 quote adapter doesn't expose HS/origin/party VAT/EORI/currency reliably. Use explicit review now, and validate a dedicated customs-data adapter against real sales payloads before release.
3. **Partial shipments**: ordered quantities currently default to shipped quantities. Need an authoritative shipment ledger to ensure cumulative shipped quantity across invoices/shipments cannot exceed the order quantity.
4. **Financial reconciliation**: invoice pricing must reconcile in minor currency units against real source sales and part shipments. Existing quote parsing provides only provisional pricing, not an immutable financial ledger.
5. **PDF**: currently uses standard Helvetica; accented European or non-Latin customer names may fail rendering. Add a licensed Unicode font asset from Jordan's authorised font library. Add approved logo, stamp/signature asset handling. **Do not use a stamped signature without authorised signatory approval.**
6. **Special customs statements**: obtain approved country/route/procedure templates from Europa, FedEx or a customs professional. The user must supply one; no automatic statements at this stage.
7. **Preview-only security**: ensure audit log, rate limits, access control, privacy and PDF security prior to release.
8. **Integration**: later register independent Pulse Logistics module and permission scope after Balthazar's pending foundation changes are merged.
9. **Tests/build**: run `npx vitest run src/features/logistics/commercial-invoice/rules.test.ts` and `npx tsc --noEmit` in a full repository checkout, then test with anonymised sample orders.

## Deployment boundary
No Azure resources, Supabase migrations or production configuration changes were made. This branch is intended for review and continuation, **not direct merging to production**.
