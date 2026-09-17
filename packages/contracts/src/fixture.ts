/**
 * Fixture helpers — build test data that is validated by the SAME schema the
 * runtime parses responses with. A fixture that doesn't match the contract
 * throws at construction time, so mocks can't silently drift from the API.
 *
 * Tests always run STRICT: `fixture`/`defineFixture` call `schema.parse`, which
 * throws on any mismatch (unlike the report-mode runtime parse).
 */
import type { z } from 'zod';

/**
 * Validate `value` against `schema` and return the parsed result. Throws (with
 * the ZodError) if it doesn't conform — the intended failure mode in tests.
 *
 * @example
 * const lead = fixture(leadSchema, { id: 'l1', firstName: 'Ada', ...  });
 */
export function fixture<TSchema extends z.ZodType>(
  schema: TSchema,
  value: z.input<TSchema>
): z.output<TSchema> {
  return schema.parse(value);
}

/**
 * Create a reusable factory from a schema and a valid base object. The returned
 * function merges (shallow) overrides onto the base and validates the result.
 *
 * @example
 * const aLead = defineFixture(leadSchema, baseLead);
 * const won = aLead({ status: 'won' });
 */
export function defineFixture<TSchema extends z.ZodType>(
  schema: TSchema,
  base: z.input<TSchema>
): (overrides?: Partial<z.input<TSchema>>) => z.output<TSchema> {
  return (overrides) =>
    schema.parse({ ...(base as object), ...(overrides as object) });
}
