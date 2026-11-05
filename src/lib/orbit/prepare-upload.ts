import { randomUUID } from "crypto";
import sharp from "sharp";

export const ORBIT_BUCKETS = ["access-media", "job-sheets", "qc", "insurance", "terms"] as const;
export type OrbitBucket = (typeof ORBIT_BUCKETS)[number];

/** App routes share the 12 MB proxy limit. Buckets themselves allow more for a later direct upload. */
export const ORBIT_APP_UPLOAD_LIMIT = 12 * 1024 * 1024;
const MAX_EDGE = 1600;

const ALLOWED: Record<OrbitBucket, readonly string[]> = {
  "access-media": ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/quicktime"],
  "job-sheets": ["image/jpeg", "image/png", "image/webp", "application/pdf"],
  qc: ["image/jpeg", "image/png", "image/webp"],
  insurance: ["application/pdf", "image/jpeg", "image/png"],
  terms: ["application/pdf"],
};

export class OrbitFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrbitFileError";
  }
}

export function isOrbitBucket(value: string): value is OrbitBucket {
  return (ORBIT_BUCKETS as readonly string[]).includes(value);
}

/** Images are resized to a JPEG. PDF and video bytes are stored as given. */
export async function prepareOrbitUpload(bucket: OrbitBucket, mimeType: string, bytes: Buffer) {
  if (!ALLOWED[bucket].includes(mimeType)) {
    throw new OrbitFileError("That file type is not allowed in this bucket.");
  }
  if (bytes.length === 0 || bytes.length > ORBIT_APP_UPLOAD_LIMIT) {
    throw new OrbitFileError("Files uploaded through the app must be 12 MB or smaller.");
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
      throw new OrbitFileError("That image could not be read.");
    }
  }

  const extension = mimeType === "application/pdf" ? "pdf" : mimeType === "video/mp4" ? "mp4" : "mov";
  return { bytes, mimeType, extension };
}

/** Id path only. Customer names are not used. */
export function orbitStoragePath(entitySchema: string, entityId: string, extension: string) {
  return `${entitySchema}/${entityId}/${randomUUID()}.${extension}`;
}
