/**
 * Helper for assembling `/assistant?prefill=<prompt>&entityType=<type>&entityId=<id>`
 * URLs used by per-feature "Ask Claire" entry points (W-C18 Cross-app entry points).
 *
 * The `/assistant` page (W-C01-C) consumes `?prefill=` to seed the composer.
 * `entityType` + `entityId` ride along but are not yet wired into backend context
 * injection — that lands in the `c18-page-integrations` window.
 */

/**
 * Runtime list of supported entity types — used by `/assistant` page.tsx
 * (W-C18 page-integrations) to validate URL params before forwarding to the
 * controller. Derived as the source of truth for the type union below so the
 * two can never drift.
 *
 * Forward-compat note: `appointment` and `offer` are listed but not yet
 * surfaced in the UI (no detail surface in v3). Kept on the union so future
 * windows can wire entry points without a coordination change here.
 */
export const CLAIRE_PREFILL_ENTITY_TYPES = [
  'lead',
  'appointment',
  'ad',
  'meta_campaign',
  'offer',
  'conversation',
  // A post in the bulk-content queue. The review page runs the ordinary
  // assistant chat now, so "which post are we talking about" has to reach
  // Claire the same way every other entity does.
  'content_item',
] as const;

export type ClairePrefillEntityType =
  (typeof CLAIRE_PREFILL_ENTITY_TYPES)[number];

/** Type guard for a string that may have come from a URL query param. */
export function isClairePrefillEntityType(
  value: string
): value is ClairePrefillEntityType {
  return (CLAIRE_PREFILL_ENTITY_TYPES as readonly string[]).includes(value);
}

export interface ClairePrefillOptions {
  entityType?: ClairePrefillEntityType;
  entityId?: string;
}

/**
 * Cap on the user-visible prompt fragment. URL-encoded prompts can multiply
 * in length (every space → `%20`, every accented char → 6 chars), so 500
 * "raw" chars is well under the ~2000-char practical limit while still
 * generous enough for any realistic pre-fill text.
 */
export const CLAIRE_PREFILL_PROMPT_MAX_LENGTH = 500;

/**
 * Builds a URL string that opens `/assistant` with the composer pre-filled.
 *
 * - Trims whitespace.
 * - Returns `/assistant` (no querystring) for empty / whitespace-only prompts.
 * - Caps the prompt at `CLAIRE_PREFILL_PROMPT_MAX_LENGTH`, ending with `…`
 *   when truncated.
 * - Drops `entityType` / `entityId` from the URL when not provided.
 *
 * @example
 * router.push(buildClairePrefillUrl('Tell me about this lead', {
 *   entityType: 'lead',
 *   entityId: 'abc123',
 * }));
 */
export function buildClairePrefillUrl(
  prompt: string,
  options?: ClairePrefillOptions
): string {
  const trimmed = prompt.trim();
  if (!trimmed) return '/assistant';

  const capped =
    trimmed.length > CLAIRE_PREFILL_PROMPT_MAX_LENGTH
      ? `${trimmed.slice(0, CLAIRE_PREFILL_PROMPT_MAX_LENGTH - 1)}…`
      : trimmed;

  const params = new URLSearchParams();
  params.set('prefill', capped);
  if (options?.entityType) params.set('entityType', options.entityType);
  if (options?.entityId) params.set('entityId', options.entityId);
  return `/assistant?${params.toString()}`;
}

/**
 * TanStack Router search object for `/assistant` — same caps/validation as
 * `buildClairePrefillUrl` without stringifying the query.
 */
export function buildClairePrefillSearch(
  prompt: string,
  options?: ClairePrefillOptions
): {
  prefill?: string;
  entityType?: ClairePrefillEntityType;
  entityId?: string;
} {
  const trimmed = prompt.trim();
  if (!trimmed) return {};

  const capped =
    trimmed.length > CLAIRE_PREFILL_PROMPT_MAX_LENGTH
      ? `${trimmed.slice(0, CLAIRE_PREFILL_PROMPT_MAX_LENGTH - 1)}…`
      : trimmed;

  return {
    prefill: capped,
    ...(options?.entityType ? { entityType: options.entityType } : {}),
    ...(options?.entityId ? { entityId: options.entityId } : {}),
  };
}
