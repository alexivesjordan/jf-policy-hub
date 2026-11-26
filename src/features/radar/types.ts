export const RADAR_SOURCES = ["find-a-tender", "contracts-finder"] as const;
export type RadarSource = (typeof RADAR_SOURCES)[number];

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
};

export type ScoreResult = {
  score: number;
  relevant: boolean;
  reasons: string[];
};

export type ReminderKind = "deadline_7" | "deadline_2" | "award";
