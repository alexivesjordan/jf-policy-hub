export type VanSize = "small" | "crafter";

/** Resources the pricer says a job needs. Sales can read these and cannot edit them. */
export type JobRequirements = {
  installers: number;
  licensedDrivers: number;
  vanSize: VanSize;
  vanCount: number;
  stairClimber: boolean;
};

export type RequirementSourceLine = {
  qty: number;
  weightKg: number | null;
  longestMm: number | null;
  wheeled: "Y" | "N" | null;
  /** Assembled HQ kit goes on the lorry, not in the van payload. */
  hq?: boolean;
  longLoad?: boolean;
};

/** Transit-sized load length from the fixture van note. Longer kit needs the Crafter. */
export const SMALL_VAN_MAX_MM = 2600;
export const VAN_PAYLOAD_KG = 500;
/** Units above this, and still within the climber limit, need the stair climber. */
export const CLIMBER_MIN_KG = 60;
export const CLIMBER_MAX_KG = 275;

export function deriveJobRequirements(crew: number, lines: RequirementSourceLine[]): JobRequirements {
  let vanKg = 0;
  let longest = 0;
  let longLoad = false;
  let stairClimber = false;
  for (const line of lines) {
    const weight = line.weightKg ?? 0;
    if (!line.hq) vanKg += weight * line.qty;
    if (line.longLoad) longLoad = true;
    if (line.longestMm != null) longest = Math.max(longest, line.longestMm);
    if (weight > CLIMBER_MIN_KG && weight <= CLIMBER_MAX_KG && line.wheeled !== "Y") stairClimber = true;
  }
  const vanCount = vanKg > 0 ? Math.max(1, Math.ceil(vanKg / VAN_PAYLOAD_KG)) : 1;
  return {
    installers: Math.max(1, crew),
    licensedDrivers: vanCount,
    vanSize: longLoad || longest > SMALL_VAN_MAX_MM ? "crafter" : "small",
    vanCount,
    stairClimber,
  };
}

export function canOverrideRequirements(actor: { opsRole: string | null; isOwner: boolean }) {
  return actor.isOwner || actor.opsRole === "admin_owner" || actor.opsRole === "ops_manager";
}
