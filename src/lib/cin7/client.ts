import "server-only";

import { Cin7RequestBlocked } from "@/lib/cin7/allowlist";
import { createFixtureCin7Client } from "@/lib/cin7/fixture-adapter";
import { readCin7BookingDetails, readCin7Sale } from "@/lib/cin7/read-sale";
import { cin7Get } from "@/lib/cin7/transport";
import type { Cin7ReadClient } from "@/lib/cin7/types";

function credentials() {
  const accountId = process.env.CIN7_ACCOUNT_ID?.trim() ?? "";
  const applicationKey = process.env.CIN7_APPLICATION_KEY?.trim() ?? "";
  if (!accountId || !applicationKey) return null;
  return { accountId, applicationKey };
}

/** True only when both server env vars are set. The values are not returned. */
export function cin7IsConnected() {
  return credentials() !== null;
}

/**
 * Live Cin7 Core when the server env vars are set, otherwise the fixture adapter.
 * This module is server-only. Do not import it from a client component.
 */
export function getCin7Client(): Cin7ReadClient {
  const keys = credentials();
  if (!keys) return createFixtureCin7Client();
  return {
    async listQuotes() {
      throw new Cin7RequestBlocked("Cin7 blocked listing every sale. Look up one order number.");
    },
    async getQuote(id: string) {
      return readCin7Sale(id, (path, query) => cin7Get({ ...keys, path, query }));
    },
  };
}

/** Address and contact for the install record. Null when Cin7 is not connected. */
export async function loadCin7BookingDetails(orderNumber: string) {
  const keys = credentials();
  if (!keys) return null;
  return readCin7BookingDetails(orderNumber, (path, query) => cin7Get({ ...keys, path, query }));
}
