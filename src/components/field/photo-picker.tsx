"use client";

import { useState } from "react";
import { compressImageFile } from "@/lib/installs/compress-image";
import { putSignedUpload } from "@/lib/installs/browser-upload";
import { issuePhotoUpload, registerPhotoUpload } from "@/features/field/actions";

export type StoredPhoto = { id: string; url: string };

export function PhotoPicker({
  installId,
  token,
  kind,
  photos,
  onChange,
  max = 8,
  label,
}: {
  installId: string;
  token: string | null;
  kind: "concern" | "equipment";
  photos: StoredPhoto[];
  onChange: (photos: StoredPhoto[]) => void;
  max?: number;
  label: string;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function add(list: FileList | null) {
    if (!list) return;
    setPending(true);
    setMessage(null);
    const next = [...photos];
    try {
      for (const file of Array.from(list)) {
        if (next.length >= max) break;
        const compressed = await compressImageFile(file);
        const issued = await issuePhotoUpload(installId, token, compressed.type, compressed.size);
        if (!issued.ok || !issued.ticket) throw new Error(issued.message);
        await putSignedUpload(issued.ticket, compressed, compressed.type || "image/jpeg");
        const registered = await registerPhotoUpload(installId, token, issued.ticket.path, kind, compressed.type, compressed.size);
        if (!registered.ok || !registered.fileId) throw new Error(registered.message);
        next.push({ id: registered.fileId, url: URL.createObjectURL(compressed) });
      }
      onChange(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That photo could not be stored.");
      onChange(next);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <label className="flex min-h-14 cursor-pointer items-center justify-center rounded-2xl border border-dashed border-red bg-card px-4 text-base font-semibold text-ink">
        {pending ? "Uploading" : label}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="sr-only"
          disabled={pending}
          onChange={(event) => {
            void add(event.target.files);
            event.target.value = "";
          }}
        />
      </label>
      {message ? <p className="text-sm font-semibold text-red">{message}</p> : null}
      <ul className="grid grid-cols-2 gap-2">
        {photos.map((photo) => (
          <li key={photo.id} className="relative">
            <div role="img" aria-label="Photo" className="h-32 w-full rounded-2xl border border-line bg-white bg-cover bg-center" style={{ backgroundImage: `url("${photo.url}")` }} />
            <button
              type="button"
              className="absolute top-2 right-2 inline-flex min-h-11 items-center rounded-full bg-paper px-3 text-sm font-semibold text-ink"
              onClick={() => onChange(photos.filter((item) => item.id !== photo.id))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
