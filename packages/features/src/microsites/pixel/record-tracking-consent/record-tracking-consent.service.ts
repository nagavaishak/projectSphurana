/**
 * Persist a visitor's tracking-consent decision ON THE LEAD (§9.7).
 *
 * WHY THE LEAD AND NOT A COOKIE: a cookie answers "may I fire the pixel right
 * now". Months later, when someone asks why a conversion was or was not
 * reported, only a stored decision answers "what basis did we send this
 * under". It rides in `lead.metadata.trackingConsent` — deliberately not a new
 * column, so this ships without a migration on a table other work is touching.
 *
 * The write MERGES into existing metadata. A blind overwrite here would drop
 * whatever else a lead is carrying.
 */

import { lead as leadTable } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  TRACKING_CONSENT_METADATA_KEY,
  type TrackingConsent,
} from '../tracking-consent.js';
import {
  type RecordTrackingConsentInput,
  recordTrackingConsentSchema,
} from './record-tracking-consent.schema.js';

const recordTrackingConsentImpl = async (
  db: DbConnection,
  input: RecordTrackingConsentInput
): Promise<Result<{ leadId: string; consent: TrackingConsent }>> => {
  const parsed = recordTrackingConsentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, leadId, ...consent } = parsed.data;

  try {
    const existing = await db.query.lead.findFirst({
      where: and(
        eq(leadTable.id, leadId),
        eq(leadTable.organizationId, organizationId)
      ),
    });

    if (!existing) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Lead not found'));
    }

    const metadata =
      existing.metadata && typeof existing.metadata === 'object'
        ? (existing.metadata as Record<string, unknown>)
        : {};

    await db
      .update(leadTable)
      .set({
        metadata: {
          ...metadata,
          [TRACKING_CONSENT_METADATA_KEY]: consent,
        },
      })
      .where(eq(leadTable.id, leadId));

    return ok({ leadId, consent });
  } catch (error) {
    logError('microsites.recordTrackingConsent', error, {
      feature: 'microsites',
      extra: { organizationId, leadId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to record tracking consent'
      )
    );
  }
};

export const recordTrackingConsent = (
  db: DbConnection,
  input: RecordTrackingConsentInput
) =>
  trackedResult(
    'microsites.recordTrackingConsent',
    () => recordTrackingConsentImpl(db, input),
    { properties: { organizationId: input.organizationId, ads: input.ads } }
  );

export type RecordTrackingConsentResult = Awaited<
  ReturnType<typeof recordTrackingConsent>
>;
