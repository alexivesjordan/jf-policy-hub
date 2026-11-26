import { describe, expect, it } from "vitest";
import { WORKSPACE_DENIAL_PATH, workspaceDenialRedirect } from "@/lib/access";
import { isWorkspaceDenial } from "@/lib/errors";
import type { Profile } from "@/lib/types";

function profile(partial: Partial<Profile>): Profile {
  return {
    id: "1",
    email: "a@jordanfitness.com",
    full_name: "A",
    role: "staff",
    is_active: true,
    access_granted: true,
    last_sign_in_at: null,
    created_at: "",
    updated_at: "",
    ...partial,
  };
}

describe("workspace access denials", () => {
  it("sends a signed-in member to the no-access page", () => {
    expect(workspaceDenialRedirect(profile({ workspace_role: "member" }))).toBe(WORKSPACE_DENIAL_PATH);
    expect(workspaceDenialRedirect(profile({ role: "admin" }))).toBeNull();
    expect(workspaceDenialRedirect(profile({ workspace_role: "owner" }))).toBeNull();
    expect(workspaceDenialRedirect(null)).toBe("/login");
    expect(workspaceDenialRedirect(profile({ access_granted: false, workspace_role: "member" }))).toBe("/no-access");
    expect(workspaceDenialRedirect(profile({ is_active: false, workspace_role: "admin" }))).toBe("/account-inactive");
  });

  it("recognises a workspace refusal from the database", () => {
    expect(isWorkspaceDenial({ message: "app: Only a workspace owner or admin can open this." })).toBe(true);
    expect(isWorkspaceDenial({ message: "app: That person was not found." })).toBe(false);
  });
});
