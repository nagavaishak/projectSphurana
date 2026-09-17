import {
  and,
  asc,
  db,
  eq,
  organization,
  organizationLocation,
  product,
  productBrand,
  productReservation,
  productRestockNotification,
  productStock,
  sql,
  stripeConnectIntegration,
  withPublicOrgScope,
} from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import { getShopOrderStatus } from '@borradh-workspace/features/sales';
import { getStripeConnectService } from '@borradh-workspace/integrations/stripe';
import { HttpException, HttpStatus } from '@nestjs/common';
import { z } from 'zod';

const emailSchema = z.object({ email: z.string().email().max(320) });
const checkoutSchema = z.object({
  cartId: z.string().min(16).max(128),
  email: z.string().email().max(320).optional(),
  locationId: z.string().min(1).max(128),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().min(1).max(20),
      })
    )
    .min(1)
    .max(30),
});

const orgFor = async (slug: string) => {
  const org = await db.query.organization.findFirst({
    where: eq(organization.slug, slug),
    columns: { id: true, name: true, slug: true },
  });
  if (!org) throw new HttpException('Shop not found', HttpStatus.NOT_FOUND);
  return org;
};

/** The public catalogue deliberately exposes only active, retail-enabled products. */
export const listPublicShop = async (slug: string) => {
  const org = await orgFor(slug);
  const products = await withPublicOrgScope(
    org.id,
    (tx) =>
      tx
        .select({
          id: product.id,
          name: product.name,
          images: product.images,
          shortDescription: product.shortDescription,
          retailPriceCents: product.retailPriceCents,
          brand: productBrand.name,
          inStock: sql<boolean>`exists (select 1 from ${productStock} ps where ps.product_id = ${product.id} and ps.quantity > 0)`,
        })
        .from(product)
        .leftJoin(productBrand, eq(product.brandId, productBrand.id))
        .where(
          and(
            eq(product.organizationId, org.id),
            eq(product.isActive, true),
            eq(product.retailEnabled, true)
          )
        )
        .orderBy(asc(product.name)),
    { db }
  );
  return { organization: org, products };
};

/** Collection locations are chosen only at checkout, never while browsing. */
export const listCollectionLocations = async (slug: string) => {
  const org = await orgFor(slug);
  const locations = await withPublicOrgScope(
    org.id,
    (tx) =>
      tx
        .select({
          id: organizationLocation.id,
          name: organizationLocation.name,
          addressLine1: organizationLocation.addressLine1,
          city: organizationLocation.city,
          postalCode: organizationLocation.postalCode,
          country: organizationLocation.country,
          isPrimary: organizationLocation.isPrimary,
        })
        .from(organizationLocation)
        .where(eq(organizationLocation.organizationId, org.id))
        .orderBy(asc(organizationLocation.sortOrder)),
    { db }
  );
  return { locations };
};

export const getPublicShopProduct = async (slug: string, productId: string) => {
  const org = await orgFor(slug);
  const found = await withPublicOrgScope(
    org.id,
    async (tx) => {
      const [row] = await tx
        .select({
          id: product.id,
          name: product.name,
          images: product.images,
          description: product.description,
          shortDescription: product.shortDescription,
          retailPriceCents: product.retailPriceCents,
          measureUnit: product.measureUnit,
          measureAmount: product.measureAmount,
          brand: productBrand.name,
          inStock: sql<boolean>`exists (select 1 from ${productStock} ps where ps.product_id = ${product.id} and ps.quantity > 0)`,
        })
        .from(product)
        .leftJoin(productBrand, eq(product.brandId, productBrand.id))
        .where(
          and(
            eq(product.id, productId),
            eq(product.organizationId, org.id),
            eq(product.isActive, true),
            eq(product.retailEnabled, true)
          )
        );
      return row ?? null;
    },
    { db }
  );
  if (!found)
    throw new HttpException('Product not found', HttpStatus.NOT_FOUND);
  return { organization: org, product: found };
};

/** Guest order status is protected by the opaque token sent by email. */
export const getPublicShopOrder = async (slug: string, accessToken: string) => {
  const org = await orgFor(slug);
  const result = await getShopOrderStatus(db, {
    organizationId: org.id,
    accessToken,
  });
  if (!result.success)
    throw new HttpException(result.error.message, HttpStatus.NOT_FOUND);
  return {
    organization: { name: org.name, slug: org.slug },
    order: result.data,
  };
};

/**
 * Re-read the catalogue and hold stock just before creating Stripe Checkout.
 * The browser may suggest product ids/quantities; price and tax code always
 * come from Borradh's database.
 */
export const createPublicShopCheckout = async (slug: string, body: unknown) => {
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success)
    throw new HttpException('Invalid cart', HttpStatus.BAD_REQUEST);
  const org = await orgFor(slug);
  const input = parsed.data;
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  const held = await withPublicOrgScope(
    org.id,
    async (tx) =>
      tx.transaction(async (trx) => {
        const location = await trx.query.organizationLocation.findFirst({
          where: and(
            eq(organizationLocation.id, input.locationId),
            eq(organizationLocation.organizationId, org.id)
          ),
          columns: { id: true },
        });
        if (!location)
          throw new HttpException(
            'Collection location not found',
            HttpStatus.BAD_REQUEST
          );

        // A retry replaces the old hold rather than consuming stock twice.
        await trx
          .delete(productReservation)
          .where(eq(productReservation.cartId, input.cartId));

        const lines: Array<{
          id: string;
          name: string;
          shortDescription: string | null;
          images: string[] | null;
          taxCode: string | null;
          retailPriceCents: number;
          quantity: number;
        }> = [];
        for (const item of input.items) {
          // Lock this stock row so available-minus-reservations is serial.
          const rows = await trx.execute(sql`
            SELECT p.id, p.name, p.short_description, p.images, p.tax_code, p.retail_price_cents, ps.quantity
            FROM product p JOIN product_stock ps ON ps.product_id = p.id
            WHERE p.id = ${item.productId} AND p.organization_id = ${org.id}
              AND p.is_active = true AND p.retail_enabled = true AND ps.location_id = ${input.locationId}
              AND (NOT EXISTS (SELECT 1 FROM product_location pl WHERE pl.product_id = p.id)
                OR EXISTS (SELECT 1 FROM product_location pl WHERE pl.product_id = p.id AND pl.location_id = ${input.locationId}))
            FOR UPDATE OF ps
          `);
          const row = rows[0] as
            | {
                id: string;
                name: string;
                short_description: string | null;
                images: string[] | null;
                tax_code: string | null;
                retail_price_cents: number | null;
                quantity: number;
              }
            | undefined;
          if (!row || row.retail_price_cents === null)
            throw new HttpException(
              'An item is not available at that collection location',
              HttpStatus.CONFLICT
            );
          const reserved = await trx.execute(
            sql`SELECT COALESCE(SUM(quantity), 0)::int AS quantity FROM product_reservation WHERE product_id = ${item.productId} AND location_id = ${input.locationId} AND expires_at > now()`
          );
          const reservedQty = Number(
            (reserved[0] as { quantity?: number })?.quantity ?? 0
          );
          if (row.quantity - reservedQty < item.quantity)
            throw new HttpException(
              `${row.name} is no longer available in that quantity`,
              HttpStatus.CONFLICT
            );
          lines.push({
            id: row.id,
            name: row.name,
            shortDescription: row.short_description,
            images: row.images,
            taxCode: row.tax_code,
            retailPriceCents: row.retail_price_cents,
            quantity: item.quantity,
          });
        }
        await trx.insert(productReservation).values(
          lines.map((line) => ({
            productId: line.id,
            locationId: input.locationId,
            quantity: line.quantity,
            cartId: input.cartId,
            expiresAt,
            productName: line.name,
            unitPriceCents: line.retailPriceCents,
            taxCode: line.taxCode,
          }))
        );
        return lines;
      }),
    { db }
  );

  const integration = await withPublicOrgScope(
    org.id,
    (tx) =>
      tx.query.stripeConnectIntegration.findFirst({
        where: eq(stripeConnectIntegration.organizationId, org.id),
      }),
    { db }
  );
  if (!integration?.isActive || !integration.chargesEnabled)
    throw new HttpException(
      'Online payments are not available for this clinic',
      HttpStatus.SERVICE_UNAVAILABLE
    );
  try {
    const checkout = await getStripeConnectService().createShopCheckout({
      connectedAccountId: integration.stripeAccountId,
      currency: integration.defaultCurrency ?? 'eur',
      customerEmail: input.email,
      successUrl: `${apiEnv.MARKETING_URL ?? 'https://www.borradh.com'}/sites/${encodeURIComponent(slug)}/shop/confirmation?cart=${encodeURIComponent(input.cartId)}&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${apiEnv.MARKETING_URL ?? 'https://www.borradh.com'}/sites/${encodeURIComponent(slug)}/shop/cart`,
      expiresAt,
      metadata: {
        type: 'shop_checkout',
        organizationId: org.id,
        cartId: input.cartId,
        collectionLocationId: input.locationId,
      },
      idempotencyKey: `shop-cart-${input.cartId}-${expiresAt.getTime()}`,
      lineItems: held.map((line) => ({
        name: line.name,
        description: line.shortDescription,
        image: line.images?.[0],
        taxCode: line.taxCode,
        unitAmountCents: line.retailPriceCents,
        quantity: line.quantity,
      })),
    });
    await withPublicOrgScope(
      org.id,
      (tx) =>
        tx
          .update(productReservation)
          .set({ stripeCheckoutSessionId: checkout.sessionId })
          .where(eq(productReservation.cartId, input.cartId)),
      { db }
    );
    return { checkoutUrl: checkout.url, expiresAt };
  } catch (error) {
    // Holds remain only until expiry; never charge without one.
    if (
      error instanceof Error &&
      error.name === 'StripeTaxSetupIncompleteError'
    )
      throw new HttpException(error.message, HttpStatus.CONFLICT);
    throw error;
  }
};

export const registerRestockNotification = async (
  slug: string,
  productId: string,
  body: unknown
) => {
  const parsed = emailSchema.safeParse(body);
  if (!parsed.success)
    throw new HttpException(
      'Enter a valid email address',
      HttpStatus.BAD_REQUEST
    );
  const org = await orgFor(slug);
  return withPublicOrgScope(
    org.id,
    async (tx) => {
      const existing = await tx.query.product.findFirst({
        where: and(
          eq(product.id, productId),
          eq(product.organizationId, org.id),
          eq(product.isActive, true),
          eq(product.retailEnabled, true)
        ),
        columns: { id: true },
      });
      if (!existing)
        throw new HttpException('Product not found', HttpStatus.NOT_FOUND);
      await tx
        .insert(productRestockNotification)
        .values({ productId, email: parsed.data.email.toLowerCase() })
        .onConflictDoNothing();
      return { ok: true };
    },
    { db }
  );
};
