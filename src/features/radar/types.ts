export const RADAR_SOURCES = ["find-a-tender", "contracts-finder", "planit"] as const;
export type RadarSource = (typeof RADAR_SOURCES)[number];

export const OPPORTUNITY_TYPES = ["tender", "planning"] as const;
export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

export const RADAR_STATUSES = ["new", "worth_pursuing", "dismissed", "pushed_to_hubspot"] as const;
export type RadarStatus = (typeof RADAR_STATUSES)[number];

export type ValueBand = {
  label: string;
  min: number | null;
  max: number | null;
  points: number;
};

export type RadarScoringConfig = {
  keywords: string[];
  cpvCodes: string[];
  valueBands: ValueBand[];
  exclusions: string[];
  hubspotPipelineId: string;
  hubspotStageId: string;
  hubspotOwnerId: string;
  hubspotPortalId: string;
};

export type ParsedNotice = {
  source: RadarSource;
  noticeId: string;
  ocid: string | null;
  title: string;
  description: string;
  buyer: string;
  valueAmount: number | null;
  valueCurrency: string | null;
  deadline: string | null;
  expectedAwardDate: string | null;
  cpvCodes: string[];
  region: string | null;
  url: string;
  publishedAt: string | null;
  tags: string[];
  raw: unknown;
  opportunityType: OpportunityType;
  decisionStatus: string | null;
  decisionDate: string | null;
  lpa: string | null;
  siteAddress: string | null;
  postcode: string | null;
  applicant: string | null;
  agent: string | null;
  scopeSummary: string;
  facilityTypes: string[];
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
};

export type ScoreResult = {
  score: number;
  relevant: boolean;
  reasons: string[];
};

export type ReminderKind = "deadline_7" | "deadline_2" | "award";
