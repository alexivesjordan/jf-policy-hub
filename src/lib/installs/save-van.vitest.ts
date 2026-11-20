import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type Definition = {
  file: string;
  args: string;
  header: string;
  body: string;
};

function definitions(): Definition[] {
  const dir = path.join(process.cwd(), "supabase/migrations");
  const found: Definition[] = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) {
    const sql = readFileSync(path.join(dir, file), "utf8").replace(/--[^\n]*/g, "");
    for (const match of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.install_save_van\s*\(/gi)) {
      const rest = sql.slice((match.index ?? 0) + match[0].length);
      const close = rest.indexOf(")");
      const opener = /as\s+(\$[A-Za-z0-9_]*\$)/i.exec(rest.slice(close));
      if (close < 0 || !opener || opener.index == null) continue;
      const tag = opener[1]!;
      const bodyStart = close + opener.index + opener[0].length;
      const bodyEnd = rest.indexOf(tag, bodyStart);
      found.push({
        file,
        args: rest.slice(0, close),
        header: rest.slice(close, close + opener.index),
        body: rest.slice(bodyStart, bodyEnd),
      });
    }
  }
  return found;
}

function normalise(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function auditPerform(body: string, action: string) {
  const at = body.indexOf(`'${action}'`);
  const start = body.lastIndexOf("perform", at);
  const end = body.indexOf(");", at);
  return body.slice(start, end + 2);
}

describe("install_save_van", () => {
  const versions = definitions();
  const latest = versions.at(-1)!;
  const previous = versions.at(-2)!;

  it("writes the saved active flag into the van.updated audit", () => {
    const perform = auditPerform(latest.body, "van.updated");
    const unquoted = perform.replace(/'(?:[^']|'')*'/g, "''");
    expect(perform).toContain("'van.updated'");
    expect(perform).not.toMatch(/coalesce\s*\(\s*p_active\s*,\s*active\s*\)/i);
    expect(unquoted).not.toMatch(/\bactive\b/);
    expect(perform).toMatch(/'active'\s*,\s*v_active/);
    expect(latest.body).toMatch(/returning\s+id\s*,\s*active\s+into\s+v_id\s*,\s*v_active/i);
  });

  it("refuses a field engineer before it checks the admin", () => {
    const fieldAt = latest.body.search(/if\s+ops\.is_field_engineer\s*\(\s*\)\s+then/i);
    const adminAt = latest.body.search(/if\s+not\s+public\.workspace_is_admin\s*\(\s*\)\s+then/i);
    expect(fieldAt).toBeGreaterThanOrEqual(0);
    expect(adminAt).toBeGreaterThan(fieldAt);
  });

  it("keeps the signature of the previous install_save_van", () => {
    expect(versions.length).toBeGreaterThan(1);
    expect(normalise(latest.args)).toBe(normalise(previous.args));
    expect(latest.header).toMatch(/returns\s+uuid/i);
    expect(latest.header).toMatch(/security\s+definer/i);
    expect(latest.header).toMatch(/set\s+search_path\s*=\s*ops\s*,\s*public/i);
    expect(previous.header).toMatch(/returns\s+uuid/i);
  });
});
