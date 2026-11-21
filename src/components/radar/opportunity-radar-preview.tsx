"use client";
import { useEffect, useState } from "react";
import type { RadarCandidate, RadarAssessment } from "@/features/radar/domain";

type Item = { candidate: RadarCandidate; assessment: RadarAssessment };
type FeedResult = {
  fetchedAt: string; readCount: number; unrecognisedReleases: number;
  results: Item[]; warning: string; source: string;
};

export function OpportunityRadarPreview() {
  const [batch, setBatch] = useState<FeedResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [minScore, setMinScore] = useState(0);

  async function refresh() {
    setLoading(true);setError("");
    try {
      const response = await fetch("/api/radar/preview", { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Opportunity feed failed.");
      setBatch(json as FeedResult);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Feed unavailable.");
    } finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  const filtered = (batch?.results ?? []).filter(({candidate,assessment}) =>
    assessment.score >= minScore &&
    (candidate.title + " " + candidate.buyerName + " " + candidate.description)
      .toLowerCase().includes(query.toLowerCase()));
  return <div className="space-y-5">
    <section className="rounded-3xl border border-line bg-card p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Find a Tender — live feed preview</h2>
          <p className="text-sm text-grey">Deterministic triage. No AI contact enrichment or automatic HubSpot records yet.</p>
        </div>
        <button type="button" onClick={refresh} disabled={loading}
          className="rounded-xl bg-red px-4 py-2 font-semibold text-white disabled:opacity-50">
          {loading?"Refreshing…":"Refresh feed"}
        </button>
      </div>
      {batch ? <p className="text-xs text-grey">
        Read {batch.readCount} source releases; {batch.unrecognisedReleases} ignored due to incomplete IDs/dates.
        Fetched {new Date(batch.fetchedAt).toLocaleString("en-GB")}.
      </p> : null}
      <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold">Search the results</span>
          <input className="w-full rounded-xl border border-line bg-paper px-3 py-2"
            placeholder="Gym, leisure, fitness…" value={query} onChange={event=>setQuery(event.currentTarget.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold">Minimum relevance score</span>
          <select className="rounded-xl border border-line bg-paper px-3 py-2"
            value={minScore} onChange={event=>setMinScore(Number(event.currentTarget.value))}>
            <option value="0">All opportunities</option>
            <option value="40">40+ (Review / High)</option>
            <option value="75">75+ (High)</option>
          </select>
        </label>
      </div>
      <p className="text-xs text-grey">Relevance scores are rule-based initial assessments, not verified prospect values or bid probabilities.</p>
    </section>
    {error ? <p role="alert" className="rounded-xl border border-line p-4 text-sm">{error}</p> : null}
    {batch && filtered.length===0 ? <p className="rounded-xl border border-line p-4 text-sm text-grey">No opportunities match this filter.</p> : null}
    {filtered.map(({candidate,assessment})=><article key={candidate.source+":"+candidate.releaseId}
      className="space-y-3 rounded-3xl border border-line bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-lg">{candidate.title}</h3>
          <p className="text-sm text-grey">{candidate.buyerName}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-lg font-semibold">{assessment.score}/100</p>
          <p className="text-xs uppercase text-grey">{assessment.priority}</p>
        </div>
      </div>
      <p className="text-sm whitespace-pre-wrap">{candidate.description.slice(0,650) || "No description in the source release."}</p>
      <div className="grid gap-2 sm:grid-cols-3 text-xs text-grey">
        <p>Published: {new Date(candidate.publishedAt).toLocaleDateString("en-GB")}</p>
        <p>Deadline: {candidate.deadlineAt ? new Date(candidate.deadlineAt).toLocaleDateString("en-GB") : "Not supplied"}</p>
        <p>Value: {candidate.valueAmount != null ? candidate.valueAmount.toLocaleString("en-GB")+" "+(candidate.valueCurrency||"") : "Unknown"}</p>
      </div>
      {assessment.evidence.length ? <ul className="list-disc pl-5 text-sm">{assessment.evidence.map(x=><li key={x}>{x}</li>)}</ul> : null}
      {assessment.warnings.length ? <div className="space-y-1 border-l-2 border-line pl-3 text-sm text-grey">
        {assessment.warnings.map(x=><p key={x}>{x}</p>)}
      </div> : null}
      <div className="flex flex-wrap gap-3 text-sm">
        <a href={candidate.sourceUrl} target="_blank" rel="noopener noreferrer" className="font-semibold underline">View original source</a>
        <span className="text-grey">OCDS {candidate.ocid} · Release {candidate.releaseId}</span>
      </div>
    </article>)}
  </div>;
}
