/**
 * Resolve a curated inspiration image to base64 bytes for the image model.
 *
 * Production: fetch from S3 (the public image-templates bucket, by URL).
 * Dev / local verify: if `CAROUSEL_INSPIRATION_DIR` is set, read from disk
 * (`<dir>/<slug>/<NN>.jpg`, and `<dir>/_single/<slug>.jpg`) — lets us verify
 * before the images are seeded to S3.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  carouselInspirationSignedUrl,
  singleTemplateInspirationSignedUrl,
} from '../reference-image-store.js';

export interface InspirationImage {
  data: string;
  mediaType: string;
}

async function fetchAsBase64(url: string): Promise<InspirationImage | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const mediaType = (res.headers.get('content-type') ?? 'image/jpeg').split(
      ';'
    )[0];
    const buf = Buffer.from(await res.arrayBuffer());
    return { data: buf.toString('base64'), mediaType };
  } catch {
    return null;
  }
}

async function readLocal(path: string): Promise<InspirationImage | null> {
  try {
    const buf = await readFile(path);
    return { data: buf.toString('base64'), mediaType: 'image/jpeg' };
  } catch {
    return null;
  }
}

function localDir(): string | undefined {
  return process.env.CAROUSEL_INSPIRATION_DIR;
}

export async function loadCarouselInspiration(
  slug: string,
  index: number
): Promise<InspirationImage | null> {
  // Fully defensive: any failure (unconfigured S3 base URL, 404, network)
  // returns null so generation falls back to the text layout description
  // rather than failing the whole render.
  try {
    const dir = localDir();
    if (dir) {
      const nn = String(index + 1).padStart(2, '0');
      const img = await readLocal(join(dir, slug, `${nn}.jpg`));
      console.log(
        `[carousel-templates] inspiration ${slug}/${index}: ${img ? 'LOADED from local dir' : 'NOT found in local dir'} (CAROUSEL_INSPIRATION_DIR)`
      );
      return img;
    }
    const url = await carouselInspirationSignedUrl(slug, index);
    const img = await fetchAsBase64(url);
    console.log(
      `[carousel-templates] inspiration ${slug}/${index}: ${img ? 'LOADED from S3 (org-assets)' : 'NOT found at S3 (→ text-layout fallback)'}`
    );
    return img;
  } catch (e) {
    console.warn(
      `[carousel-templates] inspiration ${slug}/${index}: load threw → text-layout fallback (${e instanceof Error ? e.message : String(e)})`
    );
    return null;
  }
}

export async function loadSingleInspiration(
  slug: string
): Promise<InspirationImage | null> {
  try {
    const dir = localDir();
    if (dir) {
      const img = await readLocal(join(dir, '_single', `${slug}.jpg`));
      console.log(
        `[carousel-templates] single inspiration ${slug}: ${img ? 'LOADED from local dir' : 'NOT found in local dir'} (CAROUSEL_INSPIRATION_DIR)`
      );
      return img;
    }
    const url = await singleTemplateInspirationSignedUrl(slug);
    const img = await fetchAsBase64(url);
    console.log(
      `[carousel-templates] single inspiration ${slug}: ${img ? 'LOADED from S3 (org-assets)' : 'NOT found at S3 (→ text-layout fallback)'}`
    );
    return img;
  } catch (e) {
    console.warn(
      `[carousel-templates] single inspiration ${slug}: load threw → text-layout fallback (${e instanceof Error ? e.message : String(e)})`
    );
    return null;
  }
}
