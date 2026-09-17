/**
 * Map messaging destinations (or the legacy follow-up type + conversion
 * destination pair) to Meta's `destination_type` field.
 *
 * Used by launch-ad and finalize-ad when creating ad sets. Meta anchors
 * `destination_type` on the ad set, so this is the single place where
 * Borradh's user-visible "destinations" concept gets translated into
 * Meta's API.
 *
 * # The new signature: resolveDestinationType
 *
 * Takes a non-empty `destinations` array (`MessagingDestination[]`) plus
 * the campaign objective and returns the correct Meta combo destination
 * type according to the table in ENG-177:
 *
 *   | set                                       | destination_type                              |
 *   | ----                                      | ----                                          |
 *   | ['whatsapp']                              | WHATSAPP                                      |
 *   | ['messenger']                             | MESSENGER                                     |
 *   | ['instagram_dm']                          | INSTAGRAM_DIRECT                              |
 *   | ['whatsapp', 'messenger']                 | MESSAGING_MESSENGER_WHATSAPP                  |
 *   | ['instagram_dm', 'messenger']             | MESSAGING_INSTAGRAM_DIRECT_MESSENGER          |
 *   | ['whatsapp', 'messenger', 'instagram_dm'] | MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP |
 *
 * ## EU restriction on the full triple combo
 *
 * `MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP` is incompatible with the
 * CONVERSATIONS optimization goal for EU accounts due to privacy rules.
 * When the objective is OUTCOME_ENGAGEMENT and all three destinations are
 * selected, we drop WhatsApp and resolve to
 * `MESSAGING_INSTAGRAM_DIRECT_MESSENGER`. The UI should warn the user and
 * the caller can opt out by passing `throwOnEuTripleCombo: true` if they
 * want a hard error instead of the fallback.
 *
 * ## IG DM + WhatsApp without Messenger
 *
 * Meta does not expose a combo for just `{instagram_dm, whatsapp}` without
 * Messenger. When that pair is selected we auto-include Messenger and
 * return `MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP` (subject to the EU
 * restriction above) so the user's selection is honoured. The UI picker
 * (ENG-178) should surface a note about the auto-inclusion.
 *
 * ## OUTCOME_LEADS
 *
 * Lead generation objectives support only single-destination ad sets with
 * MESSENGER, WHATSAPP, or ON_AD (lead form). When the objective is
 * OUTCOME_LEADS we collapse multi-destination selections to a priority
 * order: WhatsApp > Messenger > Instagram DM.
 *
 * # Legacy signature
 *
 * `mapConversionDestination(followUpType, conversionDestination, objective)`
 * is kept as a thin shim that converts the legacy pair into a destinations
 * array and calls `resolveDestinationType` underneath. It will be removed
 * once all call sites have migrated to the new signature.
 */

import type { MessagingDestination } from '@borradh-workspace/database';

export type MetaDestinationType =
  | 'WHATSAPP'
  | 'MESSENGER'
  | 'INSTAGRAM_DIRECT'
  | 'MESSAGING_MESSENGER_WHATSAPP'
  | 'MESSAGING_INSTAGRAM_DIRECT_MESSENGER'
  | 'MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP'
  | 'ON_AD'
  | 'WEBSITE';

interface ResolveDestinationTypeOptions {
  destinations: MessagingDestination[];
  objective?: string | null;
  /**
   * Throw instead of silently dropping WhatsApp when the full triple combo
   * is requested with OUTCOME_ENGAGEMENT on an EU account. UI callers
   * should leave this false (the default); server-side callers that want
   * to surface the constraint to the user can opt in.
   */
  throwOnEuTripleCombo?: boolean;
}

/**
 * Resolve a user-selected set of messaging destinations to Meta's
 * `destination_type`. Accepts any subset of the messaging destinations
 * and always returns a valid Meta enum value.
 */
export function resolveDestinationType(
  options: ResolveDestinationTypeOptions
): MetaDestinationType {
  const { destinations, objective, throwOnEuTripleCombo = false } = options;

  if (destinations.length === 0) {
    // Caller should validate upstream, but be defensive.
    return 'MESSENGER';
  }

  const hasWhatsApp = destinations.includes('whatsapp');
  const hasMessenger = destinations.includes('messenger');
  const hasInstagramDm = destinations.includes('instagram_dm');

  // OUTCOME_LEADS only supports single-destination ad sets — collapse to
  // a priority order so multi-select users still get something sensible.
  if (objective === 'OUTCOME_LEADS') {
    if (hasWhatsApp) return 'WHATSAPP';
    if (hasMessenger) return 'MESSENGER';
    // IG DM alone isn't a valid LEADS destination — fall back to MESSENGER.
    return 'MESSENGER';
  }

  // Single destinations
  if (destinations.length === 1) {
    if (hasWhatsApp) return 'WHATSAPP';
    if (hasMessenger) return 'MESSENGER';
    return 'INSTAGRAM_DIRECT';
  }

  // Auto-include Messenger when IG DM + WhatsApp are selected alone —
  // Meta has no combo enum for just those two.
  const effectiveMessenger = hasMessenger || (hasInstagramDm && hasWhatsApp);

  // Triple combo: EU accounts + CONVERSATIONS optimization can't use it.
  if (hasWhatsApp && hasInstagramDm && effectiveMessenger) {
    if (objective === 'OUTCOME_ENGAGEMENT') {
      if (throwOnEuTripleCombo) {
        throw new Error(
          'MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP is not supported with OUTCOME_ENGAGEMENT for EU accounts. Drop WhatsApp or Instagram DM from the selection.'
        );
      }
      // Drop WhatsApp to land in a supported combo.
      return 'MESSAGING_INSTAGRAM_DIRECT_MESSENGER';
    }
    return 'MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP';
  }

  // Pair: Messenger + WhatsApp
  if (hasMessenger && hasWhatsApp && !hasInstagramDm) {
    return 'MESSAGING_MESSENGER_WHATSAPP';
  }

  // Pair: Messenger + IG DM
  if (hasMessenger && hasInstagramDm && !hasWhatsApp) {
    return 'MESSAGING_INSTAGRAM_DIRECT_MESSENGER';
  }

  // Unreachable given the exhaustive branches above, but TS can't prove it.
  return 'MESSENGER';
}

/**
 * @deprecated Use `resolveDestinationType` with an explicit `destinations`
 * array. This thin shim converts the legacy
 * `(followUpType, conversionDestination, objective)` signature into a
 * destinations array and delegates. Will be removed once all call sites
 * have migrated.
 */
export const mapConversionDestination = (
  followUpType: 'chatbot' | 'lead_form' | 'website' | 'email_only' | 'sequence',
  conversionDestination?: string | null,
  objective?: string | null
): MetaDestinationType => {
  if (followUpType === 'lead_form') {
    return 'ON_AD';
  }
  if (followUpType !== 'chatbot') {
    return 'WEBSITE';
  }

  // chatbot path — derive destinations from the legacy single value
  const destinations: MessagingDestination[] = [];
  if (conversionDestination === 'whatsapp') {
    destinations.push('whatsapp');
  } else if (conversionDestination === 'instagram_direct') {
    destinations.push('instagram_dm');
  } else {
    // Default (null, undefined, 'messenger') → Messenger only. Historically
    // this resolved to MESSAGING_INSTAGRAM_DIRECT_MESSENGER for
    // OUTCOME_ENGAGEMENT and MESSENGER for everything else; preserve that.
    if (objective === 'OUTCOME_ENGAGEMENT') {
      return 'MESSAGING_INSTAGRAM_DIRECT_MESSENGER';
    }
    return 'MESSENGER';
  }

  return resolveDestinationType({ destinations, objective });
};
