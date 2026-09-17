import { conversation, organization } from '@borradh-workspace/database';
import type { ConversationMetadata } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type CheckBookingLinkIgnoredInput,
  DEFAULT_BOOKING_FALLBACK_TIMEOUT_MS,
  checkBookingLinkIgnoredSchema,
} from './direct-booking.schema.js';

export interface CheckBookingLinkIgnoredResult {
  ignored: boolean;
  shouldOfferDirectBooking: boolean;
  reason?: string;
}

/**
 * Check if the booking link was sent but not acted upon within the timeout window.
 *
 * Returns `shouldOfferDirectBooking: true` when:
 * 1. Org uses native booking system (primaryCalendarType === 'borradh')
 * 2. Booking link was sent (bookingLinkSentAt is set)
 * 3. Timeout has elapsed since link was sent
 * 4. No direct booking has already been offered
 * 5. No booking has been confirmed
 */
const checkBookingLinkIgnoredImpl = async (
  db: DbConnection,
  input: CheckBookingLinkIgnoredInput
): Promise<Result<CheckBookingLinkIgnoredResult>> => {
  const parsed = checkBookingLinkIgnoredSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { conversationId, organizationId, timeoutMs } = parsed.data;

  // Load organization to check booking system type
  const org = await db.query.organization.findFirst({
    where: and(eq(organization.id, organizationId), notDeleted(organization)),
    columns: {
      primaryCalendarType: true,
      primaryCalendarAccountId: true,
    },
  });

  if (!org) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
    );
  }

  // Gate: Only applies to native booking system
  if (org.primaryCalendarType !== 'borradh') {
    return ok({
      ignored: false,
      shouldOfferDirectBooking: false,
      reason: 'Organization is not using native booking system',
    });
  }

  // Load conversation metadata
  const conv = await db.query.conversation.findFirst({
    where: eq(conversation.id, conversationId),
    columns: {
      metadata: true,
      status: true,
    },
  });

  if (!conv) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Conversation not found')
    );
  }

  const metadata = (conv.metadata as ConversationMetadata | null) ?? {};

  // Check if booking link was sent
  if (!metadata.bookingLinkSentAt) {
    return ok({
      ignored: false,
      shouldOfferDirectBooking: false,
      reason: 'No booking link has been sent yet',
    });
  }

  // Check if direct booking was already offered
  if (metadata.directBookingOfferedAt) {
    return ok({
      ignored: true,
      shouldOfferDirectBooking: false,
      reason: 'Direct booking slots already offered',
    });
  }

  // Check if booking was already confirmed
  if (metadata.directBookingConfirmedAt) {
    return ok({
      ignored: false,
      shouldOfferDirectBooking: false,
      reason: 'Booking already confirmed',
    });
  }

  // Check if conversation is still bot_handling
  if (conv.status !== 'bot_handling') {
    return ok({
      ignored: false,
      shouldOfferDirectBooking: false,
      reason: 'Conversation no longer handled by bot',
    });
  }

  // Check if timeout has elapsed
  const linkSentAt = new Date(metadata.bookingLinkSentAt).getTime();
  const now = Date.now();
  const elapsed = now - linkSentAt;
  const effectiveTimeout = timeoutMs ?? DEFAULT_BOOKING_FALLBACK_TIMEOUT_MS;

  if (elapsed < effectiveTimeout) {
    return ok({
      ignored: false,
      shouldOfferDirectBooking: false,
      reason: `Timeout not yet elapsed (${Math.round(elapsed / 1000)}s of ${Math.round(effectiveTimeout / 1000)}s)`,
    });
  }

  return ok({
    ignored: true,
    shouldOfferDirectBooking: true,
  });
};

export const checkBookingLinkIgnored = (
  db: DbConnection,
  input: CheckBookingLinkIgnoredInput
) =>
  trackedResult(
    'chatbots.checkBookingLinkIgnored',
    () => checkBookingLinkIgnoredImpl(db, input),
    {
      properties: { conversationId: input.conversationId },
    }
  );
