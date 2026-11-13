import { describe, expect, it } from "vitest";
import { canCompleteInstall, canSeeInstall, pathBelongsToInstall, tokenCanComplete, visibleJobs, visitRole } from "@/lib/installs/permissions";

const lewis = "lewis";
const christian = "christian";
const install = "11111111-1111-4111-8111-111111111111";

describe("engineer visit permissions", () => {
  it("treats a linked engineer as an engineer even when they have operations edit", () => {
    expect(visitRole({ isAdmin: false, hasOperationsEdit: true, linkedFieldResource: true })).toBe("engineer");
    expect(visitRole({ isAdmin: false, hasOperationsEdit: true, linkedFieldResource: false })).toBe("ops");
    expect(visitRole({ isAdmin: true, hasOperationsEdit: true, linkedFieldResource: true })).toBe("admin");
    expect(visitRole({ isAdmin: false, hasOperationsEdit: false, linkedFieldResource: false })).toBe("other");
  });

  it("lets an engineer complete only their assigned install", () => {
    expect(canSeeInstall({ role: "engineer", userId: lewis, assigneeIds: [lewis] })).toBe(true);
    expect(canCompleteInstall({ role: "engineer", userId: lewis, assigneeIds: [lewis] })).toBe(true);
    expect(canSeeInstall({ role: "engineer", userId: lewis, assigneeIds: [christian] })).toBe(false);
    expect(canCompleteInstall({ role: "engineer", userId: lewis, assigneeIds: [christian] })).toBe(false);
  });

  it("lets admins and ops see every install, and keeps a token on its own job", () => {
    expect(canSeeInstall({ role: "admin", userId: "alex", assigneeIds: [lewis] })).toBe(true);
    expect(canSeeInstall({ role: "ops", userId: "sam", assigneeIds: [] })).toBe(true);
    expect(canSeeInstall({ role: "other", userId: "pat", assigneeIds: [lewis] })).toBe(false);
    const jobs = [
      { id: "a", assigneeIds: [lewis] },
      { id: "b", assigneeIds: [christian] },
    ];
    expect(visibleJobs(jobs, { role: "engineer", userId: lewis }).map((job) => job.id)).toEqual(["a"]);
    expect(visibleJobs(jobs, { role: "ops", userId: "sam" }).map((job) => job.id)).toEqual(["a", "b"]);
    expect(tokenCanComplete("a", "a")).toBe(true);
    expect(tokenCanComplete("a", "b")).toBe(false);
    expect(tokenCanComplete(null, "a")).toBe(false);
  });

  it("only accepts a storage path under that install", () => {
    expect(pathBelongsToInstall(install, `ops/${install}/22222222-2222-4222-8222-222222222222.jpg`)).toBe(true);
    expect(pathBelongsToInstall(install, `ops/${install}/22222222-2222-4222-8222-222222222222.pdf`)).toBe(true);
    expect(pathBelongsToInstall(install, "ops/other/22222222-2222-4222-8222-222222222222.jpg")).toBe(false);
    expect(pathBelongsToInstall(install, `ops/${install}/../secret.jpg`)).toBe(false);
    expect(pathBelongsToInstall("not-a-uuid", `ops/${install}/22222222-2222-4222-8222-222222222222.jpg`)).toBe(false);
  });
});
