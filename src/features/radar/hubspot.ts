import type { RadarSource } from "@/features/radar/types";

export type HubSpotDealIntent = {
  opportunityId: string;
  source: RadarSource;
  noticeId: string;
  title: string;
  buyer: string;
  valueAmount: number | null;
  valueCurrency: string | null;
  url: string;
};

export function buildHubSpotIntent(row: {
  id: string;
  source: RadarSource;
  noticeId: string;
  title: string;
  buyer: string;
  valueAmount: number | null;
  valueCurrency: string | null;
  url: string;
}): HubSpotDealIntent {
  return {
    opportunityId: row.id,
    source: row.source,
    noticeId: row.noticeId,
    title: row.title,
    buyer: row.buyer,
    valueAmount: row.valueAmount,
    valueCurrency: row.valueCurrency,
    url: row.url,
  };
}

/**
 * HubSpot owns deals. Pulse records the request and does not call HubSpot.
 * A later adapter can implement this. The review action must not call it.
 */
export interface HubSpotDealAdapter {
  pushDeal(intent: HubSpotDealIntent): Promise<{ externalId: string }>;
}

export class UnconfiguredHubSpotAdapter implements HubSpotDealAdapter {
  async pushDeal(intent: HubSpotDealIntent): Promise<{ externalId: string }> {
    void intent;
    throw new Error("HubSpot is not connected. Pulse records the request only.");
  }
}
