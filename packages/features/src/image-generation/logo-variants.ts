/**
 * Brand-logo handling for the AI graphic engine.
 *
 * THE MARK IS NEVER ALTERED. This file used to mint an opposite-polarity copy
 * by RGB-inverting the logo, so a light and a dark version were always
 * available and each slide got whichever contrasted with its background.
 *
 * RGB inversion is only a POLARITY operation for an achromatic mark. For a
 * coloured one it changes the HUE, and it had been silently doing that in
 * production. Measured on the real assets:
 *
 *   Miso Life          #d2ac54 gold       → #2d53ab  BLUE
 *   Skin from Brazil   #ecf1e9 near-white → #130e16  near-black (correct)
 *
 * So every Miso Life graphic was handed a BLUE monogram labelled as their
 * brand mark, and scored 0-2 of 9 on logo fidelity while Skin from Brazil —
 * whose mark is achromatic, and therefore inverted correctly — scored 4-5 of
 * 9 in the same runs. No prompt wording survives being given the wrong logo.
 *
 * The legibility problem inversion was solving is real: a white wordmark on a
 * cream slide reads as near-blank, and the model then re-typesets the business
 * name. But recolouring a brand's mark is not an acceptable answer to it — the
 * prompt now tells the model to place the mark where it contrasts, or on a
 * plain plate, and never to alter it. That is what a brand guideline says too.
 *
 * `light` and `dark` are therefore the SAME mark. The pair is kept so callers
 * and the stored provenance shape do not change; `pickLogoForBackground` still
 * exists and now always returns that one mark.
 *
 * Transparency RECOVERY is unaffected and still runs — stripping a flat page
 * background off a JPEG logo restores the mask everything else measures, and
 * that never altered the mark's colours.
 */

import { organization } from '@borradh-workspace/database';
import { createLogger, logError } from '@borradh-workspace/observability';
import { exists, parseS3Url, upload } from '@borradh-workspace/storage';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { type DbConnection, notDeleted } from '../shared/index.js';
import type { GeminiImageInput } from './gemini-image.js';
import { resolveReferenceImageUrl } from './resolve-reference-image-urls.js';

const logger = createLogger('LogoVariants');

/** Cap the logo's longest edge — crisp enough to reproduce, bounded payload. */
const LOGO_MAX_EDGE = 1600;

export interface LogoVariants {
  /** A LIGHT-coloured logo — place on DARK backgrounds. Null if unavailable. */
  light: GeminiImageInput | null;
  /** A DARK-coloured logo — place on LIGHT backgrounds. Null if unavailable. */
  dark: GeminiImageInput | null;
}

/** Rec. 709 relative luminance for an 8-bit RGB triple, normalised to 0..1. */
function luma(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Mean luminance (0..1) of an image, flattening any alpha away first. */
async function backgroundLuminance(buf: Buffer): Promise<number> {
  const stats = await sharp(buf).removeAlpha().stats();
  const [r, g, b] = stats.channels.map((c) => c.mean);
  return luma(r, g, b);
}

/**
 * How close a pixel must be to the sampled border colour to count as
 * background. Generous, because JPEG compression smears a flat white ground
 * into a range of near-whites rather than one exact value.
 */
const BACKGROUND_TOLERANCE = 0.06;

/**
 * Does this image's alpha channel actually MASK anything?
 *
 * `meta.hasAlpha` only says a channel EXISTS. Exporters routinely write a
 * fully-opaque alpha channel, and both recovery paths read that as "already
 * masked" and skipped. Measured across production: 59 orgs have a logo, only 7
 * have real transparency, 52 carry a baked-in background — and 28 of those 52
 * were INVISIBLE to the old check, more than half the population this recovery
 * code was written for. Their mark reached the model inside an opaque white
 * rectangle, and on a dark slide the model had to either draw the box or redraw
 * the mark.
 */
const MIN_CLEAR_SHARE = 0.01;
const ALPHA_SAMPLE_EDGE = 96;

async function hasRealTransparency(buf: Buffer): Promise<boolean> {
  try {
    const meta = await sharp(buf).metadata();
    if (!meta.hasAlpha) return false;
    const { data, info } = await sharp(buf)
      .resize(ALPHA_SAMPLE_EDGE, ALPHA_SAMPLE_EDGE, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let clear = 0;
    let total = 0;
    for (let i = 0; i + 3 < data.length; i += info.channels) {
      if (data[i + 3] < 16) clear++;
      total++;
    }
    return total > 0 && clear / total >= MIN_CLEAR_SHARE;
  } catch {
    // Unreadable: treat as already-masked so recovery never runs on something
    // we cannot measure. A wrong mask is worse than none.
    return true;
  }
}

/**
 * Minimum opaque pixels that must survive background removal for the result to
 * be a plausible mark. Well below any real logo (Glitter Girls' keeps ~63,000
 * from a 2.25M-pixel source) and well above the handful left when removal has
 * eaten a solid wordmark.
 */
const MIN_MARK_PIXELS = 2_000;

/**
 * Give an alpha-less logo a transparent background.
 *
 * WHY THIS IS NOT OPTIONAL
 * ------------------------
 * Every polarity decision here rests on `opaqueLuminance`, which averages only
 * the pixels alpha says are visible. A JPEG has no alpha, so `ensureAlpha()`
 * marks EVERY pixel opaque and the average becomes the whole rectangle —
 * overwhelmingly its background.
 *
 * Measured on production logos:
 *
 *   glitter girls (.jpeg)   0.0% pixels skipped   luminance 0.978
 *   Zenelle       (.jpeg)   0.0% pixels skipped   luminance 0.957
 *   ClearSkin4u   (.png)   95.4% pixels skipped   luminance 0.329
 *
 * The PNG measures its MARK; the JPEGs measure their WHITE PAGE. Both JPEGs are
 * therefore classified "light logo, save for dark backgrounds", so on a cream
 * slide the code hands the model the INVERTED copy — a near-black rectangle.
 * The model cannot reproduce that as a logo, so it re-typesets the business
 * name, which owners report as "our logo keeps being altered". 18 of 59 orgs
 * with a logo are JPEG, and they account for 46% of the last 30 days' graphics.
 *
 * Restoring alpha fixes it at the root rather than special-casing the symptom:
 * with a real mask, `opaqueLuminance`, `.trim()` and inversion all resume
 * measuring the mark, and nothing downstream needs to know the source was JPEG.
 *
 * Deliberately conservative — a logo drawn on a photograph or a gradient has no
 * flat ground to remove, and a wrong mask is worse than none. When the result
 * looks implausible the original is returned unchanged.
 */
async function makeBackgroundTransparent(buf: Buffer): Promise<Buffer | null> {
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (!width || !height) return null;

  // Sample the four corners. A logo's ground reaches its corners; a mark
  // rarely does. Disagreement between corners means there is no flat ground.
  const at = (x: number, y: number) => (y * width + x) * channels;
  const corners = [
    at(0, 0),
    at(width - 1, 0),
    at(0, height - 1),
    at(width - 1, height - 1),
  ].map((i) => [data[i], data[i + 1], data[i + 2]] as const);

  const ref = corners[0];
  const consistent = corners.every(
    (c) =>
      Math.abs(luma(c[0], c[1], c[2]) - luma(ref[0], ref[1], ref[2])) <
      BACKGROUND_TOLERANCE
  );
  if (!consistent) return null;

  const out = Buffer.from(data);
  let cleared = 0;
  const total = width * height;
  for (let i = 0; i + 3 < out.length; i += channels) {
    const dr = (out[i] - ref[0]) / 255;
    const dg = (out[i + 1] - ref[1]) / 255;
    const db = (out[i + 2] - ref[2]) / 255;
    if (Math.sqrt(dr * dr + dg * dg + db * db) <= BACKGROUND_TOLERANCE) {
      out[i + 3] = 0;
      cleared++;
    }
  }

  // Sanity bounds.
  //
  // Too little cleared means there was no flat ground to remove. For the upper
  // bound, what matters is whether enough of a MARK remains — not what share
  // was cleared. A first version capped the cleared share at 95%, and it
  // rejected Glitter Girls at 97.2%: their logo is a small mark on a
  // 1125x2000 portrait field, so a very high share is correct there, and the
  // guard fired on precisely the org that prompted the fix.
  //
  // An absolute floor on surviving pixels catches the real hazard (a solid
  // wordmark on its own colour, where the "background" IS the logo and we have
  // just erased it) without punishing generous whitespace.
  const ratio = cleared / total;
  const remaining = total - cleared;
  if (ratio < 0.05 || remaining < MIN_MARK_PIXELS) return null;

  return sharp(out, { raw: { width, height, channels } }).png().toBuffer();
}

/** `images/x/123.jpeg` → `images/x/123.transparent.png`. */
function transparentKey(key: string): string {
  const dot = key.lastIndexOf('.');
  return dot > 0
    ? `${key.slice(0, dot)}.transparent.png`
    : `${key}.transparent.png`;
}

/** Trim transparent padding, cap size, emit lossless PNG (best-effort trim). */
async function normalizeLogo(buf: Buffer): Promise<Buffer> {
  const resize = { fit: 'inside' as const, withoutEnlargement: true };
  try {
    return await sharp(buf)
      .trim()
      .resize(LOGO_MAX_EDGE, LOGO_MAX_EDGE, resize)
      .png()
      .toBuffer();
  } catch {
    // .trim() throws on a uniform image — fall back to untrimmed.
    return await sharp(buf)
      .resize(LOGO_MAX_EDGE, LOGO_MAX_EDGE, resize)
      .png()
      .toBuffer();
  }
}

/** Persist the recovered transparent original, once, next to the source. */
async function persistTransparent(
  logoUrl: string,
  transparentBuf: Buffer
): Promise<void> {
  const s3 = parseS3Url(logoUrl);
  if (!s3) return;
  const key = transparentKey(s3.key);
  if (await exists({ bucket: s3.bucket, key })) return;
  await upload({
    bucket: s3.bucket,
    key,
    body: transparentBuf,
    contentType: 'image/png',
  });
}

const toInput = (buf: Buffer): GeminiImageInput => ({
  data: buf.toString('base64'),
  mediaType: 'image/png',
});

/**
 * Resolve an org's logo into both polarities. Fetches the stored logo once,
 * mints the RGB-inverted copy, classifies which is light vs dark by visible-
 * pixel luminance, and lazily persists the inverted copy to S3. Returns
 * `{ light: null, dark: null }` when the org has no logo or the fetch fails.
 */
export async function ensureLogoVariants(
  db: DbConnection,
  organizationId: string
): Promise<LogoVariants> {
  const [row] = await db
    .select({ logo: organization.logo })
    .from(organization)
    .where(and(eq(organization.id, organizationId), notDeleted(organization)))
    .limit(1);
  if (!row?.logo) return { light: null, dark: null };

  // Fetch the stored logo. Try the SIGNED URL first, then the RAW stored URL
  // (e.g. a public CDN URL that gets wrongly re-signed, or a private URL the
  // app only loads via signed cookies) — whichever the server can actually
  // GET. A logo that loads in the app but is missing here is exactly the
  // "model invents a random logo" bug, so on total failure we log loudly
  // instead of silently dropping it.
  const candidates: string[] = [];
  try {
    candidates.push(await resolveReferenceImageUrl(row.logo));
  } catch {
    // signing failed — the raw URL below is the only candidate
  }
  if (!candidates.includes(row.logo)) candidates.push(row.logo);

  let original: Buffer | null = null;
  let lastErr: unknown;
  for (const url of candidates) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) {
        lastErr = new Error(`logo fetch returned HTTP ${res.status}`);
        continue;
      }
      original = await normalizeLogo(Buffer.from(await res.arrayBuffer()));
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!original) {
    logError(
      'imageGeneration.ensureLogoVariants',
      lastErr ?? new Error('logo could not be loaded'),
      {
        feature: 'image-generation',
        extra: { organizationId, logoUrl: row.logo, candidates },
      }
    );
    return { light: null, dark: null };
  }

  // RESTORE ALPHA BEFORE ANY POLARITY DECISION.
  //
  // Everything below measures the mark through alpha. A source without it
  // (JPEG — 18 of 59 orgs with a logo, 46% of recent graphics) measures its
  // page instead, classifies backwards, and hands the model an inverted
  // rectangle. Recovering the mask here means the rest of this function is
  // unchanged and correct for every source; nothing downstream learns that the
  // original was ever alpha-less.
  //
  // `makeBackgroundTransparent` returns null whenever it cannot do this
  // safely — a logo over a photo or gradient — and then we keep the original
  // and accept imperfect polarity rather than destroying the mark.
  let source = original;
  if (!(await hasRealTransparency(original))) {
    const format = (
      await sharp(original)
        .metadata()
        .catch(() => null)
    )?.format;
    const recovered = await makeBackgroundTransparent(original).catch(
      () => null
    );
    if (recovered) {
      source = await normalizeLogo(recovered);
      await persistTransparent(row.logo, source).catch(() => {});
      logger.info('Recovered a transparent logo from a baked-in background', {
        organizationId,
        format,
      });
    } else {
      // Worth knowing: this org's logo cannot be masked, so the mark reaches
      // the model inside its own rectangle.
      logger.warn('Logo has a baked-in background that cannot be removed', {
        event: 'content.logo_no_alpha',
        organizationId,
        format,
      });
    }
  }

  // ONE mark, both slots. See the file header: minting the opposite polarity
  // by RGB inversion turned a gold monogram blue and shipped it as the brand's
  // logo for months.
  const mark = toInput(source);
  return { light: mark, dark: mark };
}

/**
 * Normalise a logo AT THE MOMENT IT BECOMES ONE — the long-term fix.
 *
 * Uploads are presigned (`generate-presigned-upload-url`), so bytes go straight
 * from the browser to S3 and never pass through us. There is therefore no
 * upload-time hook to convert at, for a direct upload or an onboarding scan
 * alike. The one moment we know a URL has become a LOGO is when
 * `organization.logo` is written — so that is where conversion belongs.
 *
 * Converting here means the stored column points at a transparent PNG and the
 * rest of the pipeline only ever sees alpha. `ensureLogoVariants`' recovery
 * then becomes a safety net for rows written before this existed, rather than
 * the mechanism — and it stops re-deriving the same mask on every render.
 *
 * ALWAYS returns a usable URL. A logo that cannot be converted (no flat ground,
 * an unreachable object, a bucket we don't own) is returned unchanged: saving
 * brand settings must never fail because an image could not be processed.
 */
export async function normalizeLogoAsset(logoUrl: string): Promise<string> {
  try {
    const s3 = parseS3Url(logoUrl);
    // Not an object we control — a CDN alias or an external URL. Leave it.
    if (!s3) return logoUrl;

    const fetchUrl = await resolveReferenceImageUrl(logoUrl).catch(
      () => logoUrl
    );
    const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return logoUrl;

    const buf = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buf).metadata();
    // A masked logo is the shape the pipeline expects. MEASURED, not inferred
    // from the channel's existence — see `hasRealTransparency`.
    if (await hasRealTransparency(buf)) return logoUrl;

    const recovered = await makeBackgroundTransparent(buf);
    if (!recovered) {
      logger.warn('Logo has no alpha and no removable background', {
        event: 'content.logo_no_alpha',
        format: meta.format,
      });
      return logoUrl;
    }

    const key = transparentKey(s3.key);
    await upload({
      bucket: s3.bucket,
      key,
      body: await normalizeLogo(recovered),
      contentType: 'image/png',
    });

    logger.info('Normalised an alpha-less logo to a transparent PNG', {
      format: meta.format,
      key,
    });
    return logoUrl.replace(s3.key, key);
  } catch (error) {
    // Never block a settings save on image processing.
    logError('imageGeneration.normalizeLogoAsset', error, {
      feature: 'image-generation',
      extra: { logoUrl },
    });
    return logoUrl;
  }
}

/**
 * Pick the logo polarity that contrasts with a background of the given
 * luminance (0..1): a dark background wants the light logo and vice-versa.
 * Falls back to whichever variant exists when only one is available.
 */
export function pickLogoForBackground(
  variants: LogoVariants,
  backgroundLuminance: number
): GeminiImageInput | null {
  // Both slots hold the same mark now (see the file header), so the background
  // no longer selects anything. Kept as a function because callers pass a
  // measured luminance and the shape is worth preserving if a legitimate
  // second lockup — an actual brand-supplied reversed version, not one we
  // invented — is ever stored.
  void backgroundLuminance;
  return variants.light ?? variants.dark ?? null;
}

/** Mean luminance (0..1) of a base64-encoded image, for background detection. */
export async function imageLuminanceFromBase64(
  base64: string
): Promise<number> {
  try {
    return await backgroundLuminance(Buffer.from(base64, 'base64'));
  } catch {
    return 1; // assume light on failure (the common brand background)
  }
}
