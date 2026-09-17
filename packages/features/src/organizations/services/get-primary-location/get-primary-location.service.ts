import {
  organizationLocation,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';

export const getPrimaryLocationSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type GetPrimaryLocationInput = z.infer<typeof getPrimaryLocationSchema>;

export interface OrgPrimaryLocation {
  id: string;
  /** Human-readable label for display, e.g. "Pelham Street, Stoke on Trent". */
  label: string;
  city: string;
  country: string;
  /** Geocoded coordinates — null when the location hasn't been geocoded. */
  latitude: number | null;
  longitude: number | null;
}

/**
 * Resolve the organisation's primary location — the one ad targeting and the
 * campaign preview should anchor on. Prefers `isPrimary`, then `sortOrder`, then
 * the oldest row. Returns `null` (not an error) when the org has no location.
 *
 * `label` is a concise display string (street + town, or just the town);
 * `latitude`/`longitude` drive the actual Meta radius targeting.
 */
const getPrimaryLocationImpl = async (
  db: DbConnection,
  input: GetPrimaryLocationInput
): Promise<Result<OrgPrimaryLocation | null>> => {
  const parsed = getPrimaryLocationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const row = await db.query.organizationLocation.findFirst({
    where: eq(organizationLocation.organizationId, parsed.data.organizationId),
    // Primary first, then explicit sort order, then oldest.
    orderBy: [
      desc(organizationLocation.isPrimary),
      asc(organizationLocation.sortOrder),
      asc(organizationLocation.createdAt),
    ],
  });

  if (!row) return ok(null);

  // Build a concise label: street + town when distinct, else whichever exists.
  const street = row.addressLine1?.trim();
  const town = row.city?.trim();
  const label =
    street && town && !street.toLowerCase().includes(town.toLowerCase())
      ? `${street}, ${town}`
      : (town ?? street ?? row.name ?? 'your clinic');

  return ok({
    id: row.id,
    label,
    city: town ?? '',
    country: row.country,
    latitude: row.latitude,
    longitude: row.longitude,
  });
};

export const getPrimaryLocation = (
  db: DbConnection,
  input: GetPrimaryLocationInput
) =>
  trackedResult(
    'organizations.getPrimaryLocation',
    () => withOrgScope((tx) => getPrimaryLocationImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type GetPrimaryLocationResult = Awaited<
  ReturnType<typeof getPrimaryLocation>
>;
