import { describe, expect, it } from "vitest";
import { caseTokenFromAddress, hashCaseToken, inboundCaseEnabled } from "./inbound";

describe("case inbound mail", () => {
  it("reads a case token and ignores a quote reply", () => {
    expect(caseTokenFromAddress("Case <case-abc123def4567890@replies.example>", "replies.example")).toBe("abc123def4567890");
    expect(caseTokenFromAddress("q-abc123def4567890@replies.example", "replies.example")).toBeNull();
    expect(hashCaseToken("abc123def4567890")).toHaveLength(64);
  });

  it("stays off unless the flag is set", () => {
    expect(inboundCaseEnabled({})).toBe(false);
    expect(inboundCaseEnabled({ HR_CASE_INBOUND_ENABLED: "1" })).toBe(true);
  });
});
