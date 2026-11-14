import { describe, expect, it } from "vitest";
import { fieldEngineerBlankLabel } from "@/lib/installs/field-engineer-label";

describe("People card field engineer label", () => {
  it("shows Not linked yet for an Installs user with no resource", () => {
    expect(fieldEngineerBlankLabel(true, false, false)).toBe("Not linked yet");
  });

  it("keeps Not a field engineer for everyone else, and office is a separate option", () => {
    expect(fieldEngineerBlankLabel(false, false, false)).toBe("Not a field engineer");
    expect(fieldEngineerBlankLabel(true, true, false)).toBe("Not a field engineer");
    expect(fieldEngineerBlankLabel(true, false, true)).toBe("Not a field engineer");
  });
});
