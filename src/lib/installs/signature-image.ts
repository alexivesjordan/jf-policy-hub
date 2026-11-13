import sharp from "sharp";

const MAX_BYTES = 2_000_000;
const MAX_PIXELS = 4_000_000;
const MAX_EDGE = 1200;

const PHOTO_PIXELS = 24_000_000;
const PHOTO_EDGE = 2000;

export async function prepareVisitPhoto(bytes: Uint8Array) {
  if (bytes.byteLength === 0) throw new Error("That photo could not be read.");
  try {
    const jpeg = await sharp(Buffer.from(bytes), { limitInputPixels: PHOTO_PIXELS, failOn: "error" })
      .rotate()
      .resize({ width: PHOTO_EDGE, height: PHOTO_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    return new Uint8Array(jpeg);
  } catch {
    throw new Error("That photo could not be read.");
  }
}

export async function prepareSignaturePng(bytes: Uint8Array) {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
    throw new Error("That signature is too large.");
  }
  try {
    const png = await sharp(Buffer.from(bytes), { limitInputPixels: MAX_PIXELS, failOn: "error" })
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    return new Uint8Array(png);
  } catch {
    throw new Error("That signature could not be read.");
  }
}
