import type { ZodType } from 'zod';

/**
 * The keys a form schema can REQUIRE at submit, unioned across every branch.
 *
 * Walks the real zod object graph — no source parsing, no version-fragile
 * regexes. A key is required unless it is wrapped in `.optional()`,
 * `.nullish()`, `.default()` or `.catch()`.
 *
 * The union across branches is the whole point. A discriminated union only
 * validates the branch the form is currently in, so a key that is optional in
 * the default branch and required in another is invisible to a plain parse of
 * the defaults — which is exactly how `PostContentDialog` shipped with no
 * `date`/`time` default: untouched, the form sits in `mode: 'now'` (where both
 * are optional) and only explodes once the user picks "Schedule for later".
 */

// zod v4 exposes its internals on `.def` ({ type, shape, options, innerType }).
interface ZodDef {
  type?: string;
  shape?: Record<string, unknown>;
  options?: unknown[];
  innerType?: unknown;
  left?: unknown;
  right?: unknown;
  in?: unknown;
  out?: unknown;
}

const defOf = (schema: unknown): ZodDef =>
  ((schema as { def?: ZodDef; _def?: ZodDef })?.def ??
    (schema as { _def?: ZodDef })?._def ??
    {}) as ZodDef;

/** Wrappers that make a key satisfiable without the user supplying anything. */
const OPTIONAL_TYPES = new Set([
  'optional',
  'default',
  'prefault',
  'catch',
  'nullish',
]);

function isOptionalKey(field: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  const def = defOf(field);
  if (def.type && OPTIONAL_TYPES.has(def.type)) return true;
  // `.optional().describe()`, `.pipe()`, `.transform()` etc. wrap the real type.
  if (def.type === 'pipe') {
    return (
      isOptionalKey(def.in, depth + 1) || isOptionalKey(def.out, depth + 1)
    );
  }
  if (def.innerType) return isOptionalKey(def.innerType, depth + 1);
  return false;
}

/**
 * Every key that any branch of `schema` can require. Handles objects, unions
 * (incl. discriminated), intersections, and the `.refine()`/`.pipe()` wrappers
 * that sit on top of them.
 */
export function requiredKeysAcrossBranches(
  schema: ZodType | unknown,
  depth = 0
): Set<string> {
  const keys = new Set<string>();
  if (depth > 8) return keys;
  const def = defOf(schema);

  switch (def.type) {
    case 'object': {
      for (const [key, field] of Object.entries(def.shape ?? {})) {
        if (!isOptionalKey(field)) keys.add(key);
      }
      break;
    }
    case 'union': {
      // Discriminated unions report `type: 'union'` too — same shape.
      for (const option of def.options ?? []) {
        for (const key of requiredKeysAcrossBranches(option, depth + 1)) {
          keys.add(key);
        }
      }
      break;
    }
    case 'intersection': {
      for (const side of [def.left, def.right]) {
        for (const key of requiredKeysAcrossBranches(side, depth + 1)) {
          keys.add(key);
        }
      }
      break;
    }
    case 'pipe': {
      for (const key of requiredKeysAcrossBranches(def.in, depth + 1)) {
        keys.add(key);
      }
      break;
    }
    default: {
      // `.optional()`/`.default()` around a whole object, or an unknown wrapper.
      if (def.innerType) {
        for (const key of requiredKeysAcrossBranches(
          def.innerType,
          depth + 1
        )) {
          keys.add(key);
        }
      }
    }
  }

  return keys;
}
