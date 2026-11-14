import { describe, expect, it, vi } from "vitest";
import { extractQuotedPrice, suggestQuotedPrice } from "@/lib/subcontractors/price";

describe("price extraction", () => {
  it("reads a labelled sterling amount and ignores phones, dates and years", () => {
    expect(extractQuotedPrice("Our price for this job is £1,250.00 plus VAT").amount).toBe(1250);
    expect(extractQuotedPrice("Call me on 07834 753160").amount).toBeNull();
    expect(extractQuotedPrice("We can start 18/11/2026 for GBP 980").amount).toBe(980);
    expect(extractQuotedPrice("Total: 2450").amount).toBe(2450);
    expect(extractQuotedPrice("The year 2026 is busy").amount).toBeNull();
    expect(extractQuotedPrice("£40 callout and £1,800 for the install").amount).toBe(1800);
  });

  it("uses the regex unless the model flag and a key are both set", async () => {
    const fetchMock = vi.fn();
    const off = await suggestQuotedPrice("Price £500", { env: {}, fetch: fetchMock });
    expect(off).toMatchObject({ amount: 500, source: "heuristic" });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ amount: 640 }) } }] }), { status: 200 }));
    const on = await suggestQuotedPrice("Price £500", { env: { SUBCONTRACTOR_PRICE_LLM: "1", LLM_API_KEY: "test-key" }, fetch: fetchMock });
    expect(on).toMatchObject({ amount: 640, source: "model" });
    fetchMock.mockRejectedValueOnce(new Error("down"));
    const failed = await suggestQuotedPrice("Price £500", { env: { SUBCONTRACTOR_PRICE_LLM: "1", LLM_API_KEY: "test-key" }, fetch: fetchMock });
    expect(failed).toMatchObject({ amount: 500, source: "heuristic" });
  });
});
