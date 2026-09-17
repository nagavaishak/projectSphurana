import { createLogger, logError } from '@borradh-workspace/observability';
import { type DbConnection, ErrorCodes } from '../../shared/index.js';
import { classifyBusiness } from '../services/classify-business/index.js';
import type { ClaireClassifyJobPayload } from './services-changed/services-changed.trigger.js';

const logger = createLogger('ClaireClassifyJob');

/**
 * Process a single classify job from the BullMQ queue. Called by the worker
 * in apps/api/src/claire-worker. Idempotent — repeated runs of the same
 * payload either return the cached profile (inputHash hit) or persist a
 * fresh classification.
 */
export async function processClaireClassifyJob(
  db: DbConnection,
  payload: ClaireClassifyJobPayload
): Promise<void> {
  const { organizationId, reason, force } = payload;

  // Map the queue reason vocabulary onto the telemetry vocabulary. 'manual'
  // queue jobs always pass force=true; treat them as 'force'.
  const telemetryReason =
    reason === 'onboarding_completed'
      ? 'onboarding'
      : reason === 'services_changed'
        ? 'services_changed'
        : 'force';

  const result = await classifyBusiness(db, {
    organizationId,
    force: !!force,
    reason: telemetryReason,
  });

  if (!result.success) {
    // Organization was deleted between enqueue and processing — treat as a
    // no-op so BullMQ doesn't retry indefinitely and don't escalate to Sentry.
    if (result.error.code === ErrorCodes.NOT_FOUND) {
      logger.warn('claire-classify: organization no longer exists, skipping', {
        organizationId,
        reason,
      });
      return;
    }

    logError('claire.processClassifyJob', new Error(result.error.message), {
      feature: 'claire',
      extra: { organizationId, reason, errorCode: result.error.code },
    });
    return;
  }

  logger.debug('Classify job processed', {
    organizationId,
    reason,
    profileId: result.data.id,
    classifierVersion: result.data.classifierVersion,
  });
}
