import {
  type MessagingDestination,
  whatsappAccount,
} from '@borradh-workspace/database';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { AdErrorCodes } from '../../models/index.js';

export interface WhatsAppLookupResult {
  phoneNumber: string;
  phoneNumberId: string;
  wabaId: string;
}

/**
 * Look up the org's active WhatsApp Business account when an ad's
 * destinations include WhatsApp. Returns `ok(null)` when WhatsApp is not
 * requested, so callers can use a single code path.
 *
 * Used by launch-ad (to populate `promoted_object.whatsapp_phone_number`
 * on the ad set) and by the ENG-179 preflight validator.
 */
export const lookupWhatsAppForDestinations = async (
  db: DbConnection,
  organizationId: string,
  destinations: MessagingDestination[] | undefined | null
): Promise<Result<WhatsAppLookupResult | null>> => {
  if (!destinations || !destinations.includes('whatsapp')) {
    return ok(null);
  }

  const account = await db.query.whatsappAccount.findFirst({
    where: and(
      eq(whatsappAccount.organizationId, organizationId),
      eq(whatsappAccount.isActive, true)
    ),
    columns: {
      phoneNumber: true,
      phoneNumberId: true,
      wabaId: true,
      tokenStatus: true,
    },
  });

  if (!account) {
    return err(
      new FeatureError(
        AdErrorCodes.META_WHATSAPP_DISCONNECTED,
        'No active WhatsApp Business account is connected for this organization. Connect WhatsApp in Settings → Integrations before launching a WhatsApp ad.'
      )
    );
  }

  if (account.tokenStatus === 'needs_reconnect') {
    return err(
      new FeatureError(
        AdErrorCodes.META_WHATSAPP_DISCONNECTED,
        'Your WhatsApp Business connection has expired. Reconnect WhatsApp in Settings → Integrations before launching a WhatsApp ad.'
      )
    );
  }

  return ok({
    phoneNumber: account.phoneNumber,
    phoneNumberId: account.phoneNumberId,
    wabaId: account.wabaId,
  });
};
