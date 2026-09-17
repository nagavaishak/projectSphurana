import { createLogger, logError } from '@borradh-workspace/observability';
import {
  type ClaireClassifyJobPayload,
  getClaireClassifyQueue,
} from '../services-changed/services-changed.trigger.js';

const logger = createLogger('ClaireAdContextTrigger');

/**
 * Enqueue an immediate classification when the ad-creation-context read finds
 * a missing or stubbed business profile.
 *
 * Previously the read path ran `classifyBusiness(db, …)` as a detached,
 * un-awaited in-process promise. That work makes a 10–40s LLM call and then
 * writes to the DB — long after the HTTP request (and its DB connection
 * lifecycle) has completed. On Fly→Neon that detached window is exactly when
 * the NAT silently severs the idle connection; postgres.js then replays the
 * in-flight transaction on a reconnected backend whose `reserved` flag is lost,
 * surfacing as `UNSAFE_TRANSACTION: Only use sql.begin, sql.reserved or max: 1`
 * (ENG-313). Moving the work onto the existing BullMQ classify queue runs it on
 * the worker's own connection/lifecycle instead.
 *
 * Uses the same stable jobId as the other classify triggers so a burst of
 * widget reads collapses into a single queued run, and overwrites any debounced
 * services-changed job so the recommendation surfaces without the debounce delay.
 */
export async function triggerAdContextClassify(
  organizationId: string
): Promise<void> {
  try {
    const queue = getClaireClassifyQueue();
    await queue.add(
      'manual',
      {
        organizationId,
        reason: 'manual',
      } satisfies ClaireClassifyJobPayload,
      {
        jobId: `claire-classify-${organizationId}`,
      }
    );
    logger.debug('Ad-context classify queued', { organizationId });
  } catch (error) {
    logError('claire.triggerAdContextClassify', error, {
      feature: 'claire',
      extra: { organizationId },
    });
  }
}
