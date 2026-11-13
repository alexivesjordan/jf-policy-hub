export const ACCESS_VIDEO_MAX_BYTES = 200 * 1024 * 1024;
export const ACCESS_IMAGE_MAX_BYTES = 12 * 1024 * 1024;

const VIDEO: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

const IMAGE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function planAccessMediaUpload(mimeType: string, byteSize: number) {
  const mime = mimeType.trim().toLowerCase();
  const video = VIDEO[mime];
  if (video) {
    if (byteSize <= 0 || byteSize > ACCESS_VIDEO_MAX_BYTES) {
      return { ok: false as const, message: "Videos must be 200 MB or smaller." };
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
  return new RegExp(`^ops/${installId}/[0-9a-f-]{36}\\.(mp4|mov|jpg|png|webp|gif)$`, "i").test(path);
}
