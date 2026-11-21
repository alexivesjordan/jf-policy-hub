import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrations = path.join(process.cwd(), "supabase/migrations");

function sql(name: string) {
  return readFileSync(path.join(migrations, name), "utf8");
}

function body(source: string, signature: string) {
  const start = source.indexOf(signature);
  const open = source.indexOf("$$", start);
  const close = source.indexOf("$$", open + 2);
  return source.slice(open + 2, close);
}

describe("prep briefing fixes", () => {
  const fix = sql("20261121090300_prep_briefing_fixes.sql");
  const photos = body(fix, "create or replace function public.install_visit_photos");
  const started = body(fix, "create or replace function ops.assert_visit_started");
  const payload = body(fix, "create or replace function ops.visit_payload");

  it("returns vehicle damage photos only to admin and operations", () => {
    expect(photos).toContain("f.kind is distinct from 'vehicle_damage'");
    expect(photos).toContain("public.workspace_is_admin()");
    expect(photos).toContain("public.workspace_can('operations', 'view')");
    expect(photos).toContain("'concern', 'equipment', 'hq_photo', 'vehicle_damage'");
    expect(photos).toContain("if ops.is_field_engineer()");
    expect(fix).not.toMatch(/grant\s+execute\s+on\s+function\s+public\.install_visit_photos/i);
    expect(fix).not.toMatch(/revoke\s+.*install_visit_photos/i);
  });

  it("does not treat a token-path risk or job sheet as already started", () => {
    for (const fn of [started, payload]) {
      expect(fn).toContain("completed_by is not null");
      expect(fn).toContain("token_link_id is null");
    }
    expect(started).toContain("if p_token_hash is not null then");
    expect(started).toContain("Start this job before saving.");
    expect(payload).toContain("p_row.started_at is not null");
  });

  it("leaves the applied migration SQL, including the earlier backfill, in place", () => {
    const applied = sql("20261121090200_install_prep_and_briefing.sql");
    expect(applied).toContain("set started_at = coalesce(i.updated_at, i.created_at, now())");
    expect(applied).toContain("or exists (select 1 from ops.risk_assessments r where r.install_id = i.id)");
    expect(applied).not.toMatch(/do not apply (this )?to production/i);
    expect(sql("20261121090000_quote_contact_email.sql")).not.toMatch(/do not apply (this )?to production/i);
    expect(sql("20261121090100_elite_cardio_hq.sql")).not.toMatch(/do not apply (this )?to production/i);
  });
});
