import {
  organization,
  organizationLocation,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, asc, desc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
  timezoneForLocation,
} from '../../../shared/index.js';
import {
  type SyncOrganizationTimezoneInput,
  syncOrganizationTimezoneSchema,
} from './sync-organization-timezone.schema.js';

export interface SyncOrganizationTimezoneResult {
  /** The org's timezone after the sync — unchanged if nothing was written. */
  timezone: string;
  /** True when this call actually wrote a new value. */
  changed: boolean;
  reason:
    | 'written'
    | 'already-set'
    | 'unchanged'
    | 'no-location'
    | 'unresolvable';
}

/**
 * Derive `organization.timezone` from the org's primary location and write it.
 *
 * This is the write side that went missing when the fresha-clone work replaced
 * the June 2026 live derivation (`timezoneForLocation`) with a stored column.
 * The column's only writer was a one-shot backfill, so every org created after
 * 2026-07-18 kept the `'UTC'` default while the calendar, the booking form and
 * Claire all read it as the truth.
 *
 * Call it wherever a location is written. It is cheap, idempotent, and by
 * default refuses to touch an org whose timezone is already something other
 * than `'UTC'`, so it is safe to call unconditionally.
 */
const syncOrganizationTimezoneImpl = async (
  db: DbConnection,
  input: SyncOrganizationTimezoneInput
): Promise<Result<SyncOrganizationTimezoneResult>> => {
  const parsed = syncOrganizationTimezoneSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, force } = parsed.data;

  try {
    const org = await db.query.organization.findFirst({
      where: and(eq(organization.id, organizationId), notDeleted(organization)),
      columns: { id: true, timezone: true },
    });

    if (!org) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
      );
    }

    const current = org.timezone || 'UTC';

    // Never walk over a value someone chose. `'UTC'` is the column default, so
    // it reads as "never set" rather than as a decision — which is exactly the
    // state the 16 drifted orgs are in.
    if (!force && current !== 'UTC') {
      return ok({ timezone: current, changed: false, reason: 'already-set' });
    }

    // Same ordering rule as getPrimaryLocation and the prod backfill: primary
    // first, then explicit sort order, then oldest.
    const location = await db.query.organizationLocation.findFirst({
      where: eq(organizationLocation.organizationId, organizationId),
      orderBy: [
        desc(organizationLocation.isPrimary),
        asc(organizationLocation.sortOrder),
        asc(organizationLocation.createdAt),
      ],
      columns: { latitude: true, longitude: true, country: true },
    });

    if (!location) {
      return ok({ timezone: current, changed: false, reason: 'no-location' });
    }

    const resolved = timezoneForLocation(location);

    if (!resolved) {
      return ok({ timezone: current, changed: false, reason: 'unresolvable' });
    }

    if (resolved === current) {
      return ok({ timezone: current, changed: false, reason: 'unchanged' });
    }

    await db
      .update(organization)
      .set({ timezone: resolved })
      .where(eq(organization.id, organizationId));

    return ok({ timezone: resolved, changed: true, reason: 'written' });
  } catch (error) {
    logError('organizations.syncOrganizationTimezone', error, {
      feature: 'organizations',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to sync organization timezone'
      )
    );
  }
};

export const syncOrganizationTimezone = (
  db: DbConnection,
  input: SyncOrganizationTimezoneInput
) =>
  trackedResult(
    'organizations.syncOrganizationTimezone',
    () => withOrgScope((tx) => syncOrganizationTimezoneImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );
