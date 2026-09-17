/**
 * Content type values that should not be shown as tags.
 * These are already displayed in their own "Content Type" section.
 */
const CONTENT_TYPE_TAGS = new Set([
  'talking_head',
  'talking-head',
  'b_roll',
  'b-roll',
  'procedure',
  'environment',
  'testimonial',
  'result',
  'other',
]);

/**
 * Filters out deprecated content-type tags that shouldn't be displayed.
 * Content type is shown separately via the analysis contentType field.
 */
export function filterDisplayTags(tags: string[]): string[] {
  return tags.filter((tag) => !CONTENT_TYPE_TAGS.has(tag.toLowerCase()));
}

/**
 * Formats a stored tag into a reader-friendly display string.
 * e.g. "outdoor-photography" → "Outdoor Photography"
 *      "Body_contouring" → "Body Contouring"
 */
export function formatTag(tag: string): string {
  return tag
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
