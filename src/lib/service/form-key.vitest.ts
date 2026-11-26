import { describe, expect, it } from "vitest";
import { newVisitHref, visitFormInstanceKey } from "@/lib/service/form-key";

describe("new visit form", () => {
  it("opens a blank form for each new visit and keeps an existing visit on its own key", () => {
    const first = visitFormInstanceKey(null, "draft-a");
    const second = visitFormInstanceKey(null, "draft-b");
    const saved = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    expect(first).not.toBe(second);
    expect(visitFormInstanceKey(saved, "draft-a")).toBe(`visit:${saved}`);
    expect(visitFormInstanceKey(saved, null)).toBe(`visit:${saved}`);
    expect(newVisitHref("2026-12-11", "draft-a")).not.toBe(newVisitHref("2026-12-11", "draft-b"));
    expect(newVisitHref("2026-12-11", "draft-a")).toBe("/service/visits/new?on=2026-12-11&draft=draft-a");
    expect(newVisitHref("2026-12-11", "draft-a", saved)).not.toContain(`/visits/${saved}`);
  });
});
