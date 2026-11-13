export type PriceSuggestion = {
  amount: number | null;
  excerpt: string | null;
  source: "heuristic" | "model";
};

type MoneyHit = { amount: number; index: number; score: number; excerpt: string };

const KEYWORD = /quote|price|total|cost|charge|install/i;

/** Pulls a likely GBP figure out of a reply. The rep still confirms it. */
export function extractQuotedPrice(text: string): { amount: number | null; excerpt: string | null } {
  const hits: MoneyHit[] = [];
  const patterns = [
    /(?:£|gbp)\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/gi,
    /\b(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*(?:gbp|pounds?)\b/gi,
    /\b(?:quote|price|total|cost|charge)\b[^£\d]{0,24}(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/gi,
  ];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      const whole = match[0];
      const start = match.index;
      if (looksLikeDateOrPhone(text, start, whole)) continue;
      const amount = Number(`${match[1].replace(/,/g, "")}.${match[2] ?? "0"}`);
      if (!Number.isFinite(amount) || amount < 1 || amount > 1_000_000) continue;
      if (!/[£]|gbp|pound/i.test(whole) && amount >= 1900 && amount <= 2100 && !match[2]) continue;
      const window = text.slice(Math.max(0, start - 40), start + whole.length + 12);
      let score = /£|gbp|pound/i.test(whole) ? 5 : 1;
      if (KEYWORD.test(window)) score += 4;
      if (match[2]) score += 1;
      hits.push({ amount, index: start, score, excerpt: whole.trim() });
    }
  }
  if (hits.length === 0) return { amount: null, excerpt: null };
  hits.sort((a, b) => b.score - a.score || b.index - a.index);
  return { amount: hits[0].amount, excerpt: hits[0].excerpt };
}

export async function suggestQuotedPrice(
  text: string,
  io: { env: Record<string, string | undefined>; fetch: typeof fetch },
): Promise<PriceSuggestion> {
  const heuristic = extractQuotedPrice(text);
  const enabled = io.env.SUBCONTRACTOR_PRICE_LLM?.trim() === "1";
  const key = io.env.LLM_API_KEY?.trim() ?? "";
  if (!enabled || !key) return { ...heuristic, source: "heuristic" };
  try {
    const model = io.env.LLM_MODEL?.trim() || "gpt-4o-mini";
    const response = await io.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: `Extract the quoted job price in GBP from this email. Reply with JSON {"amount": number or null}. Ignore phone numbers and dates.\n\n${text.slice(0, 8000)}`,
          },
        ],
      }),
    });
    if (!response.ok) return { ...heuristic, source: "heuristic" };
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(content) as { amount?: unknown };
    const amount = typeof parsed.amount === "number" ? parsed.amount : Number(parsed.amount);
    if (!Number.isFinite(amount) || amount < 1 || amount > 1_000_000) return { ...heuristic, source: "heuristic" };
    return { amount, excerpt: heuristic.excerpt, source: "model" };
  } catch {
    return { ...heuristic, source: "heuristic" };
  }
}

function looksLikeDateOrPhone(text: string, start: number, whole: string) {
  const before = text.slice(Math.max(0, start - 1), start);
  const after = text.slice(start + whole.length, start + whole.length + 1);
  if (before === "/" || after === "/" || before === "-" || after === "-") return true;
  const around = text.slice(Math.max(0, start - 14), start + whole.length + 14);
  const digits = around.replace(/\D/g, "");
  if (digits.length >= 10 && /(?:\+?\d[\d\s()-]{8,}\d)/.test(around) && !/£|gbp/i.test(whole)) return true;
  return false;
}
