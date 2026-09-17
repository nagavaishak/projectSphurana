import { db, withSystemScope } from '@borradh-workspace/database';
import { handleCalendarWebhook } from '@borradh-workspace/features/calendar';
import { logError } from '@borradh-workspace/observability';
import type { Logger } from '@nestjs/common';

/**
 * Google Calendar push-notification orchestration.
 *
 * FIRE-AND-FORGET IS DELIBERATE: Google retries with exponential backoff on any
 * non-2xx, so the handler answers 200 immediately and the sync runs detached.
 * The `.catch` is what keeps a failed sync from becoming an unhandled rejection
 * — it must stay.
 *
 * The header-completeness short-circuit mirrors `GoogleChannelTokenGuard`,
 * which deliberately lets requests WITHOUT the `x-goog-*` headers through
 * un-checked so they are still acknowledged 200 here rather than 403'd.
 */
export function dispatchGoogleCalendarWebhook(input: {
  channelId: string;
  resourceState: string;
  resourceId: string;
  channelToken?: string;
  logger: Logger;
}): { ok: true } {
  const { channelId, resourceState, resourceId, channelToken, logger } = input;

  logger.log(`Calendar webhook: state=${resourceState} channel=${channelId}`);

  if (!channelId || !resourceState || !resourceId) {
    logger.warn('Missing required Google Calendar webhook headers');
    return { ok: true };
  }

  withSystemScope(
    (conn) =>
      handleCalendarWebhook(conn, {
        channelId,
        resourceState,
        resourceId,
        channelToken,
      }),
    { db }
  ).catch((error: unknown) => {
    logError(
      'googleCalendar.webhookProcess',
      error instanceof Error ? error : new Error(String(error)),
      { feature: 'webhooks' }
    );
  });

  return { ok: true };
}
