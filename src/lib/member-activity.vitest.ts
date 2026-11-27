import { readFileSync } from "node:fs";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemberActivity } from "@/components/member-activity";
import { formatMemberTimestamp } from "@/lib/format";
import { activityLabel, pageOfActivity, parseMemberActivity, type MemberActivityEvent } from "@/lib/member-activity";

const invited: MemberActivityEvent = {
  id: "evt-1",
  at: "2026-01-15T15:04:00.000Z",
  action: "user.invited",
  actor_id: "actor-1",
  actor_name: "Ada Admin",
  entity_type: "profile",
  entity_id: null,
  before: null,
  after: { email: "sam@jordanfitness.com" },
};

describe("member activity", () => {
  it("formats London time in en-GB and labels the member actions", () => {
    expect(formatMemberTimestamp("2026-01-15T15:04:00.000Z")).toBe("15 Jan 2026, 15:04");
    expect(formatMemberTimestamp("2026-07-15T15:04:00.000Z")).toBe("15 Jul 2026, 16:04");
    expect(activityLabel("user.invited")).toBe("Invited");
    expect(activityLabel("user.invite_resent")).toBe("Invite resent");
    expect(activityLabel("user.signed_in")).toBe("Signed in");
    expect(activityLabel("user.access_changed")).toBe("Access changed");
    expect(activityLabel("user.name_changed")).toBe("Name changed");
    expect(activityLabel("user.deleted")).toBe("Removed");
    expect(activityLabel("user.invite_revoked")).toBe("Invite revoked");
  });

  it("shows the empty state only when there are no events", () => {
    const loadEarlier = async () => ({ events: [], hasMore: false });
    const empty = renderToStaticMarkup(createElement(MemberActivity, { events: [], hasMore: false, loadEarlier }));
    expect(empty).toContain("No activity yet");
    expect(empty).not.toContain("Load earlier");

    const filled = renderToStaticMarkup(createElement(MemberActivity, { events: [invited], hasMore: false, loadEarlier }));
    expect(filled).not.toContain("No activity yet");
    expect(filled).toContain("15 Jan 2026, 15:04");
    expect(filled).toContain("Ada Admin");
    expect(filled).toContain("Invited");
    expect(filled).not.toContain("Load earlier");
  });

  it("offers earlier rows only when the page is full", () => {
    const loadEarlier = async () => ({ events: [], hasMore: false });
    const page = pageOfActivity([invited, { ...invited, id: "evt-2" }], 1);
    expect(page.hasMore).toBe(true);
    expect(page.events).toHaveLength(1);
    const markup = renderToStaticMarkup(createElement(MemberActivity, { events: page.events, hasMore: page.hasMore, loadEarlier }));
    expect(markup).toContain("Load earlier");
    expect(markup).not.toContain("No activity yet");
    expect(parseMemberActivity([invited])).toEqual([invited]);
    expect(parseMemberActivity(null)).toEqual([]);
  });

  it("loads activity from the person page and logs a resend only after the email is sent", () => {
    const page = readFileSync(new URL("../app/(settings)/settings/workspace/members/[id]/page.tsx", import.meta.url), "utf8");
    expect(page).toContain('supabase.rpc("workspace_member_activity"');
    expect(page).not.toContain('tab === "Activity" ? <p className="text-sm text-grey">No activity yet</p>');
    expect(page).toContain("formatMemberTimestamp");
    const source = readFileSync(new URL("../features/workspace/actions.ts", import.meta.url), "utf8");
    const fn = source.slice(source.indexOf("export async function resendWorkspaceInvite"));
    expect(fn.indexOf("inviteUserByEmail")).toBeGreaterThan(-1);
    expect(fn.indexOf("if (result?.ok)")).toBeLessThan(fn.indexOf("workspace_log_invite_resent"));
  });
});
