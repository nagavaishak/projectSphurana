/**
 * ONE named policy for where a graphic's imagery comes from, and ONE typed
 * answer for what was actually chosen.
 *
 * ## Why this exists
 *
 * Imagery used to be controlled by four independent booleans — `allowAiImages`,
 * `allowStockImages`, `preferStockImage`, `suppressSubjectPhoto` — spread across
 * six schemas. That is sixteen states, most of them meaningless, several
 * unreachable, and two of them coupled to a single CLI flag so they could not be
 * varied independently even on purpose. Nobody could enumerate them, so nobody
 * tested them, and the one combination that mattered (stock off, AI on) had
 * never been run.
 *
 * Worse, the booleans did not survive the journey. `resolveSlotImage` knows
 * exactly which of three tiers produced a picture, and the caller collapsed that
 * into `usedServiceMedia: boolean` before building the prompt — at which point a
 * curated stock still and the client's own photograph became indistinguishable.
 * The prompt then described whatever it got as "the REAL service photo — do not
 * invent a different scene", so a stock IV drip was pinned into a cryotherapy
 * facial deck with an instruction to match its crop. The model obeyed; there was
 * nothing else to obey.
 *
 * So: a policy is a NAMED CHOICE from a closed set, and a source is a TAGGED
 * UNION that keeps its provenance all the way to the prompt.
 */

import { z } from 'zod';

/**
 * Where a graphic may take its imagery from, in preference order.
 *
 * Every policy tries the org's own linked assets FIRST — a real photograph of
 * the actual business always wins. They differ only in what happens when the
 * org has none, which for 88 of 93 services on a real production org is the
 * normal case rather than the edge one.
 */
export const imageryPolicyLabels = {
  /**
   * The org's own photos, or nothing. The layout's photographic area becomes a
   * brand-colour panel. Honest, and often better than the alternatives for a
   * type-led brand.
   */
  'own-only': "Only the business's own photos",
  /**
   * The org's own photos, then the curated stock library. The historical
   * default. Good when the library actually covers the technique, poor when it
   * falls through to the generic pool.
   */
  'own-then-stock': "The business's own photos, then curated stock",
  /**
   * The org's own photos, then let the graphic model invent fitting imagery.
   *
   * Stock is SKIPPED entirely — that is the whole point of this policy and the
   * combination that had never been tested. Previously "allow AI images" left
   * the stock tier firing first, so the model received an irrelevant stock
   * photograph AND permission to invent, and the concrete image won every time.
   */
  'own-then-ai': "The business's own photos, then AI-generated imagery",
  /**
   * The org's own photos, then curated stock IF IT ACTUALLY MATCHES the
   * service, then AI-generated imagery.
   *
   * The suitability test is deliberately strict: only a clip the matcher linked
   * to this service by technique counts. The ambient/generic pool does not —
   * it answers almost always and frequently with something unrelated (an IV
   * drip, a syringe and IV bags all arrived for a cryotherapy facial), so a
   * fallback keyed on stock returning NOTHING would effectively never fire.
   *
   * This is the "no suitable stock, so invent something" behaviour: real photo
   * first, a genuinely relevant stock still second, an invented image third,
   * and an unrelated stock photograph never.
   */
  'own-then-stock-then-ai':
    "The business's own photos, then matching stock, then AI-generated imagery",
  /**
   * No photography at all — not the org's, not stock, not invented. Type,
   * colour and shape only.
   */
  'text-led': 'No photography — text-led',
} as const;

export const imageryPolicyValues = Object.keys(
  imageryPolicyLabels
) as (keyof typeof imageryPolicyLabels)[];

export type ImageryPolicy = keyof typeof imageryPolicyLabels;

/** Zod form, for the service schemas that accept a policy directly. */
export const imageryPolicySchema = z.enum(
  imageryPolicyValues as [ImageryPolicy, ...ImageryPolicy[]]
);

/** Whether this policy permits the curated stock tier to fill a slot. */
export const policyAllowsStock = (p: ImageryPolicy): boolean =>
  p === 'own-then-stock' || p === 'own-then-stock-then-ai';

/**
 * Whether this policy accepts a stock still from the ambient/generic pool.
 *
 * `own-then-stock` does (it has nothing better to fall back on). The
 * AI-backstopped policy does not — an unrelated photograph is worse than an
 * invented one that fits.
 */
export const policyAcceptsGenericStock = (p: ImageryPolicy): boolean =>
  p === 'own-then-stock';

/** Whether this policy permits invented imagery when no real photo exists. */
export const policyAllowsAi = (p: ImageryPolicy): boolean =>
  p === 'own-then-ai' || p === 'own-then-stock-then-ai';

/** Whether this policy permits the org's own linked assets. */
export const policyAllowsOwnAssets = (p: ImageryPolicy): boolean =>
  p !== 'text-led';

/**
 * Derive the policy from the legacy boolean columns.
 *
 * `graphic.allow_ai_images` / the various `allowStockImages` inputs are still
 * how this is persisted and how the API receives it, and changing that is a
 * migration on a table whose previous migration is not yet in production. So
 * the booleans stay at the EDGE and are interpreted exactly once — here. Every
 * layer inside image-generation takes an `ImageryPolicy`.
 *
 * Precedence matches the old tier order so this is behaviour-preserving for
 * every existing caller EXCEPT the one case that was already broken: with AI
 * allowed and stock allowed, the old code ran stock first and never reached AI.
 * That combination now resolves to `own-then-ai`, because a caller asking for
 * AI imagery meant it.
 */
export function imageryPolicyFromLegacyFlags(args: {
  allowAiImages?: boolean;
  allowStockImages?: boolean;
  /** Hard override — the layout has no photographic area at all. */
  suppressSubjectPhoto?: boolean;
}): ImageryPolicy {
  if (args.suppressSubjectPhoto) return 'text-led';
  // Both permitted → matching stock first, AI as the backstop. Stock that
  // actually depicts the technique beats an invention; stock that does not is
  // worse than one.
  if (args.allowAiImages && args.allowStockImages !== false) {
    return 'own-then-stock-then-ai';
  }
  if (args.allowAiImages) return 'own-then-ai';
  // Undefined means "not specified", and stock has always been on by default.
  if (args.allowStockImages !== false) return 'own-then-stock';
  return 'own-only';
}

/**
 * What a slot resolution actually produced, with its provenance intact.
 *
 * The `kind` is the load-bearing field: it is what the prompt builder switches
 * on to decide how to DESCRIBE the image to the model. A photograph the client
 * uploaded and a stock clip from a shared library are different claims about
 * the world, and the prompt must not call them the same thing.
 */
export type ImagerySource =
  /** A photo or video frame the org uploaded and linked to this service. */
  | {
      kind: 'org-asset';
      url: string;
      assetId: string;
      /** True when this came from a video's thumbnail rather than a still. */
      isVideoFrame: boolean;
      candidateAssetIds: string[];
      rotationPoolSize: number;
      excludedForQuality: number;
    }
  /** A still from the shared curated stock library. NOT this business's own. */
  | {
      kind: 'stock';
      url: string;
      stockClipId: string;
      /** Whether the clip actually matches the service, or is ambient filler. */
      matchSource: 'service-match' | 'generic';
    }
  /** A separately generated image, uploaded and handed to the renderer. */
  | { kind: 'ai-fill'; url: string }
  /** No image supplied; the graphic model is free to author its own. */
  | { kind: 'model-invented' }
  /** No image, and none may be invented — the graphic stays text-led. */
  | { kind: 'none' };

export type ImagerySourceKind = ImagerySource['kind'];

/**
 * Whether this source puts an actual bitmap in front of the model.
 *
 * Deliberately NOT called `hasServiceMedia`. The old name asserted the image
 * belonged to the business, and three of the four sources it returned `true`
 * for did not.
 */
export const sourceSuppliesImage = (
  s: ImagerySource
): s is Extract<ImagerySource, { url: string }> =>
  s.kind === 'org-asset' || s.kind === 'stock' || s.kind === 'ai-fill';

/** Whether the image, if any, genuinely depicts THIS business. */
export const sourceIsAuthentic = (s: ImagerySource): boolean =>
  s.kind === 'org-asset';
