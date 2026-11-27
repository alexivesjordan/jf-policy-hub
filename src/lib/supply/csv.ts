/** Orderwise CSV mapping. Dates default to day/month/year. */

export type ImportKind = "sales_lines" | "purchase_lines" | "suppliers";
export type DateFormat = "dd/mm/yyyy" | "dd/mm/yy" | "yyyy-mm-dd";
export type ColumnField =
  | "date"
  | "sku"
  | "qty"
  | "party"
  | "poRef"
  | "orderedOn"
  | "receivedOn"
  | "name"
  | "currency"
  | "leadTime"
  | "moq"
  | "orderMultiple";

export type ColumnMap = Partial<Record<ColumnField, string>>;

export type ImportMapping = {
  kind: ImportKind;
  columns: ColumnMap;
  dateFormat: DateFormat;
  delimiter: "," | ";" | "\t";
};

const HEADER_HINTS: Record<ColumnField, string[]> = {
  date: ["date", "invoice date", "doc date"],
  sku: ["sku", "code", "product code", "item code", "stock code"],
  qty: ["qty", "quantity", "qty ordered"],
  party: ["customer", "supplier", "account", "account name"],
  poRef: ["po", "po ref", "purchase order", "order number", "document"],
  orderedOn: ["ordered", "order date", "date ordered"],
  receivedOn: ["received", "receipt date", "date received"],
  name: ["supplier name", "name"],
  currency: ["currency"],
  leadTime: ["lead time", "lead days"],
  moq: ["moq", "minimum"],
  orderMultiple: ["multiple", "order multiple", "pack"],
};

export function detectDelimiter(text: string): "," | ";" | "\t" {
  const line = text.split(/\r?\n/, 1)[0] ?? "";
  const scores = [
    { delimiter: "\t" as const, count: line.split("\t").length },
    { delimiter: ";" as const, count: line.split(";").length },
    { delimiter: "," as const, count: line.split(",").length },
  ];
  scores.sort((left, right) => right.count - left.count);
  return scores[0]?.count && scores[0].count > 1 ? scores[0].delimiter : ",";
}

export function parseCsv(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if (char === "\n") {
      row.push(cell.trim());
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (char !== "\r") cell += char;
  }
  row.push(cell.trim());
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

export function guessColumns(headers: string[], kind: ImportKind): ColumnMap {
  const columns: ColumnMap = {};
  const used = new Set<string>();
  const fields = (Object.keys(HEADER_HINTS) as ColumnField[]).filter((field) => {
    if (kind === "suppliers") return ["name", "currency", "leadTime", "moq", "orderMultiple", "party"].includes(field);
    if (kind === "purchase_lines") return field !== "name";
    return !["name", "leadTime", "moq", "orderMultiple", "orderedOn", "receivedOn"].includes(field);
  });
  for (const field of fields) {
    const hints = HEADER_HINTS[field];
    const header = headers.find((item) => {
      const name = item.trim().toLowerCase();
      return !used.has(item) && hints.some((hint) => name === hint);
    });
    if (header) {
      columns[field] = header;
      used.add(header);
    }
  }
  return columns;
}

export function parseImportDate(value: string, format: DateFormat) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (format === "yyyy-mm-dd") {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
    if (!match) return null;
    return validDay(match[1], match[2], match[3]);
  }
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(trimmed);
  if (!match) return null;
  const year = match[3].length === 2 ? (Number(match[3]) > 50 ? `19${match[3]}` : `20${match[3]}`) : match[3];
  return validDay(year, match[2].padStart(2, "0"), match[1].padStart(2, "0"));
}

function validDay(year: string, month: string, day: string) {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day)) return null;
  return `${year}-${month}-${day}`;
}

export function monthStart(isoDay: string) {
  return `${isoDay.slice(0, 7)}-01`;
}

export type ParsedImport = {
  rowsRead: number;
  demand: { sku: string; month: string; qty: number; order_count: number }[];
  purchases: { po_ref: string; supplier_key: string | null; sku: string; qty: number; ordered_on: string | null; received_on: string | null }[];
  suppliers: { name: string; currency: string | null; leadTimeDays: number | null; moq: number | null; orderMultiple: number | null }[];
  unmatched: { code: string; qty: number }[];
  errors: string[];
  preview: Record<string, string>[];
};

function indexHeaders(headers: string[], columns: ColumnMap) {
  const index = new Map<ColumnField, number>();
  (Object.keys(columns) as ColumnField[]).forEach((field) => {
    const header = columns[field];
    if (!header) return;
    const found = headers.findIndex((item) => item.trim().toLowerCase() === header.trim().toLowerCase());
    if (found >= 0) index.set(field, found);
  });
  return index;
}

function cell(row: string[], index: Map<ColumnField, number>, field: ColumnField) {
  const at = index.get(field);
  return at == null ? "" : (row[at] ?? "").trim();
}

function numberCell(value: string) {
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function aggregateImport(text: string, mapping: ImportMapping, resolve: (code: string) => string | null): ParsedImport {
  const table = parseCsv(text, mapping.delimiter);
  const headers = table[0] ?? [];
  const index = indexHeaders(headers, mapping.columns);
  const demand = new Map<string, { sku: string; month: string; qty: number; order_count: number }>();
  const purchases: ParsedImport["purchases"] = [];
  const suppliers: ParsedImport["suppliers"] = [];
  const unmatched = new Map<string, number>();
  const errors: string[] = [];
  const preview: Record<string, string>[] = [];
  let rowsRead = 0;

  for (const row of table.slice(1)) {
    rowsRead += 1;
    if (preview.length < 20) {
      const sample: Record<string, string> = {};
      headers.forEach((header, position) => {
        sample[header || `Column ${position + 1}`] = row[position] ?? "";
      });
      preview.push(sample);
    }
    if (mapping.kind === "suppliers") {
      const name = cell(row, index, "name") || cell(row, index, "party");
      if (!name) {
        errors.push(`Row ${rowsRead} has no supplier name.`);
        continue;
      }
      suppliers.push({
        name,
        currency: cell(row, index, "currency").toUpperCase() || null,
        leadTimeDays: numberCell(cell(row, index, "leadTime")),
        moq: numberCell(cell(row, index, "moq")),
        orderMultiple: numberCell(cell(row, index, "orderMultiple")),
      });
      continue;
    }
    const code = cell(row, index, "sku");
    const qty = numberCell(cell(row, index, "qty"));
    if (!code || qty == null) {
      errors.push(`Row ${rowsRead} needs a code and a quantity.`);
      continue;
    }
    const sku = resolve(code);
    if (!sku) {
      unmatched.set(code, (unmatched.get(code) ?? 0) + Math.max(qty, 0));
      continue;
    }
    if (mapping.kind === "sales_lines") {
      const dated = parseImportDate(cell(row, index, "date"), mapping.dateFormat);
      if (!dated) {
        errors.push(`Row ${rowsRead} has no usable date.`);
        continue;
      }
      const month = monthStart(dated);
      const key = `${sku}|${month}`;
      const current = demand.get(key) ?? { sku, month, qty: 0, order_count: 0 };
      current.qty += Math.max(qty, 0);
      current.order_count += 1;
      demand.set(key, current);
      continue;
    }
    const ordered = parseImportDate(cell(row, index, "orderedOn") || cell(row, index, "date"), mapping.dateFormat);
    const received = parseImportDate(cell(row, index, "receivedOn"), mapping.dateFormat);
    purchases.push({
      po_ref: cell(row, index, "poRef") || `ROW-${rowsRead}`,
      supplier_key: cell(row, index, "party") || null,
      sku,
      qty: Math.max(qty, 0),
      ordered_on: ordered,
      received_on: received,
    });
  }

  return {
    rowsRead,
    demand: [...demand.values()],
    purchases,
    suppliers,
    unmatched: [...unmatched.entries()].map(([code, qty]) => ({ code, qty })),
    errors: errors.slice(0, 50),
    preview,
  };
}

export function reorderCsv(rows: { sku: string; qty: number; currency: string }[]) {
  const symbol = rows[0]?.currency === "GBP" || !rows[0] ? "£" : rows[0].currency;
  const lines = [[ "SKU", "Qty", `Cost (${symbol})` ], ...rows.map((row) => [row.sku, String(row.qty), ""])];
  const body = lines.map((line) => line.map(csvCell).join(",")).join("\r\n");
  return `\uFEFF${body}`;
}

function csvCell(value: string) {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
