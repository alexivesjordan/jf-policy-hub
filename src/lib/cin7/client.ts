import "server-only";

import { createFixtureCin7Client } from "@/lib/cin7/fixture-adapter";
import type { Cin7ReadClient } from "@/lib/cin7/types";

/**
 * Always the fixture adapter. A live client would be GET-only and is not
 * implemented. There is no API key and no network call.
 */
export function getCin7Client(): Cin7ReadClient {
  return createFixtureCin7Client();
}
