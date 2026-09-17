/**
 * Campaign merge-field interpolation with fallbacks.
 *
 * Unlike the sequence `interpolateMessage` (which blanks a missing field — the
 * dreaded "Hi ,"), this supports a default after a pipe: `{{firstName|there}}`
 * renders "there" when firstName is missing/empty. Whitespace inside the braces
 * is tolerated: `{{ firstName | there }}`.
 */

export type MergeData = Record<string, string | number | null | undefined>;

// {{ key }} or {{ key | fallback text }}
const MERGE_RE = /\{\{\s*(\w+)\s*(?:\|([^}]*))?\}\}/g;

const isPresent = (value: MergeData[string]): value is string | number =>
  value !== undefined && value !== null && String(value).trim() !== '';

/**
 * Replace `{{field}}` / `{{field|fallback}}` tokens. A field is "missing" when
 * absent, null, or whitespace-only — in which case the fallback (or empty
 * string) is used.
 */
export function interpolateCampaignBody(
  template: string,
  data: MergeData
): string {
  return template.replace(
    MERGE_RE,
    (_match, key: string, fallback?: string) => {
      const value = data[key];
      if (isPresent(value)) return String(value);
      return (fallback ?? '').trim();
    }
  );
}

/** The distinct merge-field names referenced by a template. */
export function extractMergeFields(template: string): string[] {
  const fields = new Set<string>();
  for (const match of template.matchAll(MERGE_RE)) {
    fields.add(match[1]);
  }
  return [...fields];
}

/**
 * Fields referenced WITHOUT a fallback — these are the ones that can render
 * blank for a lead missing the value. Used to warn the author at save time
 * (e.g. "firstName has no fallback; 12% of this segment has no first name").
 */
export function fieldsWithoutFallback(template: string): string[] {
  const risky = new Set<string>();
  for (const match of template.matchAll(MERGE_RE)) {
    const hasFallback = match[2] !== undefined && match[2].trim() !== '';
    if (!hasFallback) risky.add(match[1]);
  }
  return [...risky];
}

/** Merge fields referenced by the template that aren't in the allowed set. */
export function unknownMergeFields(
  template: string,
  allowed: readonly string[]
): string[] {
  const allowedSet = new Set(allowed);
  return extractMergeFields(template).filter((f) => !allowedSet.has(f));
}
