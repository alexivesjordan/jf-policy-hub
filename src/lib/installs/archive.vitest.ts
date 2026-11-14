import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { archiveDue, calendarSpan, installsSurface } from "@/lib/installs/archive";

const now = new Date("2026-11-13T12:00:00Z");

describe("install archive", () => {
  it("archives a completion once it is a day old", () => {
    expect(archiveDue({
      status: "completed",
      completedAt: "2026-11-12T12:00:00Z",
      archivedAt: null,
      restoredAt: null,
    }, now)).toBe(true);
    expect(archiveDue({
      status: "completed",
      completedAt: "2026-11-12T12:00:01Z",
      archivedAt: null,
      restoredAt: null,
    }, now)).toBe(false);
  });

  it("leaves a restored install on the board until it is completed again", () => {
    expect(archiveDue({
      status: "completed",
      completedAt: "2026-10-20T12:00:00Z",
      archivedAt: null,
      restoredAt: "2026-11-01T09:00:00Z",
    }, now)).toBe(false);
    expect(archiveDue({
      status: "completed",
      completedAt: "2026-11-12T08:00:00Z",
      archivedAt: null,
      restoredAt: "2026-11-01T09:00:00Z",
    }, now)).toBe(true);
  });

  it("does not archive a cancelled or already archived install", () => {
    expect(archiveDue({
      status: "cancelled",
      completedAt: "2026-10-01T00:00:00Z",
      archivedAt: null,
      restoredAt: null,
    }, now)).toBe(false);
    expect(archiveDue({
      status: "completed",
      completedAt: "2026-10-01T00:00:00Z",
      archivedAt: "2026-10-02T00:00:00Z",
      restoredAt: null,
    }, now)).toBe(false);
  });

  it("keeps the same rule in the migration", () => {
    const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/20261113340000_install_archive.sql"), "utf8");
    expect(sql).toContain("status = 'completed'");
    expect(sql).toContain("interval '24 hours'");
    expect(sql).toContain("completed_at > restored_at");
    expect(sql).toContain("install.archived");
    expect(sql).toContain("install.restored");
    expect(sql).toContain("i.archived_at is null");
  });
});

describe("sales installs view", () => {
  it("opens the board unless the link asks for the calendar", () => {
    expect(installsSurface("")).toBe("board");
    expect(installsSurface("kanban")).toBe("board");
    expect(installsSurface("calendar")).toBe("calendar");
    expect(installsSurface("week")).toBe("calendar");
    expect(calendarSpan("week")).toBe("week");
    expect(calendarSpan("calendar")).toBe("month");
  });
});
