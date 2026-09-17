import { assetLibraryListingSchema } from '@borradh-workspace/contracts';
import { z } from 'zod';
import type { AssistantToolsContext } from '../../tool-factory/types.js';

/**
 * No-silent-substitution contract (Phase 7, findings #37 #150 #151 #217).
 *
 * When the owner references one of their OWN uploaded assets in words ("use my
 * Endosphere photo", "run the picture I uploaded"), Claire must NOT:
 *   - guess an asset ID (#37 invented `PRad.png` three times), or
 *   - silently generate a new AI image and pass it off as theirs (#150 #151).
 *
 * This helper is the enforcement point. A tool that can carry an owner asset
 * exposes `assetRefInputFields` on its input schema and calls
 * `resolveAssetReference` before proceeding. The outcome is a small union the
 * tool branches on:
 *
 *   - `proceed`    — nothing was referenced, the model already resolved a
 *                    concrete creative ID, or (generate tools only) the owner
 *                    explicitly opted into a fresh AI asset via `generateNew`.
 *   - `resolved`   — exactly one library asset matched the reference by name /
 *                    filename; safe to attach it directly.
 *   - `unresolved` — a reference was given but did not resolve to a single
 *                    asset. The tool returns the carried `data` so Claire shows
 *                    the candidates and asks — it must never guess or generate.
 *
 * The candidate search rides `GET /assets?search=` (name + filename ilike),
 * whitelisted via the plain `assets` pattern.
 */

/** Fields to spread into a tool's `z.object({...})` input schema. */
export const assetRefInputFields = {
  assetRef: z
    .string()
    .min(1)
    .optional()
    .describe(
      'The owner\'s own words for an asset they want used (e.g. "my ' +
        'Endosphere photo", "the before picture I uploaded"). Pass this ' +
        'INSTEAD of guessing an id when the owner referenced one of their own ' +
        'uploaded images/videos but you have not resolved its id yet. The tool ' +
        'searches the media library by name/filename and either attaches the ' +
        'single match or returns candidates for the owner to pick — it never ' +
        'guesses. Do NOT pass this together with a resolved videoId/graphicId/' +
        'assetId.'
    ),
  generateNew: z
    .boolean()
    .optional()
    .describe(
      'Set true ONLY when the owner explicitly asked for a NEW AI-generated ' +
        'asset instead of one of their own uploads (e.g. "no, just generate ' +
        'one"). Required to generate when the owner had referenced their own ' +
        'asset — otherwise the tool refuses to substitute and asks first. Has ' +
        'no effect when no assetRef was given.'
    ),
};

export interface AssetCandidate {
  id: string;
  name: string;
  thumbnailUrl: string | null;
  blobUrl: string | null;
}

/**
 * The output payload a tool returns verbatim when a reference is unresolved.
 * `assetUnresolved` is the honest-state discriminator; the frontend and the
 * skills key off it, and `message` is the line Claire relays.
 */
export interface AssetUnresolvedOutput {
  assetUnresolved: {
    assetRef: string;
    candidates: AssetCandidate[];
  };
  message: string;
}

export type AssetRefResolution =
  | { outcome: 'proceed' }
  | { outcome: 'resolved'; assetId: string }
  | { outcome: 'unresolved'; data: AssetUnresolvedOutput };

interface ResolveOptions {
  assetRef?: string;
  generateNew?: boolean;
  /**
   * True when the model already supplied a concrete creative id
   * (videoId/graphicId/assetId). A resolved creative always wins — the ref is
   * ignored.
   */
  hasResolvedCreative: boolean;
  /**
   * `attach` (ad tools): a single name match resolves to an assetId the tool
   * attaches directly. `generate` (graphic tools): the tool can only produce a
   * NEW AI asset, so it never resolves to an id — a reference to an existing
   * asset is always `unresolved` unless `generateNew` was set.
   */
  mode: 'attach' | 'generate';
  /** Restrict the candidate search to a media type when known. */
  type?: 'image' | 'video';
  /** Max candidates to surface. */
  limit?: number;
}

async function searchLibrary(
  ctx: AssistantToolsContext,
  assetRef: string,
  type: 'image' | 'video' | undefined,
  limit: number
): Promise<AssetCandidate[]> {
  const params = new URLSearchParams({
    search: assetRef,
    limit: String(limit),
  });
  if (type) params.set('type', type);
  const data = await ctx.apiFetch(`assets?${params.toString()}`, {
    schema: assetLibraryListingSchema,
  });
  return data.items.map((a) => ({
    id: a.id,
    name: a.name,
    thumbnailUrl: a.thumbnailUrl ?? null,
    blobUrl: a.blobUrl ?? null,
  }));
}

/**
 * Resolve an owner asset reference, or refuse to substitute. See the module
 * docstring. Never throws for the "no results" case — search failures fall
 * through to an `unresolved` payload with an actionable message, because the
 * one thing this contract forbids is proceeding on a guess.
 */
export async function resolveAssetReference(
  ctx: AssistantToolsContext,
  opts: ResolveOptions
): Promise<AssetRefResolution> {
  const assetRef = opts.assetRef?.trim();
  if (!assetRef) return { outcome: 'proceed' };
  // The model already resolved a real creative id — honour it, ignore the ref.
  if (opts.hasResolvedCreative) return { outcome: 'proceed' };
  // Generate tools: explicit opt-in to a fresh AI asset overrides the ref.
  if (opts.mode === 'generate' && opts.generateNew === true) {
    return { outcome: 'proceed' };
  }

  let candidates: AssetCandidate[] = [];
  try {
    candidates = await searchLibrary(ctx, assetRef, opts.type, opts.limit ?? 5);
  } catch (error) {
    ctx.reportIssue('Failed to search library for asset reference', {
      error,
      extra: { assetRef },
    });
    // Fall through to unresolved with no candidates — asking is always safe;
    // guessing is the failure this contract exists to prevent.
  }

  // Attach mode: a single unambiguous match is safe to use directly. An exact
  // (case-insensitive) name match also wins even amid other partials.
  if (opts.mode === 'attach') {
    const exact = candidates.filter(
      (c) => c.name.toLowerCase() === assetRef.toLowerCase()
    );
    if (exact.length === 1 && exact[0]) {
      return { outcome: 'resolved', assetId: exact[0].id };
    }
    if (candidates.length === 1 && candidates[0]) {
      return { outcome: 'resolved', assetId: candidates[0].id };
    }
  }

  return {
    outcome: 'unresolved',
    data: {
      assetUnresolved: { assetRef, candidates },
      message: buildUnresolvedMessage(assetRef, candidates, opts.mode),
    },
  };
}

function buildUnresolvedMessage(
  assetRef: string,
  candidates: AssetCandidate[],
  mode: 'attach' | 'generate'
): string {
  if (candidates.length === 0) {
    const suffix =
      mode === 'generate'
        ? " Or say “just generate one” and I'll create a new one instead."
        : '';
    return (
      `I couldn't find an uploaded asset matching “${assetRef}” in your ` +
      `library. Double-check the name, or upload it first.${suffix}`
    );
  }
  const names = candidates
    .slice(0, 5)
    .map((c) => `“${c.name}”`)
    .join(', ');
  const tail =
    mode === 'generate'
      ? ' — or say “just generate one” to create a new AI graphic instead.'
      : '.';
  return (
    `I found more than one asset that could be “${assetRef}”: ${names}. ` +
    `Which one should I use?${tail}`
  );
}
