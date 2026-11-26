import { describe, expect, it } from "vitest";
import { positionRows, seatLabel, type OrgPosition } from "@/lib/org-chart";

const positions: OrgPosition[] = [
  { id: "dir", title: "Directors", reports_to: null, holders: [{ id: "1", name: "Neil" }, { id: "2", name: "Deborah" }] },
  { id: "sales", title: "Sales Director", reports_to: "dir", holders: [] },
  { id: "ops", title: "Operations Manager", reports_to: "dir", holders: [{ id: "3", name: "Simon" }] },
];

describe("org chart", () => {
  it("shows an empty seat as vacant and keeps people under their seat", () => {
    expect(seatLabel([])).toBe("VACANT");
    expect(seatLabel(positions[0]!.holders)).toBe("Neil, Deborah");
    expect(positionRows(positions).map((row) => row.position.title)).toEqual([
      "Directors",
      "Sales Director",
      "Operations Manager",
    ]);
  });
});
