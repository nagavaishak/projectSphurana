import {
  organizationServiceLocation,
  organizationServiceVariantLocation,
} from '@borradh-workspace/database';
import { and, eq, inArray } from 'drizzle-orm';
import type { DbConnection } from './core/types.js';

/**
 * Per-branch price / duration for a service, from the
 * `organization_service_location` join row.
 *
 * NULL on either column means INHERIT the org's value — not "free" and not
 * "no duration". A branch that only charges differently sets the price column
 * and leaves the duration NULL, and that has to keep working.
 */
export interface ServiceLocationOverride {
  priceCentsOverride: number | null;
  durationMinutesOverride: number | null;
}

/** The shape any override-able service row must have. */
interface PricedService {
  id: string;
  priceCents: number | null;
  appointmentDuration: number | null;
}

/**
 * Load the branch's price/duration overrides for a set of services, keyed by
 * service id. One query regardless of catalogue size; empty map when no
 * branch is in play.
 *
 * WHY THIS IS SHARED. Four call sites read a service's price — the dashboard
 * list, the dashboard detail, the public venue page and the public booking
 * form — and every one of them is a place a customer can be quoted a number.
 * When the override logic was inline, two of the four had it and two did not,
 * which is exactly the failure this centralises away: the response shape is
 * identical either way, so a missing override is invisible until someone is
 * charged the wrong amount.
 *
 * SCOPE: this overrides the SERVICE ROW's own price and duration. Variant
 * prices are overridden separately by `loadVariantLocationOverrides` below —
 * they have to be, because a variant-priced service has no single price to
 * override. Use BOTH on any surface that returns variants.
 */
export async function loadServiceLocationOverrides(
  db: DbConnection,
  input: { serviceIds: readonly string[]; locationId: string | undefined }
): Promise<Map<string, ServiceLocationOverride>> {
  const { serviceIds, locationId } = input;
  if (!locationId || serviceIds.length === 0) return new Map();

  const rows = await db.query.organizationServiceLocation.findMany({
    where: and(
      inArray(organizationServiceLocation.serviceId, [...serviceIds]),
      eq(organizationServiceLocation.locationId, locationId)
    ),
    columns: {
      serviceId: true,
      priceCentsOverride: true,
      durationMinutesOverride: true,
    },
  });

  return new Map(rows.map((row) => [row.serviceId, row]));
}

/**
 * Apply a branch override to one service row, preserving every other field.
 * A missing override (no join row for this branch) returns the row unchanged.
 */
export function applyServiceLocationOverride<T extends PricedService>(
  service: T,
  override: ServiceLocationOverride | undefined
): T {
  if (!override) return service;
  return {
    ...service,
    priceCents: override.priceCentsOverride ?? service.priceCents,
    appointmentDuration:
      override.durationMinutesOverride ?? service.appointmentDuration,
  };
}

/** Per-branch price for one variant. */
export interface VariantLocationOverride {
  priceCentsOverride: number | null;
}

interface PricedVariant {
  id: string;
  priceCents: number | null;
}

/**
 * Load the branch's per-variant price overrides, keyed by variant id.
 *
 * WHY THIS IS SEPARATE from `loadServiceLocationOverrides`. For a
 * variant-priced service, `organization_service.price_cents` is a "from" — the
 * cheapest option — and what a customer actually pays is the VARIANT's price.
 * Overriding only the service row on such a service moves the "from" while
 * leaving every option it summarises at the org price, which is worse than not
 * overriding at all: the headline and the list now disagree.
 *
 * Empty map when no branch is in play, exactly like the service-level loader.
 */
export async function loadVariantLocationOverrides(
  db: DbConnection,
  input: { variantIds: readonly string[]; locationId: string | undefined }
): Promise<Map<string, VariantLocationOverride>> {
  const { variantIds, locationId } = input;
  if (!locationId || variantIds.length === 0) return new Map();

  const rows = await db.query.organizationServiceVariantLocation.findMany({
    where: and(
      inArray(organizationServiceVariantLocation.variantId, [...variantIds]),
      eq(organizationServiceVariantLocation.locationId, locationId)
    ),
    columns: { variantId: true, priceCentsOverride: true },
  });

  return new Map(rows.map((row) => [row.variantId, row]));
}

/**
 * Apply a branch override to one variant, preserving every other field.
 *
 * `?? variant.priceCents` and not `||`: a branch that gives an option away
 * free sets 0, and `0 || x` would silently fall back to the org price.
 */
export function applyVariantLocationOverride<T extends PricedVariant>(
  variant: T,
  override: VariantLocationOverride | undefined
): T {
  if (!override) return variant;
  return {
    ...variant,
    priceCents: override.priceCentsOverride ?? variant.priceCents,
  };
}
