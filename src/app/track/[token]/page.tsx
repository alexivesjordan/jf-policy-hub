import { Suspense } from "react";
import { connection } from "next/server";
import { TrackerNotFound, TrackerUnavailable, TrackerView } from "@/components/tracker/public-view";
import { loadPublicTracker } from "@/lib/tracker/load";

export const instant = false;

export const metadata = {
  title: "Order tracking",
  robots: { index: false, follow: false },
};

export default function TrackPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={<main className="min-h-screen bg-paper" />}>
      <TrackScreen params={params} />
    </Suspense>
  );
}

async function TrackScreen({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const result = await loadPublicTracker(token);
  if (result.state === "unavailable") return <TrackerUnavailable />;
  if (result.state !== "ready") return <TrackerNotFound />;
  return <TrackerView model={result.model} />;
}
