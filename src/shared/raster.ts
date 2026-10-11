import sharp from "sharp";
export interface Raster {
  bytes: Buffer;
  mime: string;
  width: number;
  height: number;
}
/** Decode at every ingestion boundary; never treat a recognizable header as proof. */
export async function validateRaster(bytes: Buffer): Promise<Raster> {
  if (bytes.length > 10 * 1024 * 1024) throw new Error("Image exceeds 10 MB");
  let metadata;
  try {
    metadata = await sharp(bytes, { limitInputPixels: 40000000 }).metadata();
    if (
      !["png", "jpeg", "webp"].includes(metadata.format ?? "") ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > 20000 ||
      metadata.height > 20000 ||
      (metadata.pages ?? 1) > 1
    )
      throw new Error("unsupported");
    await sharp(bytes, { limitInputPixels: 40000000 }).stats();
  } catch {
    throw new Error(
      "Use a valid single PNG, JPEG or WebP under 40 megapixels and 20,000 pixels per dimension",
    );
  }
  return {
    bytes,
    mime: `image/${metadata.format}`,
    width: metadata.width!,
    height: metadata.height!,
  };
}
