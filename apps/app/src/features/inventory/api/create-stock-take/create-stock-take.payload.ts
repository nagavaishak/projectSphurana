import type { CreateStockTakeInput } from '../types';
import type { CreateStockTakeFormValues } from './create-stock-take.form';

/** Typed intent for starting a stocktake — the raw form values. */
export type CreateStockTakeIntent = CreateStockTakeFormValues;

/**
 * The single wire body for POST /stock-takes.
 *
 * The only derivation is the one that matters: an untouched name or description
 * is `''` in the form and must reach the wire as `null`, not as an empty
 * string — the service's schema treats a present `''` as a value, so "unnamed"
 * would persist as a name of nothing.
 */
export function buildCreateStockTakePayload(
  intent: CreateStockTakeIntent
): CreateStockTakeInput {
  return {
    locationId: intent.locationId,
    name: intent.name.trim() || null,
    description: intent.description.trim() || null,
  } as CreateStockTakeInput;
}
