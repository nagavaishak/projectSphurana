import type {
  PendingClipOperation,
  PendingVideoEdits,
  VideoDraftConfig,
} from '@borradh-workspace/database';

import {
  activeTemplateKey,
  templateTextFields,
} from '../../../videos/index.js';

// Re-exported so callers that already import them from here are untouched.
export {
  activeTemplateKey,
  templateTextFields,
  type TemplateConfigKey,
} from '../../../videos/index.js';

export type TextPatchResult =
  | { ok: true; patch: Record<string, unknown>; summary: string }
  | { ok: false; reason: string };

/**
 * Turn a model-chosen field + value into a deep-mergeable patch, or refuse.
 *
 * Refusing is the point. The model names a field; this checks that the field
 * actually exists on the ACTIVE template and already holds text of the shape
 * being written. A name it invented, a field on some other object, or an index
 * past the end of a list all fail here rather than reaching `patchDraftConfig`,
 * where a deep merge would happily create whatever key it was handed.
 */
export function buildTextPatch(
  draftConfig: VideoDraftConfig | null | undefined,
  field: string,
  value: string,
  index?: number
): TextPatchResult {
  const key = activeTemplateKey(draftConfig);
  if (!key) {
    return { ok: false, reason: 'this video has no editable on-screen text' };
  }

  const fields = templateTextFields(draftConfig);
  const current = fields[field];
  if (current === undefined) {
    return {
      ok: false,
      reason: `"${field}" is not a text field on this video`,
    };
  }

  if (Array.isArray(current)) {
    if (index === undefined || index < 0 || index >= current.length) {
      return {
        ok: false,
        reason: `"${field}" has ${current.length} line${current.length === 1 ? '' : 's'}, so line ${(index ?? 0) + 1} does not exist`,
      };
    }
    if (current[index] === value) {
      // Nothing to do. Staging a no-op would light up the Apply button and
      // spend a render to produce a byte-identical video — and the reply would
      // claim a change the owner then could not find.
      return {
        ok: false,
        reason: `line ${index + 1} already reads "${value}"`,
      };
    }
    const next = [...current];
    next[index] = value;
    return {
      ok: true,
      patch: { [key]: { [field]: next } },
      // `field` is omitted for the common `lines` array — "lines line 2" reads
      // like a typo, and the owner counts lines on screen, not field names.
      summary:
        field === 'lines'
          ? `line ${index + 1} → "${value}"`
          : `${field} line ${index + 1} → "${value}"`,
    };
  }

  if (current === value) {
    return { ok: false, reason: `${field} already reads "${value}"` };
  }

  return {
    ok: true,
    patch: { [key]: { [field]: value } },
    summary: `${field} → "${value}"`,
  };
}

/**
 * The draft as it will read ONCE THE STAGED PATCH IS APPLIED.
 *
 * Every text edit is built by snapshotting a whole field off the draft and
 * writing one element back, and `mergePatches` replaces arrays wholesale rather
 * than merging them. So building the second edit against the RAW draft — which
 * still lacks the first, because staged edits have not been rendered yet —
 * produces an array with edit 1 missing, and that array wins. Two edits before
 * one Apply silently reverted the first, and the thread showed both as staged.
 *
 * Building against this instead makes the edits accumulate, which is what the
 * owner is told is happening.
 */
export function draftWithStagedPatch(
  draftConfig: VideoDraftConfig | null | undefined,
  patch: Record<string, unknown>
): VideoDraftConfig | null {
  if (!draftConfig) return null;
  if (!patch || Object.keys(patch).length === 0) return draftConfig;

  const merged: Record<string, unknown> = { ...draftConfig };
  for (const [key, value] of Object.entries(patch)) {
    const existing = merged[key];
    merged[key] =
      existing &&
      typeof existing === 'object' &&
      !Array.isArray(existing) &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
        ? { ...(existing as object), ...(value as object) }
        : value;
  }
  // The patch is model-shaped `Record<string, unknown>`, so there is no
  // structural overlap for TS to check against. Everything read back out of
  // this goes through `templateTextFields` / `buildTextPatch`, which validate
  // shape per field rather than trusting the cast.
  return merged as unknown as VideoDraftConfig;
}

const EMPTY_EDITS: PendingVideoEdits = { clipOperations: [], patch: {} };

/**
 * Read the `pending_video_edits` column back into a shape worth trusting.
 *
 * The column is untyped jsonb (the response-contract generator emits
 * `z.unknown()` for jsonb, so a `$type<>` annotation would put the row type and
 * its generated atom out of step). It also holds output that originated with a
 * model. Validating on read rather than asserting is the right trade for both.
 */
export function parsePendingVideoEdits(value: unknown): PendingVideoEdits {
  if (!value || typeof value !== 'object') return EMPTY_EDITS;

  const raw = value as { clipOperations?: unknown; patch?: unknown };
  const clipOperations: PendingClipOperation[] = [];

  if (Array.isArray(raw.clipOperations)) {
    for (const entry of raw.clipOperations) {
      if (!entry || typeof entry !== 'object') continue;
      const op = entry as Record<string, unknown>;
      // `replace-all` FIRST — it is the only operation with no `index`, and the
      // guard below drops anything without one. Ordering it after that guard
      // silently discarded every list the clip editor staged: the write landed,
      // every read came back empty, so the card showed the old cut and Accept
      // reported there was nothing to render.
      if (op.op === 'replace-all') {
        if (
          Array.isArray(op.assetIds) &&
          op.assetIds.length > 0 &&
          op.assetIds.every((id) => typeof id === 'string' && id.length > 0)
        ) {
          clipOperations.push({
            op: 'replace-all',
            assetIds: op.assetIds as string[],
          });
        }
        continue;
      }
      if (typeof op.index !== 'number') continue;
      if (op.op === 'remove') {
        clipOperations.push({ op: 'remove', index: op.index });
      } else if (op.op === 'swap' && typeof op.assetId === 'string') {
        clipOperations.push({
          op: 'swap',
          index: op.index,
          assetId: op.assetId,
        });
      }
    }
  }

  const patch =
    raw.patch && typeof raw.patch === 'object' && !Array.isArray(raw.patch)
      ? (raw.patch as Record<string, unknown>)
      : {};

  return { clipOperations, patch };
}

/** Deep-merge two narrow config patches (one level of nesting is all we emit). */
export function mergePatches(
  base: Record<string, unknown>,
  next: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(next)) {
    const existing = merged[key];
    merged[key] =
      existing &&
      typeof existing === 'object' &&
      !Array.isArray(existing) &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
        ? { ...(existing as object), ...(value as object) }
        : value;
  }
  return merged;
}

export const hasStagedEdits = (edits: PendingVideoEdits): boolean =>
  edits.clipOperations.length > 0 || Object.keys(edits.patch).length > 0;
