/**
 * Azure Container Apps Job entrypoint for Opportunity Radar.
 *
 * This file is intentionally safe to run in dry-run mode until the source
 * URL and Supabase schema have been reviewed. No AI or HubSpot writes.
 */
import { createClient } from "@supabase/supabase-js";
import { fetchTenderBatch, radarPreview } from "../src/features/radar/feed";

async function main() {
  const feedUrl = process.env.RADAR_OCDS_FEED_URL?.trim();
  if (!feedUrl) throw new Error("RADAR_OCDS_FEED_URL is required.");
  const batch = await fetchTenderBatch(feedUrl);
  const candidates = radarPreview(batch);
  const startedAt = new Date().toISOString();
  const summary = {
    job: "radar-tenders", fetchedAt: batch.fetchedAt, count: batch.readCount,
    accepted: batch.candidates.length, unrecognised: batch.unrecognisedReleases,
    highPriority: candidates.filter(r=>r.assessment.priority==="high").length,
  };
  if (process.env.RADAR_DRY_RUN !== "false") {
    console.log(JSON.stringify({ ...summary, mode: "dry-run", persisted: false }));
    return;
  }
  const url = process.env.SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !secret) throw new Error("Supabase is not configured; nothing has been persisted.");
  const supabase = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rows = candidates.map(({ candidate, assessment }) => ({
    source_key: candidate.source + ":" + candidate.releaseId,
    source: candidate.source,
    release_id: candidate.releaseId,
    ocid: candidate.ocid,
    title: candidate.title,
    description: candidate.description,
    buyer_name: candidate.buyerName,
    published_at: candidate.publishedAt,
    deadline_at: candidate.deadlineAt,
    source_url: candidate.sourceUrl,
    cpv_codes: candidate.cpvCodes,
    value_amount: candidate.valueAmount,
    value_currency: candidate.valueCurrency,
    relevance_score: assessment.score,
    relevance_priority: assessment.priority,
    scoring_evidence: assessment.evidence,
    scoring_warnings: assessment.warnings,
    last_seen_at: startedAt,
  }));
  for (let i=0;i<rows.length;i+=50) {
    const { error } = await supabase
      .from("radar_source_releases")
      .upsert(rows.slice(i,i+50), { onConflict: "source_key" });
    if (error) throw new Error("Radar persistence failed; batch must be retried: " + error.code);
  }
  console.log(JSON.stringify({ ...summary, mode: "persist", persisted: rows.length }));
}
main().catch(err => {
  console.error("Radar collector failed:", err instanceof Error ? err.message : "Unknown error");
  process.exitCode = 1;
});
