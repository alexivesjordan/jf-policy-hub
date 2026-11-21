"use server";

import { revalidatePath } from "next/cache";
import { messageFromError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type VehicleFlag = {
  id: string;
  installId: string;
  orderNumber: string;
  vanId: string;
  registration: string;
  reason: string;
  note: string | null;
  status: string;
  photos: { id: string; url: string | null }[];
};

export async function listVehicleFlags(): Promise<{ flags: VehicleFlag[]; error: string | null }> {
  const supabase = await createClient();
  const loaded = await supabase.rpc("install_list_vehicle_flags");
  if (loaded.error) return { flags: [], error: messageFromError(loaded.error, "Vehicle flags are not available.") };
  const rows = Array.isArray(loaded.data) ? loaded.data as Record<string, unknown>[] : [];
  const admin = createAdminClient();
  const flags = await Promise.all(rows.map(async (row) => {
    const photos = Array.isArray(row.photos) ? row.photos as Record<string, unknown>[] : [];
    return {
      id: String(row.id ?? ""),
      installId: String(row.installId ?? ""),
      orderNumber: String(row.orderNumber ?? ""),
      vanId: String(row.vanId ?? ""),
      registration: String(row.registration ?? ""),
      reason: String(row.reason ?? ""),
      note: typeof row.note === "string" ? row.note : null,
      status: String(row.status ?? "open"),
      photos: await Promise.all(photos.map(async (photo) => {
        const id = String(photo.id ?? "");
        const bucket = typeof photo.bucket === "string" ? photo.bucket : "";
        const path = typeof photo.path === "string" ? photo.path : "";
        if (!admin || !bucket || !path) return { id, url: null };
        const signed = await admin.storage.from(bucket).createSignedUrl(path, 60 * 10);
        return { id, url: signed.data?.signedUrl ?? null };
      })),
    };
  }));
  return { flags: flags.filter((flag) => flag.id), error: null };
}

export async function resolveVehicleFlag(flagId: string): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const saved = await supabase.rpc("install_resolve_vehicle_flag", { p_flag: flagId });
  if (saved.error) return { ok: false, message: messageFromError(saved.error, "Could not resolve that flag.") };
  revalidatePath("/operations/fleet");
  revalidatePath("/operations");
  return { ok: true, message: "Flag resolved." };
}
