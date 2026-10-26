import sharp from "sharp";
import { createHash } from "node:crypto";

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export function resolveProfilePhoto(data: Record<string, unknown> | undefined, googlePhotoURL: string | null) {
  return data?.photoSource === "custom"
    ? (typeof data.photoURL === "string" ? data.photoURL : null)
    : googlePhotoURL;
}

export function photoStoragePath(userId: string, version: string) {
  const owner = createHash("sha256").update(userId).digest("hex");
  return `profile-photos/${owner}/${version}.webp`;
}

export async function normalizePhoto(input: Buffer) {
  if (!input.length || input.length > MAX_PHOTO_BYTES) throw new Error("Choose an image under 5 MB.");
  const image = sharp(input, { limitInputPixels: 25_000_000, animated: false });
  const metadata = await image.metadata();
  if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) {
    throw new Error("Choose a JPEG, PNG, or WebP image.");
  }
  return image.rotate().resize(256, 256, { fit: "cover" }).webp({ quality: 85 }).toBuffer();
}
