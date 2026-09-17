import { createLogger, logError } from '@borradh-workspace/observability';
import {
  type ClaireClassifyJobPayload,
  getClaireClassifyQueue,
} from '../services-changed/services-changed.trigger.js';

const logger = createLogger('ClaireOnboardingTrigger');

/**
 * Trigger an immediate classification when an organization completes
 * onboarding. force: true bypasses the inputHash short-circuit so the
 * classifier runs even when a partial profile already exists from the
 * onboarding market-position question (see Window 4).
 *
 * Called from wherever the onboarding flow signals completion. As of writing
 * the codebase has no canonical onboarding-completed event — Window 4 is
 * expected to wire this trigger into its completion mutation. Until then it
 * can be invoked manually (e.g. from the backfill script) or from the final
 * step of the setup-services funnel.
 */
export async function triggerOnboardingCompleted(
  organizationId: string
): Promise<void> {
  try {
    const queue = getClaireClassifyQueue();
    await queue.add(
      'onboarding_completed',
      {
        organizationId,
        reason: 'onboarding_completed',
        force: true,
      } satisfies ClaireClassifyJobPayload,
      {
        // Overwrite any debounced services-changed job for this org — the
        // onboarding-completion classify should not be delayed.
        jobId: `claire-classify-${organizationId}`,
      }
    );
    logger.debug('Onboarding-completed classify queued', { organizationId });
  } catch (error) {
    logError('claire.triggerOnboardingCompleted', error, {
      feature: 'claire',
      extra: { organizationId },
    });
  }
}
