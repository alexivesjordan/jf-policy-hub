import { describe, expect, it } from "vitest";
import { aggregateImport, detectDelimiter, guessColumns, parseCsv, parseImportDate, reorderCsv } from "@/lib/supply/csv";

describe("Orderwise CSV", () => {
  it("reads day/month/year and quoted commas", () => {
    expect(parseImportDate("01/02/2020", "dd/mm/yyyy")).toBe("2020-02-01");
    expect(parseImportDate("01/02/99", "dd/mm/yy")).toBe("1999-02-01");
    const table = parseCsv('Date,Code,Qty,Customer\n01/02/2020,OLD-1,2,"Example, Gym"\n', ",");
    expect(table[1]).toEqual(["01/02/2020", "OLD-1", "2", "Example, Gym"]);
    expect(detectDelimiter("A;B;C\n")).toBe(";");
    expect(guessColumns(["Date", "Product code", "Quantity", "Customer"], "sales_lines").sku).toBe("Product code");
  });

  it("aggregates fifty thousand rows, reports unmatched codes, and repeats cleanly", () => {
    const lines = ["Date,Code,Qty,Customer"];
    for (let index = 0; index < 50_000; index += 1) lines.push(`15/03/2019,SKU-${String(index % 100).padStart(2, "0")},1,Example Gym`);
    const text = lines.join("\n");
    const known = new Set(Array.from({ length: 90 }, (_, index) => `SKU-${String(index).padStart(2, "0")}`));
    const parsed = aggregateImport(text, {
      kind: "sales_lines",
      columns: { date: "Date", sku: "Code", qty: "Qty", party: "Customer" },
      dateFormat: "dd/mm/yyyy",
      delimiter: ",",
    }, (code) => (known.has(code) ? code : null));
    expect(parsed.rowsRead).toBe(50_000);
    expect(parsed.preview).toHaveLength(20);
    expect(parsed.demand).toHaveLength(90);
    expect(parsed.demand.find((row) => row.sku === "SKU-00")).toMatchObject({ month: "2019-03-01", qty: 500, order_count: 500 });
    expect(parsed.unmatched).toHaveLength(10);
    expect(parsed.unmatched.reduce((sum, row) => sum + row.qty, 0)).toBe(5000);
    const again = aggregateImport(text, {
      kind: "sales_lines",
      columns: { date: "Date", sku: "Code", qty: "Qty" },
      dateFormat: "dd/mm/yyyy",
      delimiter: ",",
    }, (code) => (known.has(code) ? code : null));
    expect(again.demand).toEqual(parsed.demand);
    expect(again.unmatched).toEqual(parsed.unmatched);
  });

  it("writes an Excel CSV with a UTF-8 BOM and a pound sign", () => {
    const csv = reorderCsv([{ sku: "JF-1", qty: 12, currency: "GBP" }]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("Cost (£)");
    expect(csv).toContain("JF-1,12");
  });
});
