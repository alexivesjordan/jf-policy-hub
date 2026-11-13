import "server-only";

import { hashPulseToken } from "@/lib/pulse/token-hash";
import { createAdminClient } from "@/lib/supabase/admin";

export type InstallAccessMedia = {
  id: string;
  kind: string | null;
  fileName: string;
  mime: string | null;
  bucket: string;
  path: string;
  url: string | null;
};

export type InstallAccessTerms = {
  id: string;
  version_label: string;
  lines: { label?: string; rate?: number; unit?: string; basis?: string; mileage?: number }[];
};

export type InstallAccessPreview = {
  install_id: string;
  customer_name: string | null;
  site_address: string | null;
  submitted: boolean;
  media_count: number;
  accepted_by_name: string | null;
  answers: Record<string, unknown> | null;
  terms: InstallAccessTerms | null;
  media: InstallAccessMedia[];
};

const SIGNED_URL_SECONDS = 60 * 10;

/** Token-scoped read for the customer page. Signs each file for ten minutes. */
export async function loadInstallAccessPreview(token: string): Promise<InstallAccessPreview | null> {
  const hash = hashPulseToken(token);
  const admin = createAdminClient();
  if (!hash || !admin) return null;
  const preview = await admin.rpc("install_access_preview", { p_token_hash: hash });
  if (preview.error || !preview.data) return null;
  const row = preview.data as Omit<InstallAccessPreview, "media"> & { media?: Omit<InstallAccessMedia, "url">[] };
  const media = await Promise.all(
    (row.media ?? []).map(async (item) => {
      if (!item.bucket || !item.path) return { ...item, url: null };
      const signed = await admin.storage.from(item.bucket).createSignedUrl(item.path, SIGNED_URL_SECONDS);
      return { ...item, url: signed.data?.signedUrl ?? null };
    }),
  );
  return { ...row, media };
}
