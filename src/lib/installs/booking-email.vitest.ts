import { describe, expect, it } from "vitest";
import { bookingEmailMissing, bookingEmailReady } from "@/lib/installs/booking-email";

describe("booking email", () => {
  it("requires an address when Cin7 and the quote have none", () => {
    expect(bookingEmailMissing(null)).toBe(true);
    expect(bookingEmailMissing("  ")).toBe(true);
    expect(bookingEmailReady(null, "")).toBe(false);
    expect(bookingEmailReady(null, "not-an-email")).toBe(false);
    expect(bookingEmailReady("", "buyer@example.com")).toBe(true);
  });

  it("uses the address already on the quote", () => {
    expect(bookingEmailMissing("buyer@example.com")).toBe(false);
    expect(bookingEmailReady("buyer@example.com", "")).toBe(true);
  });
});
