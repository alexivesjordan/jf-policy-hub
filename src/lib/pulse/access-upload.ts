/** Prod Supabase rejects anything over 50 MB, so the check stops there. */
export const ACCESS_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const ACCESS_IMAGE_MAX_BYTES = 12 * 1024 * 1024;

const VIDEO: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

const IMAGE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/webp": "webp",
};

export function planAccessMediaUpload(mimeType: string, byteSize: number) {
  const mime = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  const video = VIDEO[mime];
  if (video) {
    if (byteSize <= 0 || byteSize > ACCESS_VIDEO_MAX_BYTES) {
      return { ok: false as const, message: "Videos up to 50 MB" };
    }
    return { ok: true as const, extension: video, kind: "video" as const };
  }
  const image = IMAGE[mime];
  if (image) {
    if (byteSize <= 0 || byteSize > ACCESS_IMAGE_MAX_BYTES) {
      return { ok: false as const, message: "Photos must be 12 MB or smaller." };
    }
    return { ok: true as const, extension: image, kind: "photo" as const };
  }
  return { ok: false as const, message: "That file type is not allowed." };
}

export function accessMediaPathOk(installId: string, path: string) {
  return new RegExp(`^ops/${installId}/[0-9a-f-]{36}\\.(mp4|mov|jpg|png|heic|webp)$`, "i").test(path);
}

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]);

function ascii(bytes: Uint8Array, start: number, end: number) {
  let text = "";
  for (let index = start; index < end && index < bytes.length; index += 1) {
    text += String.fromCharCode(bytes[index] ?? 0);
  }
  return text;
}

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

/**
 * A ranged storage response is 206 and already holds the first bytes.
 * Reading it with getReader() hangs in the Next server. A full 200 still uses the reader.
 */
export async function readStoredObjectHead(response: Response) {
  if (response.status === 206) return new Uint8Array(await response.arrayBuffer()).slice(0, 32);
  if (response.status !== 200) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < 32) {
    const next = await reader.read();
    if (next.done || !next.value) break;
    chunks.push(next.value);
    total += next.value.length;
  }
  await reader.cancel().catch(() => undefined);
  const head = new Uint8Array(Math.min(total, 32));
  let offset = 0;
  for (const chunk of chunks) {
    const slice = chunk.subarray(0, head.length - offset);
    head.set(slice, offset);
    offset += slice.length;
    if (offset >= head.length) break;
  }
  return head;
}

/** True when the first stored bytes match the content type. GIF is not accepted. */
export function accessMediaBytesMatch(mimeType: string, bytes: Uint8Array) {
  const mime = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (mime === "image/jpeg") return startsWith(bytes, [0xff, 0xd8, 0xff]);
  if (mime === "image/png") return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (mime === "image/webp") return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP";
  if (bytes.length < 12 || ascii(bytes, 4, 8) !== "ftyp") return false;
  const brand = ascii(bytes, 8, 12);
  if (mime === "image/heic") return HEIC_BRANDS.has(brand);
  if (mime === "video/mp4" || mime === "video/quicktime") return !HEIC_BRANDS.has(brand);
  return false;
}

/** The stored object's type and size, not the values the browser claimed. */
export function storedAccessMediaOk(path: string, mimeType: string, byteSize: number) {
  const plan = planAccessMediaUpload(mimeType, byteSize);
  if (!plan.ok) return plan;
  if (!path.toLowerCase().endsWith(`.${plan.extension}`)) {
    return { ok: false as const, message: "That file type is not allowed." };
  }
  return plan;
}

/** Insurance bucket limit. The bytes go straight to storage, same as access video. */
export const INSURANCE_MAX_BYTES = 20 * 1024 * 1024;

const INSURANCE: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

export function planInsuranceUpload(mimeType: string, byteSize: number) {
  const mime = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  const extension = INSURANCE[mime];
  if (!extension) return { ok: false as const, message: "Upload a PDF, JPEG, or PNG." };
  if (byteSize <= 0 || byteSize > INSURANCE_MAX_BYTES) {
    return { ok: false as const, message: "Insurance documents must be 20 MB or smaller." };
  }
  return { ok: true as const, extension, kind: "insurance" as const };
}

export function insurancePathOk(subcontractorId: string, path: string) {
  return new RegExp(`^ops/${subcontractorId}/[0-9a-f-]{36}\\.(pdf|jpg|png)$`, "i").test(path);
}

/** The stored object's type and size, not the values the browser claimed. */
export function storedInsuranceOk(path: string, mimeType: string, byteSize: number) {
  const plan = planInsuranceUpload(mimeType, byteSize);
  if (!plan.ok) return plan;
  if (!path.toLowerCase().endsWith(`.${plan.extension}`)) {
    return { ok: false as const, message: "That file type is not allowed." };
  }
  return plan;
}

export function insuranceBytesMatch(mimeType: string, bytes: Uint8Array) {
  const mime = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (mime === "application/pdf") return bytes.length >= 4 && ascii(bytes, 0, 4) === "%PDF";
  if (mime === "image/jpeg" || mime === "image/png") return accessMediaBytesMatch(mime, bytes);
  return false;
}
