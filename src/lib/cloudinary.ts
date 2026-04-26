/**
 * src/lib/cloudinary.ts
 * Central Cloudinary helper used by all controllers.
 *
 * Handles:
 *  - Optimised upload (quality auto, format auto, eager WebP)
 *  - Extracting public_id from a Cloudinary secure_url
 *  - Deleting one or many assets from Cloudinary (fire-and-forget safe)
 */

import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export { cloudinary };

// ─── Upload options ────────────────────────────────────────────────────────────
// Applied to every upload across the app.
// - quality: auto    → Cloudinary picks the best quality level per image
// - fetch_format: auto → serves WebP/AVIF to browsers that support it
// - eager             → pre-generates an optimised WebP variant on upload

export const UPLOAD_OPTIONS: object = {
  upload_preset: "nigittriple",       // your Cloudinary preset
  quality: "auto:good",               // auto quality, "good" tier (vs "best" = larger)
  fetch_format: "auto",               // serve WebP/AVIF automatically
  eager: [
    { quality: "auto:good", fetch_format: "auto" },   // pre-generate optimised variant
  ],
  eager_async: true,                  // don't block upload response on eager gen
};

// ─── Extract public_id from a Cloudinary URL ───────────────────────────────────
/**
 * Parses a Cloudinary secure_url and returns the public_id (including folder path).
 *
 * Example input:
 *   https://res.cloudinary.com/nigittriple/image/upload/v1234567890/nigittriple/products/abc123.jpg
 * Returns:
 *   nigittriple/products/abc123
 *
 * Returns null if the URL is not a Cloudinary URL or cannot be parsed.
 */
export function extractPublicId(url: string | null | undefined): string | null {
  if (!url || !url.includes("cloudinary.com")) return null;

  try {
    // Strip query string
    const clean = url.split("?")[0];

    // Match everything after /upload/ (skip version like v1234567890/)
    const match = clean.match(/\/upload\/(?:v\d+\/)?(.+)$/);
    if (!match) return null;

    // Remove file extension
    const withoutExt = match[1].replace(/\.[^.]+$/, "");
    return withoutExt;
  } catch {
    return null;
  }
}

// ─── Delete a single asset ────────────────────────────────────────────────────
/**
 * Deletes one asset from Cloudinary by its URL or public_id.
 * Silent on failure — never throws; logs to console.error instead.
 */
export async function deleteCloudinaryImage(
  urlOrPublicId: string | null | undefined
): Promise<void> {
  if (!urlOrPublicId) return;

  try {
    // Determine if we have a URL or a public_id directly
    const publicId = urlOrPublicId.startsWith("http")
      ? extractPublicId(urlOrPublicId)
      : urlOrPublicId;

    if (!publicId) return;

    await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    console.error("[Cloudinary] Failed to delete asset:", urlOrPublicId, err);
  }
}

// ─── Delete multiple assets ───────────────────────────────────────────────────
/**
 * Deletes multiple assets from Cloudinary by their URLs or public_ids.
 * Silent on partial failure — logs errors but does not throw.
 */
export async function deleteCloudinaryImages(
  urlsOrPublicIds: (string | null | undefined)[]
): Promise<void> {
  const publicIds = urlsOrPublicIds
    .map((u) =>
      u
        ? u.startsWith("http")
          ? extractPublicId(u)
          : u
        : null
    )
    .filter((id): id is string => !!id);

  if (publicIds.length === 0) return;

  try {
    // Cloudinary allows up to 100 per batch
    const BATCH = 100;
    for (let i = 0; i < publicIds.length; i += BATCH) {
      await cloudinary.api.delete_resources(publicIds.slice(i, i + BATCH));
    }
  } catch (err) {
    console.error("[Cloudinary] Failed to bulk delete assets:", err);
  }
}
