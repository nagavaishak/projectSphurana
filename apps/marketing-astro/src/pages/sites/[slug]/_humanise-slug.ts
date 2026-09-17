/**
 * "luminous-hair-beauty" → "Luminous Hair Beauty".
 *
 * Was copy-pasted into six page frontmatters; hoisted here when the branch
 * segment moved, because the interesting thing about it is now WHERE IT MUST
 * NOT BE USED. It is only ever correct on an ORG slug, which is non-null and
 * always human-derived. A BRANCH segment is `slug ?? id`, and running this over
 * a cuid produces a confident "Ib0go2zlh69el42bc6dm06jq" in a page title. The
 * API knows the branch's real name; ask it rather than guessing from the URL.
 */
export function humaniseSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
