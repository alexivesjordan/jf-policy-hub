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

function specificity(rule: StatementRule) {
  return [rule.incoterm, rule.destinationCountry, rule.carrier].filter(filled).length;
}

function matches(rule: StatementRule, input: { incoterm: string; destinationCountry: string; carrier: string }) {
  if (!rule.active) return false;
  if (filled(rule.incoterm) && rule.incoterm!.trim().toUpperCase() !== input.incoterm.trim().toUpperCase()) return false;
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

/** More filled conditions win, then the higher priority. No match returns an empty statement. */
export function matchCustomsStatement(rules: StatementRule[], input: { incoterm: string; destinationCountry: string; carrier: string }) {
  const found = rules.filter((rule) => matches(rule, input)).sort((a, b) => specificity(b) - specificity(a) || b.priority - a.priority);
  return found[0] ? statementRuleText(found[0]) : "";
}
