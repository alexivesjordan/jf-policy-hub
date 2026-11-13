import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auditInstallGrants } from "@/lib/installs/field-grants";

function migrations() {
  const dir = path.join(process.cwd(), "supabase/migrations");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(path.join(dir, name), "utf8"));
}

const openAward = `
create or replace function public.subcontractor_award(p_install uuid)
returns void
language plpgsql
as $$
begin
  if not public.workspace_can('operations', 'edit') then
    raise exception 'app: You cannot award that job.';
  end if;
end;
$$;
grant execute on function public.subcontractor_award(uuid) to authenticated;
`;

const guardedAward = `
create or replace function public.subcontractor_award(p_install uuid)
returns void
language plpgsql
as $$
begin
  if ops.is_field_engineer() then
    raise exception 'app: You cannot award that job.';
  end if;
end;
$$;
grant execute on function public.subcontractor_award(uuid) to authenticated;
`;

describe("field engineer grants", () => {
  const files = migrations();
  const audit = auditInstallGrants(files);

  it("refuses a field engineer on every install function outside the allow-list", () => {
    expect(audit.gaps).toEqual([]);
  });

  it("still grants the office functions, and the old risk save is gone", () => {
    expect(audit.granted).toContain("install_set_contact_email");
    expect(audit.granted).toContain("install_book");
    expect(audit.granted).toContain("install_save_quote");
    expect(audit.granted).toContain("install_available_starts");
    expect(audit.granted).toContain("install_revoke_access_links");
    expect(audit.granted).not.toContain("install_save_risk");
    expect(audit.granted).not.toContain("install_claim_engineer");
  });

  it("fails when a later subcontractor function is granted without a field-engineer refusal", () => {
    const added = auditInstallGrants([...files, openAward]);
    expect(added.gaps).toContain("subcontractor_award");
    const guarded = auditInstallGrants([...files, guardedAward]);
    expect(guarded.gaps).not.toContain("subcontractor_award");
  });
});
