export const CHANGE_FIELDS = ["phone", "personal_email", "home_address", "emergency_contacts", "preferred_name"] as const;

export type ChangeField = (typeof CHANGE_FIELDS)[number];

export function isChangeField(value: string): value is ChangeField {
  return (CHANGE_FIELDS as readonly string[]).includes(value);
}

export function canDecideChange(input: { deciderId: string; submittedBy: string; manager: boolean; director: boolean }) {
  if (!input.deciderId || input.deciderId === input.submittedBy) return false;
  return input.manager || input.director;
}
