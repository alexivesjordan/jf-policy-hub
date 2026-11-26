const ALLOWED = ["https://www.trade-tariff.service.gov.uk/", "https://ec.europa.eu/taxation_customs/dds2/taric/"];

export async function fetchOfficial(url: string) {
  if (!ALLOWED.some((prefix) => url.startsWith(prefix))) throw new Error("Lookup failed.");
  const response = await fetch(url, {
    headers: { accept: "application/json,text/csv,text/html;q=0.9", "user-agent": "JordanPulse/landed-cost" },
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  });
  if (response.status === 404) throw new Error("That commodity code was not found.");
  if (!response.ok) throw new Error("The tariff service is unavailable.");
  return response.text();
}
