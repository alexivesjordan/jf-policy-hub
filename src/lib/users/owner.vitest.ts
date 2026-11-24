import { describe, expect, it } from "vitest";
import { onlyUnassigned, ownerLabel } from "./owner";

describe("record owner", () => {
  it("shows Unassigned when the owner is missing", () => {
    expect(ownerLabel(null)).toBe("Unassigned");
    expect(ownerLabel("  ")).toBe("Unassigned");
    expect(ownerLabel("Alex Ives")).toBe("Alex Ives");
  });

  it("filters a list down to rows with no owner", () => {
    const rows = [
      { id: "a", ownerUserId: "user-1" },
      { id: "b", ownerUserId: null },
      { id: "c", ownerUserId: "" },
    ];
    expect(onlyUnassigned(rows, false).map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(onlyUnassigned(rows, true).map((row) => row.id)).toEqual(["b", "c"]);
  });
});