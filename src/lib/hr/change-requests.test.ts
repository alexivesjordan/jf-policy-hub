import { describe, expect, it } from "vitest";
import { canDecideChange, isChangeField } from "./change-requests";

describe("change requests", () => {
  it("allows only the self-service fields", () => {
    expect(isChangeField("phone")).toBe(true);
    expect(isChangeField("preferred_name")).toBe(true);
    expect(isChangeField("salary")).toBe(false);
    expect(isChangeField("date_of_birth")).toBe(false);
  });

  it("never lets someone approve their own request", () => {
    expect(canDecideChange({ deciderId: "avery", submittedBy: "avery", manager: true, director: true })).toBe(false);
    expect(canDecideChange({ deciderId: "blake", submittedBy: "avery", manager: true, director: false })).toBe(true);
    expect(canDecideChange({ deciderId: "neil", submittedBy: "avery", manager: false, director: true })).toBe(true);
    expect(canDecideChange({ deciderId: "sam", submittedBy: "avery", manager: false, director: false })).toBe(false);
  });
});
