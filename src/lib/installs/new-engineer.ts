export type EngineerRole = "installer" | "helper";

export function engineerNameFromPerson(firstName: string, lastName: string) {
  return `${firstName} ${lastName}`.trim().replace(/\s+/g, " ");
}

function tidy(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

/** Block a blank name, an unknown role, or a name already used by an active engineer. */
export function newEngineerProblem(
  input: { name: string; role: string },
  activeNames: string[],
) {
  const name = tidy(input.name);
  if (!name || name.length > 80) return "Enter the engineer name.";
  if (input.role !== "installer" && input.role !== "helper") return "Choose installer or helper.";
  const key = name.toLowerCase();
  if (activeNames.some((item) => tidy(item).toLowerCase() === key)) {
    return "An active engineer already has that name.";
  }
  return null;
}
