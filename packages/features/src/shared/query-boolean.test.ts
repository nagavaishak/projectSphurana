import { describe, expect, it } from '@borradh-workspace/testing';
import { z } from 'zod';
import { queryBoolean } from './query-boolean.js';

/**
 * `z.coerce.boolean()` is the obvious choice for a boolean arriving over HTTP
 * and the wrong one: coercion is `Boolean(value)`, so EVERY non-empty string
 * is true and `?flag=false` runs the filter backwards.
 *
 * It is invisible in a unit test that passes real booleans — which is exactly
 * how `list-leads` shipped with the correct handling in its DTO and
 * `z.coerce.boolean()` one layer down in the service, so every non-HTTP
 * caller (an assistant tool, a worker, another service) got the inverse.
 */
describe('queryBoolean', () => {
  const schema = z.object({ flag: queryBoolean() });
  const parse = (flag: unknown) => schema.parse({ flag }).flag;

  it('reads "false" and "0" as FALSE, which coercion gets backwards', () => {
    expect(parse('false')).toBe(false);
    expect(parse('0')).toBe(false);
    // The bug this exists to prevent, stated directly:
    expect(z.coerce.boolean().parse('false')).toBe(true);
  });

  it('reads other non-empty strings as true', () => {
    expect(parse('true')).toBe(true);
    expect(parse('1')).toBe(true);
    expect(parse('yes')).toBe(true);
  });

  /**
   * `?flag=` is what a form submits for an untouched field. Reading it as
   * "yes" is the same class of mistake in a quieter disguise — it turns a
   * filter on that the user never asked for.
   */
  it('treats an empty value as absent, not as true', () => {
    expect(parse('')).toBeUndefined();
  });

  it('passes real booleans through untouched', () => {
    expect(parse(true)).toBe(true);
    expect(parse(false)).toBe(false);
  });

  it('leaves an omitted value undefined', () => {
    expect(schema.parse({}).flag).toBeUndefined();
  });
});
