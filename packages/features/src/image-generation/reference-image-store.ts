/**
 * Canonical, content-addressed store for image-template reference PNGs.
 *
 * The git↔S3 split: the template *definition* (slot-map JSON) is the source of
 * truth in git; the reference *images* live in one canonical, public bucket in
 * the prod account, addressed by the sha256 of their bytes
 * (`image-templates/<sha256>.png`). The JSON references each image by hash, so
 * a commit pins exact bytes — reproducible across every environment, and the
 * objects are immutable (perfect for CDN caching, trivial rollback).
 *
 * Reads are public HTTPS (no per-env credentials, no cross-account IAM). Writes
 * (publish) are gated to a prod-account role used by the export/publish step.
 *
 * The seed never uploads — it only builds public URLs from the hashes in the
 * JSON. Uploads happen in the publish step (`templates:export-image`) and the
 * one-off migration of the existing in-repo PNGs.
 */
import { createHash } from 'node:crypto';
import {
  getImageTemplatesBucket,
  getImageTemplatesPublicBaseUrl,
  getOrgAssetsBucket,
  getPresignedDownloadUrl,
  upload,
} from '@borradh-workspace/storage';

const KEY_PREFIX = 'image-templates';

/** sha256 (hex) of a reference PNG's bytes — its content address. */
export function referenceImageSha256(png: Buffer): string {
  return createHash('sha256').update(png).digest('hex');
}

/** Canonical object key for a reference image: `image-templates/<sha256>.png`. */
export function referenceImageKey(sha256: string): string {
  return `${KEY_PREFIX}/${sha256}.png`;
}

/** Public URL for a reference image, `${base}/image-templates/<sha256>.png`. */
export function referenceImagePublicUrl(sha256: string): string {
  return `${getImageTemplatesPublicBaseUrl()}/${referenceImageKey(sha256)}`;
}

/**
 * Content-address a reference PNG and upload it to the canonical bucket.
 *
 * Idempotent: the key IS the content hash, so re-publishing identical bytes
 * overwrites the same object with the same bytes (a no-op in effect). Returns
 * the hash + the public URL.
 */
export async function publishReferenceImage(
  png: Buffer
): Promise<{ sha256: string; url: string }> {
  const sha256 = referenceImageSha256(png);
  await upload({
    bucket: getImageTemplatesBucket(),
    key: referenceImageKey(sha256),
    body: png,
    contentType: 'image/png',
  });
  return { sha256, url: referenceImagePublicUrl(sha256) };
}

// ─── Curated carousel inspiration images ───────────────────────────────────
//
// The curated carousel-template inspiration images (structural layout refs the
// nano-banana engine reproduces, fully rebranded). Stored in the per-env
// ORG-ASSETS bucket under a `carousel-inspiration/` prefix (NOT the prod-only
// image-templates bucket) so the worker reads/writes them with its existing
// per-env credentials in every environment. Keyed by template slug + slide
// index (path-based; a small hand-curated set, edited in place). Seeded via
// `scripts/seed-carousel-inspiration.ts`; the registry references them by
// (slug, index) only, so no URLs/hashes are committed.

const CAROUSEL_PREFIX = 'carousel-inspiration';

/** `carousel-inspiration/<slug>/<NN>.jpg` (NN = 1-based, zero-padded). */
export function carouselInspirationKey(slug: string, index: number): string {
  const nn = String(index + 1).padStart(2, '0');
  return `${CAROUSEL_PREFIX}/${slug}/${nn}.jpg`;
}

/** A presigned GET URL for a curated carousel inspiration slide image. */
export function carouselInspirationSignedUrl(
  slug: string,
  index: number
): Promise<string> {
  return getPresignedDownloadUrl({
    bucket: getOrgAssetsBucket(),
    key: carouselInspirationKey(slug, index),
  });
}

/** Upload one inspiration slide image. Used by the seed script. */
export async function publishCarouselInspiration(
  slug: string,
  index: number,
  jpg: Buffer
): Promise<{ key: string }> {
  const key = carouselInspirationKey(slug, index);
  await upload({
    bucket: getOrgAssetsBucket(),
    key,
    body: jpg,
    contentType: 'image/jpeg',
  });
  return { key };
}

/** `carousel-inspiration/_single/<slug>.jpg` for single-graphic templates. */
export function singleTemplateInspirationKey(slug: string): string {
  return `${CAROUSEL_PREFIX}/_single/${slug}.jpg`;
}

export function singleTemplateInspirationSignedUrl(
  slug: string
): Promise<string> {
  return getPresignedDownloadUrl({
    bucket: getOrgAssetsBucket(),
    key: singleTemplateInspirationKey(slug),
  });
}

export async function publishSingleTemplateInspiration(
  slug: string,
  jpg: Buffer
): Promise<{ key: string }> {
  const key = singleTemplateInspirationKey(slug);
  await upload({
    bucket: getOrgAssetsBucket(),
    key,
    body: jpg,
    contentType: 'image/jpeg',
  });
  return { key };
}
