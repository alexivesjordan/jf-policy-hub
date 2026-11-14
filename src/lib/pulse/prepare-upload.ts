import { randomUUID } from "crypto";
import sharp from "sharp";

export const PULSE_BUCKETS = ["access-media", "job-sheets", "qc", "insurance", "terms", "documents"] as const;
export type PulseBucket = (typeof PULSE_BUCKETS)[number];

/** App routes share the 12 MB proxy limit. Buckets themselves allow more for a later direct upload. */
export const PULSE_APP_UPLOAD_LIMIT = 12 * 1024 * 1024;
const MAX_EDGE = 1600;

const ALLOWED: Record<PulseBucket, readonly string[]> = {
  "access-media": ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/quicktime"],
  "job-sheets": ["image/jpeg", "image/png", "image/webp", "application/pdf"],
  qc: ["image/jpeg", "image/png", "image/webp"],
  insurance: ["application/pdf", "image/jpeg", "image/png"],
  terms: ["application/pdf"],
  documents: ["application/pdf"],
};

export class PulseFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PulseFileError";
  }
}

export function isPulseBucket(value: string): value is PulseBucket {
  return (PULSE_BUCKETS as readonly string[]).includes(value);
}

export function accessMediaExtension(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "video/mp4") return "mp4";
  if (mimeType === "video/quicktime") return "mov";
  return null;
}

/** Images are resized to a JPEG. PDF and video bytes are stored as given. */
export async function preparePulseUpload(bucket: PulseBucket, mimeType: string, bytes: Buffer) {
  if (!ALLOWED[bucket].includes(mimeType)) {
    throw new PulseFileError("That file type is not allowed in this bucket.");
  }
  if (bytes.length === 0 || bytes.length > PULSE_APP_UPLOAD_LIMIT) {
    throw new PulseFileError("Files uploaded through the app must be 12 MB or smaller.");
  }

  if (mimeType.startsWith("image/")) {
    try {
      const resized = await sharp(bytes, { animated: false, failOn: "error" })
        .rotate()
        .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      return { bytes: resized, mimeType: "image/jpeg", extension: "jpg" };
    } catch {
      throw new PulseFileError("That image could not be read.");
    }
  }

  const extension = mimeType === "application/pdf" ? "pdf" : mimeType === "video/mp4" ? "mp4" : "mov";
  return { bytes, mimeType, extension };
}

/** Id path only. Customer names are not used. */
export function pulseStoragePath(entitySchema: string, entityId: string, extension: string) {
  return `${entitySchema}/${entityId}/${randomUUID()}.${extension}`;
}
