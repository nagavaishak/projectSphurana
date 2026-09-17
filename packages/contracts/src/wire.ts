/**
 * `toWire()` — the transform at the heart of the contracts package.
 *
 * It maps a Drizzle-row Zod schema (what `drizzle-zod`'s `createSelectSchema`
 * produces) to the **wire** schema: the exact JSON shape the API serializes and
 * the frontend receives. The rules encode, in runtime Zod, the same
 * transformations the compile-time `Serialize<T>` / `ApiResponse<T, NumericKeys>`
 * utility types in `@borradh-workspace/api-client` already express:
 *
 *   - `z.date()`            → `z.string().datetime()`   (Date serializes to an ISO string)
 *   - `z.number()`          → `z.number()`              (numeric columns surfaced as numbers)
 *   - pgEnum (`z.enum`)     → passes through unchanged   (enum values are frontend-safe labels)
 *   - nullability/optional  → preserved                  (`.nullable()` / `.optional()`)
 *   - arrays / objects      → recurse into elements/fields
 *   - jsonb `$type<>()`     → passes through as-is        (see the generator for untyped jsonb)
 *
 * `toWire` returns BOTH a runtime Zod schema (used to parse responses and to
 * validate test fixtures) AND a pure-Zod **source string** (emitted by the
 * generator into `src/generated/`). Deriving both from one classification means
 * the runtime schema and the committed source can never drift.
 *
 * This module imports ONLY `zod` — it is frontend-safe and has no `drizzle-zod`
 * or `@borradh-workspace/database` in its runtime graph.
 */
import { z } from 'zod';

export interface ToWireOptions {
  /**
   * Optional resolver that maps a set of enum values to a source expression
   * referencing a shared labels array (e.g. `'leadStatusValues'`). Return the
   * bare expression to emit `z.enum(<expr>)`; return `null` to inline the values
   * as `z.enum([...])`. Used by the generator to wire pgEnums back to
   * `@borradh-workspace/labels`; the runtime schema is unaffected either way.
   */
  resolveEnum?: (values: readonly string[]) => string | null;
}

export interface WireResult {
  /** The wire Zod schema — parse responses / validate fixtures with this. */
  schema: z.ZodType;
  /** Pure-Zod source expression for the schema (what the generator emits). */
  source: string;
}

const quote = (v: string): string => JSON.stringify(v);

/**
 * Transform a single Zod node (a column schema, or a whole row object) into its
 * wire representation. Recurses through wrappers (nullable/optional), containers
 * (array/object/union) and leaves (string/number/boolean/date/enum/literal).
 */
export function toWire(
  input: z.ZodType,
  options: ToWireOptions = {}
): WireResult {
  // --- wrappers: unwrap, recurse, re-wrap -----------------------------------
  if (input instanceof z.ZodNullable) {
    const inner = toWire(input.unwrap() as z.ZodType, options);
    return {
      schema: inner.schema.nullable(),
      source: `${inner.source}.nullable()`,
    };
  }
  if (input instanceof z.ZodOptional) {
    const inner = toWire(input.unwrap() as z.ZodType, options);
    return {
      schema: inner.schema.optional(),
      source: `${inner.source}.optional()`,
    };
  }
  if (input instanceof z.ZodDefault) {
    // A server default doesn't change the wire shape; drop the default wrapper.
    return toWire(input.unwrap() as z.ZodType, options);
  }

  // --- the core rules -------------------------------------------------------
  // Date → ISO string. This is the whole point of Serialize<Date> = string.
  if (input instanceof z.ZodDate) {
    return { schema: z.string().datetime(), source: 'z.string().datetime()' };
  }
  // Numeric columns surfaced as numbers stay numbers on the wire.
  if (input instanceof z.ZodNumber) {
    return { schema: z.number(), source: 'z.number()' };
  }
  if (input instanceof z.ZodBoolean) {
    return { schema: z.boolean(), source: 'z.boolean()' };
  }
  if (input instanceof z.ZodEnum) {
    const values = input.options as readonly string[];
    const ref = options.resolveEnum?.(values) ?? null;
    const source = ref
      ? `z.enum(${ref})`
      : `z.enum([${values.map(quote).join(', ')}])`;
    // Reuse the original enum schema — it is already pure Zod.
    return { schema: input, source };
  }
  if (input instanceof z.ZodLiteral) {
    const value = (input as z.ZodLiteral<z.core.util.Literal>).value;
    return { schema: input, source: `z.literal(${JSON.stringify(value)})` };
  }
  if (input instanceof z.ZodString) {
    return { schema: z.string(), source: 'z.string()' };
  }

  // --- containers -----------------------------------------------------------
  if (input instanceof z.ZodArray) {
    const inner = toWire(input.element as z.ZodType, options);
    return {
      schema: z.array(inner.schema),
      source: `z.array(${inner.source})`,
    };
  }
  if (input instanceof z.ZodObject) {
    const shape = input.shape as Record<string, z.ZodType>;
    const entries = Object.entries(shape).map(
      ([key, value]) => [key, toWire(value, options)] as const
    );
    const schema = z.object(
      Object.fromEntries(entries.map(([key, wire]) => [key, wire.schema]))
    );
    const source = `z.object({ ${entries
      .map(([key, wire]) => `${JSON.stringify(key)}: ${wire.source}`)
      .join(', ')} })`;
    return { schema, source };
  }
  if (input instanceof z.ZodUnion) {
    const opts = (input.options as unknown as z.ZodType[]).map((o) =>
      toWire(o, options)
    );
    return {
      schema: z.union(
        opts.map((o) => o.schema) as [z.ZodType, z.ZodType, ...z.ZodType[]]
      ),
      source: `z.union([${opts.map((o) => o.source).join(', ')}])`,
    };
  }

  // --- unstructured JSON leaves (untyped jsonb, catch-all) ------------------
  if (input instanceof z.ZodRecord) {
    return {
      schema: z.record(z.string(), z.unknown()),
      source: 'z.record(z.string(), z.unknown())',
    };
  }
  if (input instanceof z.ZodNull) {
    return { schema: z.null(), source: 'z.null()' };
  }
  if (input instanceof z.ZodAny) {
    return { schema: z.any(), source: 'z.any()' };
  }
  // ZodUnknown and anything unrecognised collapse to `z.unknown()` — a safe,
  // permissive wire shape (used for untyped jsonb). The generator prefers to
  // special-case jsonb columns explicitly; this is the last-resort fallback.
  return { schema: z.unknown(), source: 'z.unknown()' };
}
