"use client";

import { createClient } from "@/lib/supabase/client";
import type { StorageTicket } from "@/lib/installs/upload-ticket";

/** Puts a file on the signed URL. The bytes never pass through the Next.js server. */
export async function putSignedUpload(ticket: StorageTicket, file: Blob, contentType: string) {
  const supabase = createClient();
  const uploaded = await supabase.storage.from(ticket.bucket).uploadToSignedUrl(ticket.path, ticket.token, file, { contentType });
  if (uploaded.error) throw new Error("Could not upload that file.");
}
