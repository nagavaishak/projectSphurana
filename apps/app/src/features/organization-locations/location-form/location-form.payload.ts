import {
  createLocationRequestSchema,
  updateLocationRequestSchema,
} from '@borradh-workspace/contracts';
import type { z } from 'zod';
import type {
  CreateLocationIntent,
  UpdateLocationIntent,
} from './location-form.input';

/**
 * The single wire body for `POST /organization-locations`.
 *
 * The schema is NOT declared here — it is the canonical
 * {@link createLocationRequestSchema} from `@borradh-workspace/contracts`, the
 * same object the backend's `createLocationSchema` extends with
 * `organizationId` and the API DTO validates against. It is `.strict()`, so an
 * extra or missing field is a parse error here rather than a 400 at the user.
 */
export const createLocationBodySchema = createLocationRequestSchema;

export type CreateLocationBody = z.infer<typeof createLocationBodySchema>;

/** A blank optional is absent, not `''` — the contract takes `null`. */
const orNull = (value: string): string | null => value.trim() || null;

/**
 * Build the optional `catalog` block, or omit it entirely.
 *
 * Omission is the point: "copy nothing" is the default, and an absent key means
 * the server does no catalogue work at all rather than running five no-op
 * queries. Empty arrays are dropped for the same reason — an empty
 * `serviceIds: []` says nothing the absent key does not.
 */
function buildCatalog(
  intent: CreateLocationIntent
): CreateLocationBody['catalog'] {
  const entries = {
    practitionerIds: intent.practitionerIds,
    serviceIds: intent.serviceIds,
    productIds: intent.productIds,
    membershipPlanIds: intent.membershipPlanIds,
    offerIds: intent.offerIds,
  };

  const catalog: Record<string, unknown> = {};
  for (const [key, ids] of Object.entries(entries)) {
    if (ids.length > 0) catalog[key] = ids;
  }
  if (intent.copyFromLocationId) {
    catalog.copyFromLocationId = intent.copyFromLocationId;
  }

  return Object.keys(catalog).length > 0
    ? (catalog as CreateLocationBody['catalog'])
    : undefined;
}

export function buildCreateLocationPayload(
  intent: CreateLocationIntent
): CreateLocationBody {
  return createLocationBodySchema.parse({
    name: orNull(intent.name),
    addressLine1: intent.addressLine1.trim(),
    addressLine2: orNull(intent.addressLine2),
    city: intent.city.trim(),
    county: orNull(intent.county),
    postalCode: orNull(intent.postalCode),
    country: intent.country,
    isPrimary: intent.isPrimary,
    latitude: intent.latitude,
    longitude: intent.longitude,
    catalog: buildCatalog(intent),
  });
}

/**
 * The single wire body for `PUT /organization-locations/:id`.
 *
 * A different contract from create, not a subset of it: update is PATCH-shaped,
 * so `isPrimary` carries NO default (omitting it must mean "leave primary as it
 * is", never "demote"), and `addressLine1` / `city` may be left alone but not
 * blanked. Parsing through the canonical schema is what holds the editor to
 * that.
 */
export const updateLocationBodySchema = updateLocationRequestSchema;

export type UpdateLocationBody = z.infer<typeof updateLocationBodySchema>;

export function buildUpdateLocationPayload(
  intent: UpdateLocationIntent
): UpdateLocationBody {
  return updateLocationBodySchema.parse({
    name: orNull(intent.name),
    addressLine1: intent.addressLine1.trim(),
    addressLine2: orNull(intent.addressLine2),
    city: intent.city.trim(),
    county: orNull(intent.county),
    postalCode: orNull(intent.postalCode),
    country: intent.country,
    isPrimary: intent.isPrimary,
    latitude: intent.latitude,
    longitude: intent.longitude,
  });
}
