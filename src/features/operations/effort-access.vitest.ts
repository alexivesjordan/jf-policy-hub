import { describe, expect, it } from "vitest";
import { canSaveSkuEffort, skuEffortSavePlan } from "./effort-access";

describe("SKU grid save permissions", () => {
  it("allows only an owner, an admin, or someone with operations edit", () => {
    expect(canSaveSkuEffort({ workspace_role: "owner", levels: { operations: "none" } })).toBe(true);
    expect(canSaveSkuEffort({ workspace_role: "admin", levels: { operations: "none" } })).toBe(true);
    expect(canSaveSkuEffort({ workspace_role: "member", levels: { operations: "edit" } })).toBe(true);
    expect(canSaveSkuEffort({ workspace_role: "manager", levels: { operations: "view" } })).toBe(false);
    expect(canSaveSkuEffort({ workspace_role: "member", levels: { operations: "none" } })).toBe(false);
    expect(canSaveSkuEffort({ workspace_role: "viewer", levels: { operations: "view" } })).toBe(false);
    expect(canSaveSkuEffort({ workspace_role: null, levels: null })).toBe(false);
    expect(canSaveSkuEffort({})).toBe(false);
  });

  it("clears an empty build time back to No build time set", () => {
    expect(skuEffortSavePlan({ needsAssembly: "yes", crew: null, minutes: null })).toEqual({
      clearCrew: true,
      clearMinutes: true,
      status: "suggested",
      needsAssembly: "unknown",
    });
    expect(skuEffortSavePlan({ needsAssembly: "yes", crew: 1, minutes: 10 })).toEqual({
      clearCrew: false,
      clearMinutes: false,
      status: "confirmed",
      needsAssembly: "yes",
    });
  });
});
