import { isEuCountry } from "./rules";

export type StatementRule = {
  incoterm: string | null;
  destinationCountry: string | null;
  carrier: string | null;
  statementText: string;
  extraLine: string | null;
  priority: number;
  active: boolean;
};

export function statementRuleText(rule: Pick<StatementRule, "statementText" | "extraLine">) {
  return [rule.statementText.trim(), rule.extraLine?.trim() ?? ""].filter(Boolean).join("\n");
}

function filled(value: string | null | undefined) {
  return Boolean(value?.trim());
}

function destinationRank(rule: StatementRule, country: string) {
  if (!filled(rule.destinationCountry)) return 0;
  const destination = rule.destinationCountry!.trim().toUpperCase();
  if (destination === country) return 2;
  if (destination === "EU" && isEuCountry(country)) return 1;
  return -1;
}

function otherFields(rule: StatementRule) {
  return [rule.incoterm, rule.carrier].filter(filled).length;
}

function matches(rule: StatementRule, input: { incoterm: string; destinationCountry: string; carrier: string }) {
  if (!rule.active) return false;
  if (input.incoterm.trim().toUpperCase() !== "DDP") return false;
  if (rule.incoterm?.trim().toUpperCase() !== "DDP") return false;
  if (filled(rule.carrier) && rule.carrier!.trim().toLowerCase() !== input.carrier.trim().toLowerCase()) return false;
  if (!filled(rule.destinationCountry)) return true;
  const destination = rule.destinationCountry!.trim().toUpperCase();
  const country = input.destinationCountry.trim().toUpperCase();
  if (destination === "EU") return isEuCountry(country);
  return destination === country;
}

export function rulesFromRows(data: unknown): StatementRule[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    if (typeof item.statement_text !== "string" || !item.statement_text.trim()) return [];
    return [{
      incoterm: typeof item.incoterm === "string" ? item.incoterm : null,
      destinationCountry: typeof item.destination_country === "string" ? item.destination_country : null,
      carrier: typeof item.carrier === "string" ? item.carrier : null,
      statementText: item.statement_text,
      extraLine: typeof item.extra_line === "string" ? item.extra_line : null,
      priority: typeof item.priority === "number" ? item.priority : Number(item.priority) || 0,
      active: item.active !== false,
    }];
  });
}

/** An exact country beats EU, which beats any destination. Then the other filled fields, then priority. */
export function matchCustomsStatement(rules: StatementRule[], input: { incoterm: string; destinationCountry: string; carrier: string }) {
  const country = input.destinationCountry.trim().toUpperCase();
  const found = rules.filter((rule) => matches(rule, input)).sort((a, b) =>
    destinationRank(b, country) - destinationRank(a, country)
    || otherFields(b) - otherFields(a)
    || b.priority - a.priority);
  return found[0] ? statementRuleText(found[0]) : "";
}

export function prepareCustomsStatement(input: { incoterm: string; statementId: string; text: string; buyerVat: string }) {
  if (input.incoterm.trim().toUpperCase() !== "DDP") return { id: "none", text: "", error: "" };
  if (input.text.includes("{buyerVat}") && !input.buyerVat.trim()) {
    return { id: input.statementId, text: input.text, error: "Buyer VAT is required for this customs statement." };
  }
  return { id: input.statementId, text: input.text.replaceAll("{buyerVat}", input.buyerVat.trim()), error: "" };
}
