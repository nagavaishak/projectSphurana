import { sale, withOrgScope } from '@borradh-workspace/database';
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
  type UpdateShopFulfilmentInput,
  updateShopFulfilmentSchema,
} from './update-shop-fulfilment.schema.js';

async function sendReadyEmail(input: {
  email: string;
  clinicName: string;
  locationName: string;
  orderAccessToken: string;
  slug: string;
}) {
  const { NotificationEmail, sendEmail } = await import(
    '@borradh-workspace/email'
  );
  const { apiEnv } = await import('@borradh-workspace/env/api');
  const actionUrl = apiEnv.WEB_URL
    ? `${apiEnv.WEB_URL}/sites/${input.slug}/shop/orders/${input.orderAccessToken}`
    : undefined;
  await sendEmail({
    to: input.email,
    subject: `Your order from ${input.clinicName} is ready to collect`,
    template: NotificationEmail,
    props: {
      title: 'Your order is ready to collect',
      body: `Your order is ready for collection at ${input.locationName}.`,
      actionUrl,
      actionLabel: 'View order',
    },
  });
}

const updateShopFulfilmentImpl = async (
  db: DbConnection,
  input: UpdateShopFulfilmentInput
): Promise<Result<typeof sale.$inferSelect>> => {
  const parsed = updateShopFulfilmentSchema.safeParse(input);
  if (!parsed.success)
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid fulfilment update')
    );
  const data = parsed.data;
  try {
    const outcome = await withOrgScope(
      (tx) =>
        tx.transaction(async (trx) => {
          const existing = await trx.query.sale.findFirst({
            where: and(
              eq(sale.id, data.saleId),
              eq(sale.organizationId, data.organizationId)
            ),
            with: {
              location: { columns: { name: true } },
              organization: { columns: { name: true, slug: true } },
            },
          });
          if (!existing)
            return {
              error: new FeatureError(ErrorCodes.NOT_FOUND, 'Order not found'),
            };
          if (existing.fulfilmentMethod !== 'collect')
            return {
              error: new FeatureError(
                ErrorCodes.INVALID_STATE,
                'This is not a collection order'
              ),
            };
          if (existing.fulfilmentStatus === 'collected')
            return {
              error: new FeatureError(
                ErrorCodes.INVALID_STATE,
                'This order has already been collected'
              ),
            };
          if (
            data.status === 'collected' &&
            existing.fulfilmentStatus !== 'ready'
          )
            return {
              error: new FeatureError(
                ErrorCodes.INVALID_STATE,
                'Mark the order ready before it is collected'
              ),
            };
          if (data.status === 'ready' && existing.fulfilmentStatus === 'ready')
            return { row: existing, sendEmail: false };

          const [row] = await trx
            .update(sale)
            .set({
              fulfilmentStatus: data.status,
              collectedAt: data.status === 'collected' ? new Date() : null,
              collectedById: data.status === 'collected' ? data.userId : null,
              // Claim the email in the same update, so a repeat click cannot
              // send another ready message.
              readyNotificationSentAt:
                data.status === 'ready' &&
                existing.readyNotificationSentAt == null
                  ? new Date()
                  : existing.readyNotificationSentAt,
              updatedAt: new Date(),
            })
            .where(eq(sale.id, existing.id))
            .returning();
          if (!row)
            return {
              error: new FeatureError(
                ErrorCodes.INTERNAL_ERROR,
                'Order could not be updated'
              ),
            };
          return {
            row,
            sendEmail:
              data.status === 'ready' &&
              existing.readyNotificationSentAt == null &&
              existing.customerEmail != null &&
              existing.orderAccessToken != null,
            email: existing.customerEmail,
            clinicName: existing.organization?.name ?? 'your clinic',
            slug: existing.organization?.slug ?? '',
            locationName: existing.location?.name ?? 'the clinic',
            token: existing.orderAccessToken,
          };
        }),
      { db }
    );
    if ('error' in outcome)
      return err(
        outcome.error ??
          new FeatureError(
            ErrorCodes.INTERNAL_ERROR,
            'Failed to update fulfilment'
          )
      );
    if (outcome.sendEmail && outcome.email && outcome.token) {
      // Email is intentionally after commit: the queue state must never roll
      // back because Resend has a temporary problem.
      void sendReadyEmail({
        email: outcome.email,
        clinicName: outcome.clinicName,
        locationName: outcome.locationName,
        orderAccessToken: outcome.token,
        slug: outcome.slug,
      }).catch((error) =>
        logError('sales.shopReadyEmail', error, {
          feature: 'sales',
          extra: { saleId: data.saleId },
        })
      );
    }
    return ok(outcome.row);
  } catch (error) {
    logError('sales.updateShopFulfilment', error, {
      feature: 'sales',
      extra: data,
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to update fulfilment')
    );
  }
};

export const updateShopFulfilment = (
  db: DbConnection,
  input: UpdateShopFulfilmentInput
) =>
  trackedResult(
    'sales.updateShopFulfilment',
    () => updateShopFulfilmentImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        saleId: input.saleId,
        status: input.status,
      },
    }
  );
