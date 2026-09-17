import type { CreateBlockedTimeTypeInput } from '@borradh-workspace/api-client/types';
import { createBlockedTimeTypeRequestSchema } from '@borradh-workspace/contracts';

/**
 * PAYLOAD BUILDER — create blocked time type (POST /blocked-time-types).
 *
 * The dialog passes typed INTENT (form values, where compensation is a
 * `'paid' | 'unpaid'` radio); this is the ONLY place the wire body is built,
 * including the radio → boolean coercion.
 */

/** The form values the blocked-time-type dialog naturally holds. */
export interface BlockedTimeTypeFormValues {
  name: string;
  durationMinutes: number;
  paid: 'paid' | 'unpaid';
}

/** Intent accepted by `useCreateBlockedTimeType().mutate`. */
export type CreateBlockedTimeTypeFormInput = BlockedTimeTypeFormValues;

/**
 * `.strict()` wire body — an extra/unknown field is a parse error.
 *
 * This is now an ALIAS of the canonical request contract
 * (`packages/contracts/src/requests/scheduling.ts`), which the backend feature
 * schema also derives from. The body shape is described exactly once, so this
 * builder and the server cannot disagree about it.
 */
export const createBlockedTimeTypeBodySchema =
  createBlockedTimeTypeRequestSchema;

/** THE ONLY place a create-blocked-time-type API payload is constructed. */
export function buildCreateBlockedTimeTypePayload(
  input: CreateBlockedTimeTypeFormInput
): CreateBlockedTimeTypeInput {
  return createBlockedTimeTypeBodySchema.parse({
    name: input.name,
    durationMinutes: input.durationMinutes,
    paid: input.paid === 'paid',
  });
}
