import { quoteFlag, type QuoteFlag } from "@/lib/quotes/flags";

/** Cin7 Core sale lines carry Total and Tax separately. Total is not assumed to be ex VAT. */

const TOLERANCE_PENCE = 10;

export type Cin7LineMoney = {
  total: number | null;
  tax: number | null;
};

export type Cin7ChargeMoney = Cin7LineMoney & {
  description: string;
};

export type Cin7OrderMoney = {
  beforeTax: number | null;
  includingTax: number | null;
};

export type ResolvedCharge = {
  description: string;
  amountNet: number;
};

export type LineNetResolution = {
  lineNets: (number | null)[];
  charges: ResolvedCharge[];
  /** True when line and charge totals matched the tax-inclusive order total and tax was removed. */
  taxStripped: boolean;
  flags: QuoteFlag[];
};

function pence(value: number) {
  return Math.sign(value) * Math.floor(Math.abs(value) * 100 + 0.5);
}

function round2(value: number) {
  return pence(value) / 100;
}

function sumPence(values: (number | null)[]) {
  let sum = 0;
  for (const value of values) {
    if (value != null) sum += pence(value);
  }
  return sum;
}

function withinTenPence(sumInPence: number, target: number) {
  return Math.abs(sumInPence - pence(target)) <= TOLERANCE_PENCE;
}

function pounds(difference: number) {
  return `£${Math.abs(difference).toFixed(2)}`;
}

/**
 * Reconcile sum(line Total) + sum(charge Total) with the order total.
 * A mismatch keeps the line totals and records the gap. It does not wipe the lines.
 */
export function resolveCin7LineNets(
  lines: Cin7LineMoney[],
  charges: Cin7ChargeMoney[],
  order: Cin7OrderMoney,
): LineNetResolution {
  const flags: QuoteFlag[] = [];
  const lineNets = lines.map((line) => (line.total == null ? null : round2(line.total)));
  const chargeNets = charges.map((charge) => ({
    description: charge.description,
    amountNet: charge.total == null ? 0 : round2(charge.total),
  }));
  if (lines.some((line) => line.total == null) || charges.some((charge) => charge.total == null)) {
    flags.push(
      quoteFlag(
        "cin7_line_total_missing",
        "Cin7 did not send a total for every product line or additional charge. A missing total is stored as £0.",
      ),
    );
  }
  const combined = sumPence(lineNets) + sumPence(chargeNets.map((charge) => charge.amountNet));
  if (order.beforeTax == null && order.includingTax == null) {
    flags.push(quoteFlag("cin7_order_total_missing", "Cin7 did not send an order total, so the line totals could not be checked."));
    return { lineNets, charges: chargeNets, taxStripped: false, flags };
  }
  if (order.beforeTax != null && withinTenPence(combined, order.beforeTax)) {
    return { lineNets, charges: chargeNets, taxStripped: false, flags };
  }
  if (order.includingTax != null && withinTenPence(combined, order.includingTax)) {
    const strippedLines = lines.map((line, index) => {
      if (line.total == null) return null;
      if (line.tax == null) return lineNets[index];
      return round2(line.total - line.tax);
    });
    const strippedCharges = charges.map((charge) => ({
      description: charge.description,
      amountNet: charge.total == null || charge.tax == null ? round2(charge.total ?? 0) : round2(charge.total - charge.tax),
    }));
    flags.push(
      quoteFlag(
        "cin7_tax_included",
        "Cin7 totals include tax. Tax was removed from each product line and additional charge.",
      ),
    );
    return { lineNets: strippedLines, charges: strippedCharges, taxStripped: true, flags };
  }
  const target = order.beforeTax ?? order.includingTax ?? 0;
  const difference = round2(combined / 100 - target);
  flags.push(
    quoteFlag(
      "cin7_totals_mismatch",
      `Cin7 product lines plus additional charges differ from the order total before tax by ${pounds(difference)}. The line totals were kept.`,
      difference,
    ),
  );
  return { lineNets, charges: chargeNets, taxStripped: false, flags };
}
