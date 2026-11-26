import { describe, expect, it } from "vitest";
import { coordinatesFromPostcodesIo } from "./geocode";
import { conflictLabel, formatAddress, mailHref, parseVisitDraft, telHref, type VisitDraft } from "./model";

function draft(overrides: Partial<VisitDraft> = {}): VisitDraft {
  return {
    customerName: "Riverside Gym",
    addressLine1: "1 High Street",
    addressLine2: "",
    city: "Ipswich",
    postcode: "PE304JJ",
    contactName: "Pat Example",
    contactPhone: "01603 000000",
    contactEmail: "pat@example.com",
    visitType: "repair",
    notes: "Belt slipping",
    cin7OrderNumber: "",
    hubspotTicket: "",
    visitOn: "2026-12-02",
    windowStart: "09:00",
    windowEnd: "11:00",
    durationMinutes: "90",
    assigneeIds: [],
    lines: [{ kind: "work", sku: "JF-1", serial: "SN1", fault: "Belt", parts: "Belt kit", description: "" }],
    assets: [{ make: "Jordan", model: "Runner", serial: "SN1" }],
    ...overrides,
  };
}

describe("service visit draft", () => {
  it("normalises the postcode and keeps the work line", () => {
    const parsed = parseVisitDraft(draft());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.postcode).toBe("PE30 4JJ");
    expect(parsed.payload.durationMinutes).toBe(90);
    expect(parsed.payload.lines).toEqual([
      { kind: "work", sku: "JF-1", serial: "SN1", fault: "Belt", parts: "Belt kit", description: "" },
    ]);
  });

  it("rejects a half-filled time window and swap lines on a repair", () => {
    expect(parseVisitDraft(draft({ windowEnd: "" })).ok).toBe(false);
    const swap = parseVisitDraft(draft({
      lines: [{ kind: "swap_out", sku: "OUT", serial: "", fault: "", parts: "", description: "" }],
    }));
    expect(swap.ok).toBe(false);
  });

  it("formats an address and safe contact links", () => {
    expect(formatAddress({ addressLine1: "1 High Street", city: "Ipswich", postcode: "PE30 4JJ" })).toBe(
      "1 High Street, Ipswich, PE30 4JJ",
    );
    expect(telHref("01603 000000")).toBe("tel:01603000000");
    expect(mailHref("pat@example.com")).toBe("mailto:pat@example.com");
    expect(mailHref("not an email")).toBeNull();
    expect(conflictLabel("install", "SO-1")).toBe("Install SO-1");
    expect(conflictLabel("leave", "annual_leave")).toBe("annual leave");
  });
});

describe("postcode coordinates", () => {
  it("reads a postcodes.io result and ignores a miss", () => {
    expect(coordinatesFromPostcodesIo({ result: { latitude: 52.1234567, longitude: 0.5 } })).toEqual({
      latitude: 52.123457,
      longitude: 0.5,
    });
    expect(coordinatesFromPostcodesIo({ result: null })).toBeNull();
  });
});
