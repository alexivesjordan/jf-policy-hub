import { formatKitQty, formatOrderWeight } from "@/lib/subcontractors/quote-kit";

export function isWeekday(iso: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

export function formatUkDate(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function buildSubcontractorDraft(input: {
  postcode: string;
  lines: { qty: number; description: string }[];
  weightKg: number | null;
  timeframe?: string;
  repFirstName?: string;
}) {
  const kit = input.lines.map((line) => `${formatKitQty(line.qty)}x ${line.description}`).join("\n");
  const text = [
    "Hello, hope you're well.",
    "",
    `Can you please provide me with a quote for the below kit list? The total weight of the order is ${formatOrderWeight(input.weightKg)}kg.`,
    "",
    kit,
    "",
    `The install postcode is ${input.postcode.trim() || "[POSTCODE]"}.`,
    "",
    `We're currently looking at installing this kit ${input.timeframe?.trim() || "[TIMEFRAME]"}`,
    "",
    "Looking forward to seeing a price.",
    "",
    "Best wishes,",
    input.repFirstName?.trim() || "[NAME]",
    "Jordan Fitness",
  ].join("\n");
  return { subject: "Install quote", text };
}

/** Keeps an edited draft and only swaps the timeframe sentence. */
export function replaceTimeframe(text: string, timeframe: string) {
  const line = `We're currently looking at installing this kit ${timeframe.trim() || "[TIMEFRAME]"}`;
  if (/We're currently looking at installing this kit .*/.test(text)) {
    return text.replace(/We're currently looking at installing this kit .*/, line);
  }
  return `${text.trim()}\n\n${line}\n`;
}

export function draftHtml(text: string) {
  return text
    .split("\n")
    .map((line) => `<p>${escapeHtml(line) || "&nbsp;"}</p>`)
    .join("");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);
}
