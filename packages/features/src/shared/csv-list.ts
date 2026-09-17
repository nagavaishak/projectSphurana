import { z } from 'zod';

/**
 * A list field that also accepts the comma-separated form an HTTP query string
 * carries (`?tags=%20before%20,,%20nothing` → `['before', 'nothing']`).
 *
 * Whitespace is trimmed and empty segments dropped; a string that yields nothing
 * becomes `undefined`, i.e. "no filter". Non-string input (a real array) passes
 * straight through, so existing programmatic callers are unaffected.
 *
 * This lives on the SCHEMA rather than in a controller: query-string shape is an
 * input concern of the use case, and putting it here means the API layer, Claire
 * tools and workers all parse it identically.
 */
export const csvList = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const parts = value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    return parts.length > 0 ? parts : undefined;
  }, z.array(item));
