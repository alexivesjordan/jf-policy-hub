import { describe, expect, it } from "vitest";
import { HR_NOTICE_BODY, HR_NOTICE_TITLES, hrNotice, noticeLeaks } from "./notifications";

describe("HR notifications", () => {
  it("uses a fixed title and carries no name or case title", () => {
    const payload = hrNotice("attention", "/people/cases/11111111-1111-4111-8111-111111111111");
    expect(HR_NOTICE_TITLES).toContain(payload.title);
    expect(payload.body).toBe(HR_NOTICE_BODY);
    expect(noticeLeaks(payload, ["Avery Quinn", "Grievance about the rota"])).toBe(false);
  });

  it("rejects a payload that names the person or the case", () => {
    const leaked = {
      title: "A request needs your decision",
      body: "Avery Quinn asked for leave",
      link: "/people/time-off",
    };
    expect(noticeLeaks(leaked, ["Avery Quinn", "Grievance about the rota"])).toBe(true);
  });
});
