import { getCurrentProfile } from "@/lib/auth";
import { canUseSales } from "@/lib/access";
import { fetchTenderBatch, radarPreview } from "@/features/radar/feed";


export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!canUseSales(profile)) return Response.json({ error: "Forbidden." }, { status: 403 });
  const url = process.env.RADAR_OCDS_FEED_URL?.trim();
  if (!url) {
    return Response.json({
      error: "Opportunity Radar is not yet connected to the official public tender feed. Configure RADAR_OCDS_FEED_URL.",
    }, { status: 503 });
  }
  try {
    const batch = await fetchTenderBatch(url);
    return Response.json({
      fetchedAt: batch.fetchedAt, readCount: batch.readCount,
      unrecognisedReleases: batch.unrecognisedReleases,
      results: radarPreview(batch).slice(0, 300),
      source: "Find a Tender official OCDS release feed",
      warning: "Exploratory read-only view. Reviews, dismissals and CRM handoff are not persisted in this pilot.",
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Radar public OCDS feed preview failed", error);
    return Response.json({ error: "The official tender feed could not be retrieved. Check the configured API endpoint or try again." }, { status: 502 });
  }
}
