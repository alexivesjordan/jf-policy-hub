import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { prepareSignaturePng, prepareVisitPhoto } from "@/lib/installs/signature-image";

describe("signature images", () => {
  it("shrinks a wide signature before it is stored", async () => {
    const wide = await sharp({
      create: { width: 3000, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
    }).png().toBuffer();
    const prepared = await prepareSignaturePng(new Uint8Array(wide));
    const meta = await sharp(prepared).metadata();
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(40);
    expect(meta.format).toBe("png");
  });

  it("shrinks a visit photo before the PDF embeds it", async () => {
    const wide = await sharp({
      create: { width: 2400, height: 1000, channels: 3, background: { r: 20, g: 20, b: 20 } },
    }).jpeg().toBuffer();
    const prepared = await prepareVisitPhoto(new Uint8Array(wide));
    const meta = await sharp(prepared).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(2000);
    expect(meta.height).toBe(833);
  });

  it("refuses a visit photo over about 24 megapixels", async () => {
    const huge = await sharp({
      create: { width: 5000, height: 5000, channels: 3, background: { r: 255, g: 255, b: 255 } },
    }).jpeg({ quality: 30 }).toBuffer();
    await expect(prepareVisitPhoto(new Uint8Array(huge))).rejects.toThrow("could not be read");
  });

  it("refuses a signature whose pixel count can blow up the PDF", async () => {
    const huge = await sharp({
      create: { width: 3000, height: 2000, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
    }).png().toBuffer();
    await expect(prepareSignaturePng(new Uint8Array(huge))).rejects.toThrow("could not be read");
  });
});
