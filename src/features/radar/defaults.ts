import type { RadarScoringConfig } from "@/features/radar/types";

/** Starting list for Jordan Fitness. Alex signs this off before it is treated as final. */
export const DEFAULT_RADAR_SETTINGS: RadarScoringConfig = {
  keywords: [
    "gym",
    "gymnasium",
    "fitness",
    "leisure centre",
    "leisure center",
    "sports centre",
    "sports center",
    "sports hall",
    "exercise equipment",
    "strength equipment",
    "cardio",
    "free weights",
    "treadmill",
    "fitness suite",
    "gym equipment",
    "sports equipment",
    "fitness equipment",
    "weight training",
  ],
  cpvCodes: ["3742", "3744"],
  valueBands: [
    { label: "Small supply", min: 5000, max: 25000, points: 8 },
    { label: "Core supply", min: 25000, max: 150000, points: 15 },
    { label: "Major fit-out", min: 150000, max: 1000000, points: 12 },
  ],
};
