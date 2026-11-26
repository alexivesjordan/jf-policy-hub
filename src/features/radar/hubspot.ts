const DEALS_URL = "https://api.hubapi.com/crm/v3/objects/deals";

export type HubSpotDealDraft = {
  name: string;
  amount: number | null;
  closeDate: string | null;
  pipelineId: string;
  stageId: string;
  ownerId: string;
  description: string;
  sourceUrl: string;
};

export function hubspotConnected(token: string | undefined) {
  return Boolean(token?.trim());
}

export function buildHubSpotDeal(input: {
  title: string;
  buyer: string;
  valueAmount: number | null;
  closeDate: string | null;
  scopeSummary: string;
  url: string;
  pipelineId: string;
  stageId: string;
  ownerId: string;
}): HubSpotDealDraft {
  const lines = [input.scopeSummary, input.buyer ? `Buyer: ${input.buyer}` : "", input.url ? `Source: ${input.url}` : ""]
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    name: input.title.slice(0, 200),
    amount: input.valueAmount,
    closeDate: input.closeDate,
    pipelineId: input.pipelineId.trim(),
    stageId: input.stageId.trim(),
    ownerId: input.ownerId.trim(),
    description: lines.join("\n"),
    sourceUrl: input.url,
  };
}

export function hubspotDealUrl(portalId: string, dealId: string) {
  if (!/^\d+$/.test(portalId) || !/^\d+$/.test(dealId)) return null;
  return `https://app.hubspot.com/contacts/${portalId}/record/0-3/${dealId}`;
}

export function hubSpotProperties(draft: HubSpotDealDraft) {
  const properties: Record<string, string> = {
    dealname: draft.name,
    description: draft.description,
  };
  if (draft.amount != null) properties.amount = String(draft.amount);
  if (draft.closeDate) properties.closedate = draft.closeDate;
  if (draft.pipelineId) properties.pipeline = draft.pipelineId;
  if (draft.stageId) properties.dealstage = draft.stageId;
  if (draft.ownerId) properties.hubspot_owner_id = draft.ownerId;
  return properties;
}

export async function createHubSpotDeal(
  draft: HubSpotDealDraft,
  options: { token: string; fetchImpl?: typeof fetch },
): Promise<{ id: string }> {
  if (!draft.pipelineId || !draft.stageId) {
    throw new Error("Set the HubSpot pipeline and stage.");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(DEALS_URL, {
    method: "POST",
    redirect: "error",
    headers: {
      Authorization: `Bearer ${options.token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ properties: hubSpotProperties(draft) }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`HubSpot returned HTTP ${response.status}`);
  const body = (await response.json()) as { id?: unknown };
  if (typeof body.id !== "string" || !body.id) throw new Error("HubSpot did not return a deal id.");
  return { id: body.id };
}
