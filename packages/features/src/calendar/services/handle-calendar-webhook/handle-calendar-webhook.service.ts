import { calendarAccount } from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import { trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { syncCalendarEvents } from '../sync-calendar-events/sync-calendar-events.service.js';
import {
  type HandleCalendarWebhookInput,
  handleCalendarWebhookSchema,
} from './handle-calendar-webhook.schema.js';

const handleCalendarWebhookImpl = async (
  db: DbConnection,
  input: HandleCalendarWebhookInput
): Promise<Result<{ processed: boolean }>> => {
  const parsed = handleCalendarWebhookSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid webhook data', {
        issues: parsed.error.issues,
      })
    );
  }

  const { channelId, resourceState, channelToken } = parsed.data;

  // Verify webhook token if configured
  const expectedToken = apiEnv.GOOGLE_CALENDAR_WEBHOOK_TOKEN;
  if (expectedToken && channelToken !== expectedToken) {
    return err(
      new FeatureError(ErrorCodes.UNAUTHORIZED, 'Invalid webhook token')
    );
  }

  // Initial sync confirmation — just acknowledge
  if (resourceState === 'sync') {
    return ok({ processed: true });
  }

  // Look up the calendar account by watch channel ID
  const calAccount = await db.query.calendarAccount.findFirst({
    where: eq(calendarAccount.watchChannelId, channelId),
  });

  if (!calAccount) {
    // Channel no longer exists — Google may still send notifications for a bit
    return ok({ processed: false });
  }

  // Process the notification by syncing events
  if (resourceState === 'exists' || resourceState === 'not_exists') {
    // Fire and don't await — return 200 quickly to Google
    // We use the default db here because the webhook runs outside request context
    syncCalendarEvents(db, {
      calendarAccountId: calAccount.id,
    }).catch(() => {
      // Error already logged inside syncCalendarEvents
    });
  }

  return ok({ processed: true });
};

export const handleCalendarWebhook = (
  db: DbConnection,
  input: HandleCalendarWebhookInput
) =>
  trackedResult(
    'calendar.handleCalendarWebhook',
    () => handleCalendarWebhookImpl(db, input),
    {
      properties: {
        channelId: input.channelId,
        resourceState: input.resourceState,
      },
    }
  );

export type HandleCalendarWebhookResult = Awaited<
  ReturnType<typeof handleCalendarWebhook>
>;
