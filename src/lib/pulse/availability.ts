import type { JobRequirements, VanSize } from "@/lib/pulse/requirements";

export type PoolResource = {
  id: string;
  name: string;
  resourceType: string;
  hasLicence: boolean;
  insured: boolean;
};

export type AvailabilityLine = {
  id: string;
  label: string;
  available: boolean;
};

export type DayPlan = {
  selectable: boolean;
  lines: AvailabilityLine[];
  summary: string;
  chosenIds: string[];
};

export function vanSizeOf(resource: PoolResource): VanSize | null {
  if (resource.resourceType !== "van") return null;
  return /crafter/i.test(resource.name) ? "crafter" : "small";
}

export function displayResource(resource: PoolResource): string {
  if (resource.resourceType === "climber") return "Stair climber";
  if (resource.resourceType === "van") return vanSizeOf(resource) === "crafter" ? "Crafter" : "Small van";
  return resource.name.replace(/^FIXTURE\s+[—-]\s+/i, "");
}

function canDrive(resource: PoolResource) {
  if (resource.resourceType === "installer") return resource.hasLicence;
  return resource.hasLicence && resource.insured;
}

/** A day is selectable only when every required resource can be covered at once. */
export function planDay(requirements: JobRequirements, resources: PoolResource[], busyIds: ReadonlySet<string>): DayPlan {
  const relevant = resources.filter((resource) => {
    if (resource.resourceType === "installer") return true;
    if (resource.resourceType === "van") return vanSizeOf(resource) === requirements.vanSize;
    if (resource.resourceType === "climber") return requirements.stairClimber;
    return false;
  });
  const lines = [...relevant]
    .sort((a, b) => {
      const rank = (resource: PoolResource) => (resource.resourceType === "installer" ? 0 : resource.resourceType === "van" ? 1 : 2);
      return rank(a) - rank(b) || displayResource(a).localeCompare(displayResource(b));
    })
    .map((resource) => ({
      id: resource.id,
      label: displayResource(resource),
      available: !busyIds.has(resource.id),
    }));

  const free = (resource: PoolResource) => !busyIds.has(resource.id);
  const chosen: string[] = [];
  const climber = resources.find((resource) => resource.resourceType === "climber" && free(resource));
  if (requirements.stairClimber) {
    if (!climber) return finish(false, lines, chosen);
    chosen.push(climber.id);
  }
  const vans = resources.filter((resource) => vanSizeOf(resource) === requirements.vanSize && free(resource));
  if (vans.length < requirements.vanCount) return finish(false, lines, chosen);
  chosen.push(...vans.slice(0, requirements.vanCount).map((resource) => resource.id));

  const installers = resources.filter((resource) => resource.resourceType === "installer" && free(resource));
  const pure = installers.filter((resource) => !resource.hasLicence);
  const drivers = [
    ...installers.filter((resource) => resource.hasLicence),
    ...resources.filter((resource) => resource.resourceType !== "installer" && canDrive(resource) && free(resource)),
  ];
  let needInstallers = requirements.installers;
  let needDrivers = requirements.licensedDrivers;
  for (const person of pure) {
    if (needInstallers <= 0) break;
    chosen.push(person.id);
    needInstallers -= 1;
  }
  for (const person of drivers) {
    if (needInstallers <= 0 && needDrivers <= 0) break;
    if (needInstallers > 0) {
      chosen.push(person.id);
      needInstallers -= 1;
      needDrivers = Math.max(0, needDrivers - 1);
    } else if (needDrivers > 0) {
      chosen.push(person.id);
      needDrivers -= 1;
    }
  }
  return finish(needInstallers <= 0 && needDrivers <= 0, lines, chosen);
}

function finish(selectable: boolean, lines: AvailabilityLine[], chosenIds: string[]): DayPlan {
  return {
    selectable,
    lines,
    summary: lines.map((line) => `${line.label} - ${line.available ? "Available" : "Unavailable"}`).join(", "),
    chosenIds: selectable ? chosenIds : [],
  };
}
