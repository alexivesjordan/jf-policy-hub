/** Cin7 Core sale lines carry Total and Tax separately. Total is not assumed to be ex VAT. */

const TOLERANCE = 0.1;

export type Cin7LineMoney = {
  total: number | null;
  tax: number | null;
};

export type Cin7OrderMoney = {
  beforeTax: number | null;
  includingTax: number | null;
};

export type LineNetResolution = {
  lineNets: (number | null)[];
  /** True when line Total matched the tax-inclusive order total and tax was removed. */
  taxStripped: boolean;
  warning: string | null;
};

function pence(value: number) {
  return Math.sign(value) * Math.floor(Math.abs(value) * 100 + 0.5);
}

function round2(value: number) {
  return pence(value) / 100;
}

function withinTenPence(left: number, right: number) {
  return Math.abs(pence(left) - pence(right)) <= TOLERANCE * 100;
}

/**
 * Use line Total when the sum matches the order total before tax.
 * When the sum matches the order total including tax instead, use Total − Tax and flag it.
 * Otherwise the line nets are left unset.
 */
export function resolveCin7LineNets(lines: Cin7LineMoney[], order: Cin7OrderMoney): LineNetResolution {
  const empty = lines.map(() => null);
  if (lines.length === 0) return { lineNets: [], taxStripped: false, warning: null };
  if (lines.some((line) => line.total == null)) {
    return {
      lineNets: empty,
      taxStripped: false,
      warning: "Cin7 did not send a line total for every row. Those lines are priced at £0 until the PDF is used.",
    };
  }
  const sum = round2(lines.reduce((total, line) => total + (line.total ?? 0), 0));
  if (order.beforeTax == null && order.includingTax == null) {
    return {
      lineNets: empty,
      taxStripped: false,
      warning: "Cin7 did not send an order total, so line totals were not used. Those lines are priced at £0 until the PDF is used.",
    };
  }
  if (order.beforeTax != null && withinTenPence(sum, order.beforeTax)) {
    return { lineNets: lines.map((line) => round2(line.total ?? 0)), taxStripped: false, warning: null };
  }
  if (order.includingTax != null && withinTenPence(sum, order.includingTax)) {
    const missingTax = lines.some((line) => line.tax == null);
    return {
      lineNets: lines.map((line) => (line.tax == null || line.total == null ? null : round2(line.total - line.tax))),
      taxStripped: true,
      warning: missingTax
        ? "Cin7 line totals include tax, but a line has no Tax amount. Tax was removed where it was present. A line with no Tax is priced at £0."
        : "Cin7 line totals include tax. Tax was removed from each line.",
    };
  }
  return {
    lineNets: empty,
    taxStripped: false,
    warning:
      "Cin7 line totals do not match the order total before tax or the order total including tax within £0.10. Those lines are priced at £0 until the PDF is used.",
  };
}
