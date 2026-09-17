import type { CallToAction, UpdateAdInput } from '../types';

/**
 * The typed INTENT the ad side-panel holds: the editable creative fields plus
 * whether the ad's destination is locked (messaging/lead-form ads derive CTA +
 * URL from the ad set, so those edits are dropped).
 */
export interface UpdateAdIntent {
  name: string;
  headline?: string;
  primaryText?: string;
  description?: string;
  callToAction?: string;
  destinationUrl?: string;
  destinationLocked: boolean;
}

/** The fields this builder can put on the wire. */
export type UpdateAdField = keyof Omit<UpdateAdIntent, 'destinationLocked'>;

/**
 * THE update-ad payload builder. The side-panel passes intent; the wire body is
 * assembled here. When the destination is locked, CTA + URL are omitted (they'd
 * have no effect); otherwise they map empty-string → undefined.
 *
 * ONLY THE FIELDS THAT CHANGED GO ON THE WIRE, and that is load-bearing rather
 * than tidiness. `updateAdImpl` decides whether to rebuild the ad's creative by
 * asking whether any of `headline`, `primaryText`, `description`,
 * `callToAction` or `destinationUrl` is `!== undefined` — not whether its value
 * differs. Sending all five on every save therefore made EVERY edit a creative
 * rebuild: renaming a live ad minted a fresh creative, swapped it onto the
 * running ad and sent it back through Meta's review, pausing delivery for a
 * change that never touched the creative. Observed in a browser — a rename
 * moved `metaCreativeId` from `…8065656f` to `…94dad8aa`.
 *
 * `changed` is REQUIRED for that reason: an omitted set would quietly restore
 * the old behaviour at the one call site that matters.
 */
export function buildUpdateAdPayload(
  input: UpdateAdIntent,
  changed: readonly UpdateAdField[]
): UpdateAdInput {
  const touched = new Set(changed);
  // `name` is the only non-optional field on the wire type, and the server
  // treats a name it already holds as a no-op, so it always travels.
  const payload: UpdateAdInput = { name: input.name };

  if (touched.has('headline')) payload.headline = input.headline || undefined;
  if (touched.has('primaryText'))
    payload.primaryText = input.primaryText || undefined;
  if (touched.has('description'))
    payload.description = input.description || undefined;

  if (!input.destinationLocked) {
    if (touched.has('callToAction'))
      payload.callToAction = (input.callToAction as CallToAction) || undefined;
    if (touched.has('destinationUrl'))
      payload.destinationUrl = input.destinationUrl || undefined;
  }

  return payload;
}
