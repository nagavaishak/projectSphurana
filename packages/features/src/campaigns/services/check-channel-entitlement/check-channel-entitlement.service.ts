import {
  type CampaignChannel,
  subscriptions,
  withOrgScope,
} from '@borradh-workspace/database';
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
import {
  type CheckChannelEntitlementInput,
  checkChannelEntitlementSchema,
} from './check-channel-entitlement.schema.js';

/** Reason codes explaining why a channel was blocked. */
export const ChannelBlockReasons = {
  REQUIRES_PAID_PLAN: 'requires_paid_plan',
} as const;

export type ChannelBlockReason =
  (typeof ChannelBlockReasons)[keyof typeof ChannelBlockReasons];

export interface BlockedChannel {
  channel: CampaignChannel;
  reason: ChannelBlockReason;
}

export interface CheckChannelEntitlementData {
  allowed: CampaignChannel[];
  blocked: BlockedChannel[];
}

/**
 * Channels that are always free / available regardless of plan.
 */
const FREE_CHANNELS: ReadonlySet<CampaignChannel> = new Set(['email']);

/**
 * Channels gated behind an active (or trialing) paid subscription.
 */
const GATED_CHANNELS: ReadonlySet<CampaignChannel> = new Set([
  'sms',
  'whatsapp',
]);

const checkChannelEntitlementImpl = async (
  db: DbConnection,
  input: CheckChannelEntitlementInput
): Promise<Result<CheckChannelEntitlementData>> => {
  const parsed = checkChannelEntitlementSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, channels } = parsed.data;

  const subscription = await withOrgScope(
    (tx) =>
      tx.query.subscriptions.findFirst({
        where: eq(subscriptions.organizationId, organizationId),
        columns: { status: true },
      }),
    { db }
  );

  // An org is "entitled" to gated channels only with an active or trialing
  // subscription — mirrors how the rest of billing treats a live plan.
  const isEntitled =
    subscription?.status === 'active' || subscription?.status === 'trialing';

  const allowed: CampaignChannel[] = [];
  const blocked: BlockedChannel[] = [];

  for (const channel of channels) {
    if (FREE_CHANNELS.has(channel) || isEntitled) {
      allowed.push(channel);
      continue;
    }

    if (GATED_CHANNELS.has(channel)) {
      blocked.push({
        channel,
        reason: ChannelBlockReasons.REQUIRES_PAID_PLAN,
      });
      continue;
    }

    // Unknown channel — fail open to avoid blocking legitimate sends.
    allowed.push(channel);
  }

  return ok({ allowed, blocked });
};

/**
 * Determine which campaign channels an organization is entitled to send on,
 * based on its subscription. Read-only; SMS/WhatsApp require a paid plan,
 * email is always allowed.
 */
export const checkChannelEntitlement = (
  db: DbConnection,
  input: CheckChannelEntitlementInput
) =>
  trackedResult(
    'campaigns.checkChannelEntitlement',
    () => checkChannelEntitlementImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        channels: input.channels.join(','),
      },
      internalErrorsOnly: true,
    }
  );

export type CheckChannelEntitlementResult = Awaited<
  ReturnType<typeof checkChannelEntitlement>
>;
