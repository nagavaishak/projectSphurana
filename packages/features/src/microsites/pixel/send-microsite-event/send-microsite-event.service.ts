/**
 * Send one microsite conversion/browsing event to Meta's Conversions API.
 *
 * THREE THINGS THIS FILE IS RESPONSIBLE FOR:
 *
 * 1. CONSENT (§9.7). Gated BEFORE any customer data is read or hashed. A
 *    suppressed event is a successful, uneventful outcome — not an error.
 * 2. `event_id`. Derived, never random, so the browser half can compute the
 *    same string with no round trip. See `../event-id.ts`.
 * 3. FIRE-AND-FORGET. Meta is a side effect of a booking, never a condition of
 *    one. `trackMicrositeEvent` below can be `void`ed at a call site and will
 *    never reject, never throw, and never slow the booking down. A Meta outage
 *    costs attribution, not a customer's appointment.
 *
 * WHAT IS NEVER LOGGED: raw (unhashed) customer data, and a pixel id in the
 * same log line as any customer identifier. Hashing the data is pointless if
 * the plaintext then goes to Better Stack.
 */

import { lead as leadTable } from '@borradh-workspace/database';
import {
  type MetaCapiCustomData,
  type MetaCapiEventInput,
  MetaCapiService,
} from '@borradh-workspace/integrations/meta-capi';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
// Through the meta-ads context's PUBLIC barrel, not a deep path into its
// internals — the cross-context gate enforces this.
import { getMetaCredentials } from '../../../meta-ads/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { buildMicrositeEventId } from '../event-id.js';
import { resolveOrgPixel } from '../resolve-org-pixel/index.js';
import {
  type ConsentDecisionReason,
  type TrackingConsent,
  decideConsent,
  readTrackingConsent,
} from '../tracking-consent.js';
import {
  type SendMicrositeEventInput,
  sendMicrositeEventSchema,
} from './send-microsite-event.schema.js';

export interface SendMicrositeEventOutput {
  sent: boolean;
  /** The id the BROWSER event must carry as `eventID`. Always returned. */
  eventId: string;
  reason: ConsentDecisionReason;
  limitedDataUse: boolean;
  eventsReceived?: number;
}

const sendMicrositeEventImpl = async (
  db: DbConnection,
  input: SendMicrositeEventInput
): Promise<Result<SendMicrositeEventOutput>> => {
  const parsed = sendMicrositeEventSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    organizationId,
    micrositeId,
    eventName,
    dedupeKey,
    eventTime,
    eventSourceUrl,
    actionSource,
    leadId,
    user,
    customData,
    hasTransactionBasis,
    consent: consentOverride,
    region,
    metaAdsPageId,
  } = parsed.data;

  const eventId = buildMicrositeEventId({
    eventName,
    micrositeId,
    dedupeKey,
  });

  // --- 1. Consent, before anything else touches customer data -------------
  let consent: TrackingConsent | null = consentOverride ?? null;
  if (!consent && leadId) {
    const leadRow = await db.query.lead.findFirst({
      where: and(
        eq(leadTable.id, leadId),
        eq(leadTable.organizationId, organizationId)
      ),
    });
    consent = readTrackingConsent(leadRow?.metadata);
  }

  const decision = decideConsent({
    eventName,
    consent,
    hasTransactionBasis,
    region,
  });

  if (!decision.allowed) {
    // Not an error: the system worked. Returned so the caller can report
    // "suppressed for consent" rather than "failed".
    return ok({
      sent: false,
      eventId,
      reason: decision.reason,
      limitedDataUse: decision.limitedDataUse,
    });
  }

  // --- 2. Pixel + credentials --------------------------------------------
  const pixelResult = await resolveOrgPixel(db, {
    organizationId,
    metaAdsPageId,
  });
  if (!pixelResult.success) {
    // Re-wrap: the tracked wrapper widens the error type, and this Result is
    // narrower. Same code, same message — no information is lost.
    return err(
      new FeatureError(pixelResult.error.code, pixelResult.error.message)
    );
  }

  const credResult = await getMetaCredentials(db, {
    organizationId,
    metaAdsPageId,
    requireConfigured: false,
    operationName: 'microsites.sendMicrositeEvent',
  });
  if (!credResult.success) return credResult;

  // --- 3. Build and send --------------------------------------------------
  const event: MetaCapiEventInput = {
    event_name: eventName,
    event_time: eventTime ?? Math.floor(Date.now() / 1000),
    event_id: eventId,
    event_source_url: eventSourceUrl,
    action_source: actionSource ?? 'website',
    user_data: {
      ...(user ?? {}),
      // Hashed inside the client. Joins every event for this person without
      // ever sending a readable identifier.
      externalId: leadId ?? undefined,
    },
    custom_data: {
      ...(customData as MetaCapiCustomData | undefined),
      // Never the host — a custom-domain move must not break attribution (§9).
      microsite_id: micrositeId,
    },
  };

  if (decision.limitedDataUse) {
    event.data_processing_options = ['LDU'];
    event.data_processing_options_country = 0;
    event.data_processing_options_state = 0;
  }

  const capi = new MetaCapiService({
    accessToken: credResult.data.credentials.accessToken,
    pixelId: pixelResult.data.pixelId,
    appSecret: credResult.data.credentials.appSecret,
  });

  try {
    const result = await capi.sendEvents([event]);
    return ok({
      sent: true,
      eventId,
      reason: decision.reason,
      limitedDataUse: decision.limitedDataUse,
      eventsReceived: result.eventsReceived,
    });
  } catch (error) {
    // `eventId` and org id only — no pixel id beside a customer identifier,
    // and never the user_data payload, hashed or otherwise.
    logError('microsites.sendMicrositeEvent', error, {
      feature: 'microsites',
      extra: { organizationId, micrositeId, eventName, eventId },
    });
    return err(
      new FeatureError(
        ErrorCodes.EXTERNAL_SERVICE_ERROR,
        'Failed to send the conversion event to Meta.'
      )
    );
  }
};

export const sendMicrositeEvent = (
  db: DbConnection,
  input: SendMicrositeEventInput
) =>
  trackedResult(
    'microsites.sendMicrositeEvent',
    () => sendMicrositeEventImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        eventName: input.eventName,
      },
    }
  );

/**
 * Fire-and-forget entry point. THE ONE TO CALL FROM A BOOKING PATH.
 *
 * Resolves `void` in every case — success, suppression, Meta outage, or a bug
 * in this module. Attribution is never worth failing a customer's booking for.
 */
export const trackMicrositeEvent = async (
  db: DbConnection,
  input: SendMicrositeEventInput
): Promise<void> => {
  try {
    await sendMicrositeEvent(db, input);
  } catch (error) {
    logError('microsites.trackMicrositeEvent', error, {
      feature: 'microsites',
      extra: {
        organizationId: input.organizationId,
        eventName: input.eventName,
      },
    });
  }
};

export type SendMicrositeEventResult = Awaited<
  ReturnType<typeof sendMicrositeEvent>
>;
