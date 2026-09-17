import { randomBytes } from 'node:crypto';
import {
  member,
  organization,
  organizationLocation,
  product,
  productReservation,
  productStock,
  sale,
  saleItem,
  salePayment,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, sql } from 'drizzle-orm';
import { dispatchNotification } from '../../../notifications/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type FinalizeShopCheckoutInput,
  finalizeShopCheckoutSchema,
} from './finalize-shop-checkout.schema.js';

async function sendOrderConfirmedEmail(input: {
  email: string;
  clinicName: string;
  locationName: string;
  slug: string;
  accessToken: string;
}) {
  const { NotificationEmail, sendEmail } = await import(
    '@borradh-workspace/email'
  );
  const { apiEnv } = await import('@borradh-workspace/env/api');
  await sendEmail({
    to: input.email,
    subject: `We received your order from ${input.clinicName}`,
    template: NotificationEmail,
    props: {
      title: 'Your order is confirmed',
      body: `We will prepare your order for collection at ${input.locationName}. We will email you when it is ready.`,
      actionUrl: apiEnv.WEB_URL
        ? `${apiEnv.WEB_URL}/sites/${input.slug}/shop/orders/${input.accessToken}`
        : undefined,
      actionLabel: 'View order',
    },
  });
}

/**
 * Turns a paid Stripe Checkout Session into the existing sale model.
 *
 * The reservation already froze the product, branch, quantity and price before
 * Stripe was opened. This service consumes that hold exactly once, creates the
 * paid sale + sale lines, then puts it into the collection queue.
 */
const finalizeShopCheckoutImpl = async (
  db: DbConnection,
  input: FinalizeShopCheckoutInput
): Promise<Result<{ saleId?: string; action: 'created' | 'ignored' }>> => {
  const parsed = finalizeShopCheckoutSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid shop checkout')
    );
  }
  const data = parsed.data;

  try {
    const result = await withOrgScope(
      (outerTx) =>
        outerTx.transaction(async (tx) => {
          // Stripe retries completed webhooks. The unique session id makes this
          // a harmless no-op rather than a duplicate order/stock decrement.
          const alreadyCreated = await tx.query.sale.findFirst({
            where: and(
              eq(sale.organizationId, data.organizationId),
              eq(sale.shopCheckoutSessionId, data.checkoutSessionId)
            ),
            columns: { id: true },
          });
          if (alreadyCreated)
            return { action: 'ignored' as const, saleId: alreadyCreated.id };

          const reservations = await tx.query.productReservation.findMany({
            where: eq(productReservation.cartId, data.cartId),
          });
          if (reservations.length === 0) {
            return {
              error: new FeatureError(
                ErrorCodes.NOT_FOUND,
                'Shop reservation not found'
              ),
            };
          }
          if (
            reservations.some(
              (row) => row.stripeCheckoutSessionId !== data.checkoutSessionId
            )
          ) {
            return {
              error: new FeatureError(
                ErrorCodes.CONFLICT,
                'Checkout session does not own this reservation'
              ),
            };
          }
          if (
            reservations.some(
              (row) => row.productName == null || row.unitPriceCents == null
            )
          ) {
            return {
              error: new FeatureError(
                ErrorCodes.INVALID_STATE,
                'Shop reservation is missing its price snapshot'
              ),
            };
          }

          const locationId = reservations[0]?.locationId;
          if (
            !locationId ||
            reservations.some((r) => r.locationId !== locationId)
          ) {
            return {
              error: new FeatureError(
                ErrorCodes.CONFLICT,
                'A shop order must have one collection location'
              ),
            };
          }

          // `sale.created_by_id` predates guest checkout and is required. The
          // owner is only a system attribution anchor; customerEmail records
          // who actually placed the online order.
          const owner = await tx.query.member.findFirst({
            where: and(
              eq(member.organizationId, data.organizationId),
              eq(member.role, 'owner')
            ),
            columns: { userId: true },
          });
          if (!owner) {
            return {
              error: new FeatureError(
                ErrorCodes.NOT_FOUND,
                'Clinic owner not found for shop order'
              ),
            };
          }

          const subtotalCents = reservations.reduce(
            (sum, row) => sum + (row.unitPriceCents as number) * row.quantity,
            0
          );
          const [created] = await tx
            .insert(sale)
            .values({
              organizationId: data.organizationId,
              locationId,
              createdById: owner.userId,
              status: 'completed',
              subtotalCents,
              totalCents: subtotalCents,
              currency: data.currency.toLowerCase(),
              completedAt: new Date(),
              fulfilmentMethod: 'collect',
              fulfilmentStatus: 'awaiting_collection',
              shopCartId: data.cartId,
              shopCheckoutSessionId: data.checkoutSessionId,
              customerEmail: data.customerEmail?.toLowerCase() ?? null,
              orderAccessToken: randomBytes(24).toString('base64url'),
              orderConfirmedAt: new Date(),
            })
            .returning({
              id: sale.id,
              orderAccessToken: sale.orderAccessToken,
            });
          if (!created) throw new Error('Failed to create shop sale');

          await tx.insert(saleItem).values(
            reservations.map((row) => ({
              saleId: created.id,
              itemType: 'product' as const,
              productId: row.productId,
              name: row.productName as string,
              quantity: row.quantity,
              unitPriceCents: row.unitPriceCents as number,
              totalCents: (row.unitPriceCents as number) * row.quantity,
            }))
          );
          await tx.insert(salePayment).values({
            saleId: created.id,
            method: 'online_checkout',
            amountCents: subtotalCents,
            status: 'succeeded',
            stripePaymentIntentId: data.paymentIntentId ?? null,
          });

          // The reservation was the stock hold. At paid finalisation it becomes
          // the real stock movement, atomically with the sale.
          for (const row of reservations) {
            const stockedProduct = await tx.query.product.findFirst({
              where: eq(product.id, row.productId),
              columns: { trackStock: true },
            });
            if (!stockedProduct?.trackStock) continue;
            await tx
              .update(productStock)
              .set({
                quantity: sql`${productStock.quantity} - ${row.quantity}`,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(productStock.productId, row.productId),
                  eq(productStock.locationId, row.locationId)
                )
              );
          }
          await tx
            .delete(productReservation)
            .where(eq(productReservation.cartId, data.cartId));
          return { action: 'created' as const, saleId: created.id };
        }),
      { db }
    );
    if ('error' in result)
      return err(
        result.error ??
          new FeatureError(
            ErrorCodes.INTERNAL_ERROR,
            'Failed to finalise shop checkout'
          )
      );

    const saleId = result.saleId;
    if (result.action === 'created' && saleId) {
      void dispatchNotification(db, {
        organizationId: data.organizationId,
        type: 'shop_order_received',
        title: 'New online order',
        body: 'A paid collection order is waiting to be prepared.',
        linkPath: '/dashboard/sales/product-orders',
        data: { saleId },
      });
      // Confirmation is customer-facing but must never make Stripe retry a
      // successfully-finalised order. It is therefore best-effort after the
      // transaction, like the existing notification infrastructure.
      if (data.customerEmail) {
        const delivery = await withOrgScope(
          async (tx) => {
            const order = await tx.query.sale.findFirst({
              where: eq(sale.id, saleId),
              columns: { orderAccessToken: true, locationId: true },
            });
            const org = await tx.query.organization.findFirst({
              where: eq(organization.id, data.organizationId),
              columns: { name: true, slug: true },
            });
            const location = order?.locationId
              ? await tx.query.organizationLocation.findFirst({
                  where: eq(organizationLocation.id, order.locationId),
                  columns: { name: true },
                })
              : null;
            return { token: order?.orderAccessToken, org, location };
          },
          { db }
        );
        if (delivery.token && delivery.org) {
          void sendOrderConfirmedEmail({
            email: data.customerEmail,
            clinicName: delivery.org.name,
            slug: delivery.org.slug,
            locationName: delivery.location?.name ?? 'the clinic',
            accessToken: delivery.token,
          }).catch((error) =>
            logError('sales.shopOrderConfirmedEmail', error, {
              feature: 'sales',
              extra: { saleId: result.saleId },
            })
          );
        }
      }
    }
    return ok(result);
  } catch (error) {
    logError('sales.finalizeShopCheckout', error, {
      feature: 'sales',
      extra: { organizationId: data.organizationId, cartId: data.cartId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to finalise shop order'
      )
    );
  }
};

export const finalizeShopCheckout = (
  db: DbConnection,
  input: FinalizeShopCheckoutInput
) =>
  trackedResult(
    'sales.finalizeShopCheckout',
    () => finalizeShopCheckoutImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
    }
  );
