export type MemberActivityEvent = {
  id: string;
  at: string;
  action: string;
  actor_id: string | null;
  actor_name: string | null;
  entity_type: string;
  entity_id: string | null;
  before: unknown;
  after: unknown;
};

export const MEMBER_ACTIVITY_PAGE = 50;

const LABELS: Record<string, string> = {
  "user.invited": "Invited",
  "user.invite_resent": "Invite resent",
  "user.invite_revoked": "Invite revoked",
  "user.access_changed": "Access changed",
  "user.name_changed": "Name changed",
  "user.deleted": "Removed",
  "user.signed_in": "Signed in",
  "user.role_changed": "Role changed",
  "user.module_changed": "Module changed",
  "user.deactivated": "Deactivated",
};

export function activityLabel(action: string) {
  return LABELS[action] ?? action;
}

export function parseMemberActivity(data: unknown): MemberActivityEvent[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.at !== "string" || typeof item.action !== "string") return [];
    return [{
      id: item.id,
      at: item.at,
      action: item.action,
      actor_id: typeof item.actor_id === "string" ? item.actor_id : null,
      actor_name: typeof item.actor_name === "string" ? item.actor_name : null,
      entity_type: typeof item.entity_type === "string" ? item.entity_type : "profile",
      entity_id: typeof item.entity_id === "string" ? item.entity_id : null,
      before: item.before ?? null,
      after: item.after ?? null,
    }];
  });
}

export function pageOfActivity(events: MemberActivityEvent[], pageSize = MEMBER_ACTIVITY_PAGE) {
  return {
    events: events.slice(0, pageSize),
    hasMore: events.length > pageSize,
  };
}
