/**
 * `update_block` takes a PATCH, not a replacement (contract §2).
 *
 * "Full-replace makes the model re-emit content it never intended to touch and
 * silently drop fields — this is the single most important shape in the tool
 * set." So the merge below is the load-bearing half of that decision:
 *
 *   - keys ABSENT from the patch keep their current value;
 *   - a key set to `null` is an explicit CLEAR (the model needs some way to
 *     remove an optional field, and omitting it means "leave alone");
 *   - arrays REPLACE rather than concatenate — `categoryNames: ['Facials']`
 *     means those categories, not "add Facials to whatever was there";
 *   - nested plain objects merge recursively, which matters for `theme.brand`.
 *
 * The merged result is then re-validated against the block's own Zod schema by
 * the caller, so a patch cannot smuggle a shape past the contract.
 */

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) !== null &&
  !(value instanceof Date);

export const applyPropsPatch = (
  current: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> => {
  const next: Record<string, unknown> = { ...current };

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) {
      delete next[key];
      continue;
    }
    const existing = next[key];
    if (isPlainObject(value) && isPlainObject(existing)) {
      next[key] = applyPropsPatch(existing, value);
      continue;
    }
    next[key] = value;
  }

  return next;
};

/** The keys a patch actually touched — used for the human summary and the diff. */
export const patchedKeys = (patch: Record<string, unknown>): string[] =>
  Object.keys(patch).filter((key) => patch[key] !== undefined);
