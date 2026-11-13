import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { installOrderKey, openBlocked, quotingBlocksBook } from "@/lib/installs/order-guard";

function latestBody(name: string) {
  const dir = path.join(process.cwd(), "supabase/migrations");
  const sql = readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(path.join(dir, file), "utf8"))
    .join("\n")
    .replace(/--[^\n]*/g, "");
  const pattern = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(`, "gi");
  let body = "";
  for (const match of sql.matchAll(pattern)) {
    const headerEnd = (match.index ?? 0) + match[0].length;
    const opener = /as\s+(\$[A-Za-z0-9_]*\$)/i.exec(sql.slice(headerEnd));
    if (!opener || opener.index == null) continue;
    const tag = opener[1]!;
    const start = headerEnd + opener.index + opener[0].length;
    const end = sql.indexOf(tag, start);
    body = sql.slice(start, end);
  }
  return body;
}

describe("reloading a Jordan quote while a subcontractor quote is open", () => {
  const quoting = [{ id: "quote-install", orderNumber: "FIXTURE-Q-1001", status: "quoting" }];

  it("treats spacing and case as the same order", () => {
    expect(installOrderKey(" FIXTURE-Q-1001 ")).toBe("fixture-q-1001");
    expect(installOrderKey("fixture-q-1001")).toBe(installOrderKey("FIXTURE-Q- 1001"));
    expect(installOrderKey("   ")).toBeNull();
  });

  it("refuses Book install on a fresh quote row for an order that is already quoting", () => {
    expect(quotingBlocksBook(quoting, "fixture-q-1001")).toBe(true);
    expect(quotingBlocksBook(quoting, " FIXTURE-Q-1001 ")).toBe(true);
    expect(quotingBlocksBook([{ orderNumber: "FIXTURE-Q-1001", status: "cancelled" }], "FIXTURE-Q-1001")).toBe(false);
    expect(quotingBlocksBook(quoting, "FIXTURE-Q-1002")).toBe(false);
  });

  it("refuses a second subcontractor send when that order is quoting or booked", () => {
    expect(openBlocked(quoting, "FIXTURE-Q-1001", null)).toBe("quoting");
    expect(openBlocked(quoting, "FIXTURE-Q-1001", "quote-install")).toBeNull();
    expect(openBlocked([{ id: "booked", orderNumber: "so 10", status: "booked" }], "SO10", null)).toBe("booked");
    expect(openBlocked([{ id: "done", orderNumber: "SO10", status: "completed" }], "SO10", null)).toBeNull();
  });

  it("keeps that order check in the last install_book and subcontractor_open", () => {
    const book = latestBody("install_book");
    const open = latestBody("subcontractor_open");
    expect(book).toContain("That order is out for a subcontractor quote.");
    expect(book).toContain("ops.install_order_key(other.order_number) = ops.install_order_key(v_quote.order_number)");
    expect(book).toContain("other.status = 'quoting'");
    expect(open).toContain("That order is out for a subcontractor quote.");
    expect(open).toContain("That order is already booked.");
    expect(open).toContain("other.status in ('quoting', 'booked')");
    expect(open).toContain("other.id is distinct from v_quote.install_id");
  });
});
