"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth";
import { messageFromError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export type PrepResult = { ok: boolean; message: string };

const ID = /^[0-9a-f-]{36}$/i;

function revalidateJob(installId: string) {
  revalidatePath("/field");
  revalidatePath("/field/tasks");
  revalidatePath(`/field/${installId}`);
  revalidatePath(`/field/${installId}/vehicle`);
  revalidatePath("/operations/tasks");
  revalidatePath("/operations/installs");
  revalidatePath(`/operations/installs/${installId}`);
  revalidatePath("/operations");
  revalidatePath("/operations/fleet");
}

async function actor() {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("You need to be signed in.");
  return profile;
}

export async function startInstallJob(installId: string): Promise<PrepResult> {
  try {
    await actor();
    if (!ID.test(installId)) return { ok: false, message: "That job was not found." };
    const supabase = await createClient();
    const started = await supabase.rpc("install_start_job", { p_install: installId });
    if (started.error) return { ok: false, message: messageFromError(started.error, "Could not start that job.") };
    revalidateJob(installId);
    return { ok: true, message: "Job started." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not start that job." };
  }
}

export async function saveHqBuildPhoto(installId: string, itemKey: string, fileId: string): Promise<PrepResult> {
  try {
    await actor();
    if (!ID.test(installId) || !ID.test(fileId) || !itemKey.trim()) {
      return { ok: false, message: "That photo is not on this job." };
    }
    const supabase = await createClient();
    const saved = await supabase.rpc("install_save_hq_photo", {
      p_install: installId,
      p_item_key: itemKey,
      p_file: fileId,
    });
    if (saved.error) return { ok: false, message: messageFromError(saved.error, "Could not save that photo.") };
    revalidateJob(installId);
    return { ok: true, message: "Photo saved." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not save that photo." };
  }
}

export type VehicleCheckInput = {
  driverId: string;
  vanId: string;
  lights: boolean;
  indicators: boolean;
  mirrors: boolean;
  brakes: boolean;
  fueled: boolean;
  tyrePressure: number;
  treadDepth: number;
  noWarningLights: boolean;
  newDamage: boolean;
  damageNote: string;
  damageFileIds: string[];
  fitToDrive: boolean;
  confirmed: boolean;
};

export async function submitVehicleCheck(installId: string, input: VehicleCheckInput): Promise<PrepResult> {
  try {
    await actor();
    if (!ID.test(installId)) return { ok: false, message: "That job was not found." };
    const supabase = await createClient();
    const saved = await supabase.rpc("install_submit_vehicle_check", {
      p_install: installId,
      p_payload: {
        driverId: input.driverId,
        vanId: input.vanId,
        lights: input.lights,
        indicators: input.indicators,
        mirrors: input.mirrors,
        brakes: input.brakes,
        fueled: input.fueled,
        tyrePressure: input.tyrePressure,
        treadDepth: input.treadDepth,
        noWarningLights: input.noWarningLights,
        newDamage: input.newDamage,
        damageNote: input.damageNote,
        damageFileIds: input.damageFileIds,
        fitToDrive: input.fitToDrive,
        confirmed: input.confirmed,
      },
    });
    if (saved.error) return { ok: false, message: messageFromError(saved.error, "Could not save the vehicle check.") };
    revalidateJob(installId);
    return { ok: true, message: "Vehicle check saved." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not save the vehicle check." };
  }
}
