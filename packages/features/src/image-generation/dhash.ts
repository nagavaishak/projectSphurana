/**
 * Perceptual hashing for brand-inspiration images.
 *
 * A business that publishes one post to its Facebook page and its Instagram
 * account gets two rows in the corpus: different `postId`s, different CDN URLs,
 * the same bitmap. For one org this was 29 of 71 items. Selecting an
 * "inspiration set" without collapsing them returns three copies of one post,
 * which teaches the image model one layout instead of a visual system.
 *
 * dHash (difference hash) rather than a cryptographic digest: the two copies
 * are re-encoded by each platform, so their bytes differ while the image does
 * not. dHash compares the brightness of horizontally adjacent pixels on a tiny
 * greyscale thumbnail, so it survives re-encoding, mild rescaling and quality
 * changes, and differs sharply between genuinely different images.
 */

import sharp from 'sharp';

/** 9 columns → 8 horizontal comparisons per row, 8 rows → 64 bits. */
const HASH_WIDTH = 9;
const HASH_HEIGHT = 8;

/**
 * Two images this close are the same post. Chosen empirically: cross-platform
 * copies of one post land at 0-4, and genuinely different posts in the same
 * template sit well above 8. Raising it starts collapsing distinct posts that
 * merely share a layout, which is exactly the variety we want to keep.
 */
export const DUPLICATE_HASH_DISTANCE = 8;

/**
 * 64-bit dHash as a 16-character hex string.
 *
 * Returns null rather than throwing — a corpus item that cannot be decoded
 * should be skipped for dedupe, not fail the ingest that found it.
 */
export async function computeDhash(image: Buffer): Promise<string | null> {
  try {
    const { data } = await sharp(image)
      .resize(HASH_WIDTH, HASH_HEIGHT, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    let bits = '';
    for (let row = 0; row < HASH_HEIGHT; row++) {
      for (let col = 0; col < HASH_WIDTH - 1; col++) {
        const left = data[row * HASH_WIDTH + col];
        const right = data[row * HASH_WIDTH + col + 1];
        bits += left > right ? '1' : '0';
      }
    }

    // 64 bits → 16 hex chars, padded so every hash is the same width.
    let hex = '';
    for (let i = 0; i < bits.length; i += 4) {
      hex += Number.parseInt(bits.slice(i, i + 4), 2).toString(16);
    }
    return hex;
  } catch {
    return null;
  }
}

/**
 * Number of differing bits between two dHashes — 0 is identical, 64 is
 * maximally different. Returns null when either hash is missing or malformed,
 * so callers treat "unknown" as "not a duplicate" rather than silently
 * collapsing rows on a bad comparison.
 */
export function hashDistance(
  a: string | null,
  b: string | null
): number | null {
  if (!a || !b || a.length !== b.length) return null;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    const left = Number.parseInt(a[i], 16);
    const right = Number.parseInt(b[i], 16);
    if (Number.isNaN(left) || Number.isNaN(right)) return null;
    let diff = left ^ right;
    while (diff) {
      distance += diff & 1;
      diff >>= 1;
    }
  }
  return distance;
}

/** Whether two images are near-identical — the cross-platform copy case. */
export function isDuplicateImage(a: string | null, b: string | null): boolean {
  const distance = hashDistance(a, b);
  return distance !== null && distance <= DUPLICATE_HASH_DISTANCE;
}
