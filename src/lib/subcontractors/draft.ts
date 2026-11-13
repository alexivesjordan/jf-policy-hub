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
  orderNumber: string;
  customerName: string;
  postcode: string;
  lines: { qty: number; description: string }[];
  dates: string[];
}) {
  const kit = input.lines.map((line) => `- ${line.qty}× ${line.description}`).join("\n");
  const dates = input.dates.filter(isWeekday).map((day) => `- ${formatUkDate(day)}`).join("\n");
  const subject = `Install quote ${input.orderNumber}`;
  const text = [
    "Hello,",
    "",
    `Please quote for this install for ${input.customerName}.`,
    "",
    `Order: ${input.orderNumber}`,
    `Postcode: ${input.postcode || "Not set"}`,
    "",
    "Kit:",
    kit || "- No lines on the quote",
    "",
    "Suggested dates:",
    dates || "- Not set",
    "",
    "Reply with your price.",
    "",
    "Jordan Fitness",
  ].join("\n");
  return { subject, text };
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
