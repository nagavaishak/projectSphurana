import { z } from 'zod';

/**
 * A boolean that survives arriving as a QUERY STRING.
 *
 * `z.coerce.boolean()` is the obvious choice and the wrong one: coercion is
 * `Boolean(value)`, and every non-empty string is truthy — so `?flag=false`
 * and `?flag=0` both parse as TRUE and the filter runs backwards. The bug is
 * invisible in a unit test that passes real booleans, and only shows up
 * through HTTP.
 *
 * The empty string is treated as ABSENT rather than true. `?flag=` is what a
 * form submits for an untouched field, and reading that as "yes" is the same
 * class of mistake in a quieter disguise.
 *
 * Use this for any boolean that can reach a service from a query string.
 * Non-string input (a real boolean from an internal caller, or undefined) is
 * passed through untouched.
 */
export const queryBoolean = () =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    if (value === '') return undefined;
    return value !== 'false' && value !== '0';
  }, z.boolean().optional());
