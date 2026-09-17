/**
 * Normalisation + similarity helpers for the Claire action-intent dedupe
 * (Phase 4). Kept pure and dependency-free so both the recorder and the
 * similarity check derive keys the exact same way — a drift between the two
 * would silently defeat the dedupe.
 */

/**
 * Lowercase, strip punctuation to spaces, collapse whitespace. The stored
 * `normalizedKey` and the proposed key are both run through this so the
 * comparison is casing/punctuation-insensitive.
 */
export function normalizeActionKey(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Distinct word tokens of a normalised string. */
export function tokenize(input: string): Set<string> {
  const normalized = normalizeActionKey(input);
  if (!normalized) return new Set();
  return new Set(normalized.split(' '));
}

/**
 * Jaccard similarity of two token sets: |∩| / |∪|. Returns 0 when either
 * side is empty (nothing to compare ⇒ not similar).
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
