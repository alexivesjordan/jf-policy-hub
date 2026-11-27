import { describe, expect, it } from "vitest";
import { canAdminSupply, canEditSupply, canUseSupply, homeRedirect } from "@/lib/access";
import type { Profile } from "@/lib/types";

function person(partial: Partial<Profile>): Profile {
  return {
    id: "1",
    email: "kelly@jordanfitness.com",
    full_name: "Kelly Example",
    role: "staff",
    workspace_role: "member",
    is_active: true,
    access_granted: true,
    last_sign_in_at: null,
    created_at: "",
    updated_at: "",
    levels: { people: "none", service: "none", supply: "none", operations: "none", sales: "none", finance: "none" },
    ...partial,
  };
}

describe("supply access", () => {
  it("lets a supply viewer in and keeps them from editing", () => {
    const view = person({ levels: { people: "none", service: "none", supply: "view", operations: "none", sales: "none", finance: "none" } });
    expect(canUseSupply(view)).toBe(true);
    expect(canEditSupply(view)).toBe(false);
    expect(canAdminSupply(view)).toBe(false);
    expect(homeRedirect(view)).toBeNull();
    const none = person({});
    expect(canUseSupply(none)).toBe(false);
    expect(homeRedirect(none)).toBe("/no-access");
  });

  it("lets owners and supply admins change settings", () => {
    expect(canAdminSupply(person({ workspace_role: "owner" }))).toBe(true);
    expect(canEditSupply(person({ levels: { people: "none", service: "none", supply: "edit", operations: "none", sales: "none", finance: "none" } }))).toBe(true);
    expect(canAdminSupply(person({ levels: { people: "none", service: "none", supply: "admin", operations: "none", sales: "none", finance: "none" } }))).toBe(true);
  });
});
