import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bookConflict, installOrderKey, openBlocked } from "@/lib/installs/order-guard";

function latestBody(qualified: string) {
  const dir = path.join(process.cwd(), "supabase/migrations");
  const sql = readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(path.join(dir, file), "utf8"))
    .join("\n")
    .replace(/--[^\n]*/g, "");
  const pattern = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+${qualified}\\s*\\(`, "gi");
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

describe("one live install per order", () => {
  it("ignores case, ordinary spaces, nbsp, and zero-width characters", () => {
    expect(installOrderKey(" FIXTURE-Q-1001 ")).toBe("fixture-q-1001");
    expect(installOrderKey("FIXTURE-Q-\u200b1001")).toBe("fixture-q-1001");
    expect(installOrderKey("fixture-q-\u200c1001")).toBe(installOrderKey("FIXTURE-Q-1001"));
    expect(installOrderKey("FIXTURE-Q-\u00a01001")).toBe("fixture-q-1001");
    expect(installOrderKey("\ufeff")).toBeNull();
  });

  it("refuses a fresh Jordan quote when any other live install has that order", () => {
    const order = "FIXTURE-Q-1001";
    expect(bookConflict([{ id: "q", orderNumber: order, status: "quoting" }], "fixture-q-\u200b1001", null)).toBe("quoting");
    expect(bookConflict([{ id: "b", orderNumber: order, status: "booked" }], order, null)).toBe("booked");
    expect(bookConflict([{ id: "p", orderNumber: order, status: "in_progress" }], order, null)).toBe("booked");
    expect(bookConflict([{ id: "c", orderNumber: order, status: "cancelled" }], order, null)).toBeNull();
    expect(bookConflict([{ id: "d", orderNumber: order, status: "completed" }], order, null)).toBeNull();
  });

  it("still books or moves the quote's own install, and still blocks a quoting one", () => {
    const own = { id: "own", orderNumber: "SO 10", status: "booked" };
    expect(bookConflict([own], "SO10", "own")).toBeNull();
    expect(bookConflict([{ ...own, status: "in_progress" }], "SO10", "own")).toBeNull();
    expect(bookConflict([{ id: "own", orderNumber: "SO 10", status: "quoting" }], "SO10", "own")).toBe("quoting");
    expect(bookConflict(
      [own, { id: "other", orderNumber: "SO10", status: "in_progress" }],
      "SO 10",
      "own",
    )).toBe("booked");
  });

  it("refuses a second subcontractor send when that order is quoting or booked", () => {
    const quoting = [{ id: "quote-install", orderNumber: "FIXTURE-Q-1001", status: "quoting" }];
    expect(openBlocked(quoting, "FIXTURE-Q-1001", null)).toBe("quoting");
    expect(openBlocked(quoting, "FIXTURE-Q-1001", "quote-install")).toBeNull();
    expect(openBlocked([{ id: "booked", orderNumber: "so 10", status: "booked" }], "SO10", null)).toBe("booked");
    expect(openBlocked([{ id: "done", orderNumber: "SO10", status: "completed" }], "SO10", null)).toBeNull();
  });

  it("keeps the wider book guard, the odd-space key, and an unblocked move", () => {
    const book = latestBody("public.install_book");
    const key = latestBody("ops.install_order_key");
    const move = latestBody("public.install_move");
    const open = latestBody("public.subcontractor_open");
    expect(book).toContain("That order is out for a subcontractor quote.");
    expect(book).toContain("That order is already booked.");
    expect(book).toContain("other.status not in ('cancelled', 'completed')");
    expect(book).toContain("other.id is distinct from v_quote.install_id");
    expect(book).toContain("v_rebook");
    expect(key).toContain("chr(8203)");
    expect(key).toContain("chr(160)");
    expect(key).toMatch(/\\s/);
    expect(move).not.toContain("install_order_key");
    expect(open).toContain("other.id is distinct from v_quote.install_id");
  });
});
