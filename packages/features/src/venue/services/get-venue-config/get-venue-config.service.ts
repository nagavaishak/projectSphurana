import {
  organization,
  organizationLocation,
  organizationPhoto,
  organizationService,
  organizationServiceLocation,
  organizationServiceVariant,
  practitioner,
  practitionerLocation,
  withPublicOrgScope,
} from '@borradh-workspace/database';
import type { VenueAmenity } from '@borradh-workspace/labels';
import { trackedResult } from '@borradh-workspace/observability';
import { and, asc, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  applyServiceLocationOverride,
  applyVariantLocationOverride,
  atLocationOrUnassigned,
  currencyForCountry,
  err,
  loadServiceCategoryNames,
  loadServiceLocationOverrides,
  loadVariantLocationOverrides,
  notDeleted,
  ok,
  serviceCategoryName,
} from '../../../shared/index.js';
import type { VenueConfig, VenueOpeningHours } from '../../models/index.js';
import {
  type GetVenueConfigInput,
  getVenueConfigSchema,
} from './get-venue-config.schema.js';

const getVenueConfigImpl = async (
  db: DbConnection,
  input: GetVenueConfigInput
): Promise<Result<VenueConfig>> => {
  const parsed = getVenueConfigSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationSlug, locationSlug } = parsed.data;

  // ── Slug bootstrap (runs OUTSIDE withPublicOrgScope) ──────────────────────
  // The slug → org_id resolution must happen before org context is established;
  // the slug_bootstrap RLS policy on `organization` permits app_public to SELECT
  // a non-mock org row by slug with no app.current_org_id set. Mirrors
  // get-general-booking-config.
  const org = await db.query.organization.findFirst({
    where: and(
      eq(organization.slug, organizationSlug),
      notDeleted(organization)
    ),
  });

  if (!org) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
    );
  }

  // ── Scoped reads (runs INSIDE withPublicOrgScope) ─────────────────────────
  // Now that we have the org id, every subsequent query is scoped to this org.
  // ALWAYS pass { db } so the helper uses the injected connection (the
  // app_public pool, or the test mock db, not the shared default pool).
  return withPublicOrgScope(
    org.id,
    async (tx): Promise<Result<VenueConfig>> => {
      // Resolve the venue: a specific branch by slug, else the org's PRIMARY
      // location (isPrimary=true wins; ties break on the lowest sortOrder).
      const location = locationSlug
        ? await tx.query.organizationLocation.findFirst({
            where: and(
              eq(organizationLocation.organizationId, org.id),
              eq(organizationLocation.slug, locationSlug)
            ),
          })
        : await tx.query.organizationLocation.findFirst({
            where: eq(organizationLocation.organizationId, org.id),
            orderBy: [
              desc(organizationLocation.isPrimary),
              asc(organizationLocation.sortOrder),
            ],
          });

      if (!location) {
        return err(
          new FeatureError(ErrorCodes.NOT_FOUND, 'Location not found')
        );
      }

      // Keeps BOTH sides: this branch's per-venue service scoping, and main's
      // real category names.
      const [
        locationPhotos,
        sharedPhotos,
        services,
        team,
        categoryNames,
        siblingBranch,
      ] = await Promise.all([
        // This venue's gallery.
        tx.query.organizationPhoto.findMany({
          where: eq(organizationPhoto.locationId, location.id),
          orderBy: [asc(organizationPhoto.sortOrder)],
        }),
        // Org-wide photos (no specific branch) — shown on every venue, after
        // the branch-specific ones.
        tx.query.organizationPhoto.findMany({
          where: and(
            eq(organizationPhoto.organizationId, org.id),
            isNull(organizationPhoto.locationId)
          ),
          orderBy: [asc(organizationPhoto.sortOrder)],
        }),
        // Scoped to THIS branch. The page has already resolved a location, so
        // listing a service the branch does not offer would advertise it at an
        // address you cannot get it. Zero join rows still means "offered
        // everywhere", so an org that has never assigned services is unchanged.
        tx.query.organizationService.findMany({
          where: and(
            eq(organizationService.organizationId, org.id),
            eq(organizationService.isActive, true),
            atLocationOrUnassigned(
              tx,
              organizationServiceLocation,
              organizationServiceLocation.serviceId,
              organizationService.id,
              organizationServiceLocation.locationId,
              location.id
            )
          ),
          orderBy: [asc(organizationService.sortOrder)],
        }),
        // Scoped to THIS branch, like the services above. The page has
        // resolved a venue; showing the whole org's team next to that venue's
        // catalogue made the page contradict itself — a Cork visitor was
        // introduced to a Dublin-only practitioner. Zero
        // `practitioner_location` rows still means "works at every branch",
        // so an org that has never assigned anyone is unchanged.
        tx.query.practitioner.findMany({
          where: and(
            eq(practitioner.organizationId, org.id),
            eq(practitioner.isActive, true),
            isNull(practitioner.deletedAt),
            atLocationOrUnassigned(
              tx,
              practitionerLocation,
              practitionerLocation.practitionerId,
              practitioner.id,
              practitionerLocation.locationId,
              location.id
            )
          ),
          orderBy: [asc(practitioner.name)],
        }),
        // The org's REAL categories — what drives the chips on the page.
        loadServiceCategoryNames(tx, org.id),
        // Is there anywhere else to go? `findFirst` on "any branch that is
        // NOT this one", not a COUNT: the page asks a yes/no question, and
        // asking the database the same yes/no question lets it stop at the
        // first row. See `hasOtherLocations` on the contract for why this is
        // a boolean rather than a number.
        tx.query.organizationLocation.findFirst({
          where: and(
            eq(organizationLocation.organizationId, org.id),
            ne(organizationLocation.id, location.id)
          ),
          columns: { id: true },
        }),
      ]);

      // Active variants for the listed services, grouped by service and ordered
      // by sortOrder — the customer-chosen pricing options ("1 Area", "60 min").
      // A single IN query keeps this to one round-trip regardless of catalog size.
      const serviceIds = services.map((s) => s.id);
      const variantRows =
        serviceIds.length > 0
          ? await tx.query.organizationServiceVariant.findMany({
              where: and(
                inArray(organizationServiceVariant.serviceId, serviceIds),
                eq(organizationServiceVariant.isActive, true)
              ),
              orderBy: [asc(organizationServiceVariant.sortOrder)],
            })
          : [];
      // Per-branch VARIANT prices. This page quotes to the public, so a
      // variant list left at org prices beside an overridden "from" is the
      // headline and the options openly disagreeing.
      const variantOverrides = await loadVariantLocationOverrides(tx, {
        variantIds: variantRows.map((v) => v.id),
        locationId: location.id,
      });

      const variantsByService = new Map<
        string,
        {
          id: string;
          name: string;
          priceCents: number | null;
          durationMinutes: number | null;
        }[]
      >();
      for (const raw of variantRows) {
        const v = applyVariantLocationOverride(
          raw,
          variantOverrides.get(raw.id)
        );
        const list = variantsByService.get(v.serviceId) ?? [];
        list.push({
          id: v.id,
          name: v.name,
          priceCents: v.priceCents,
          durationMinutes: v.durationMinutes,
        });
        variantsByService.set(v.serviceId, list);
      }

      // Per-branch price / duration, via the same helper the dashboard and the
      // booking form use. This page quotes a price to a member of the public,
      // so a missed override is a customer being told the wrong number — the
      // exact reason the helper is shared rather than re-implemented per
      // surface.
      const priceOverrides = await loadServiceLocationOverrides(tx, {
        serviceIds,
        locationId: location.id,
      });

      // Opening hours: prefer this location's standing schedule, fall back to
      // the org's business hours (never null on the org side).
      const openingHours: VenueOpeningHours | null =
        location.openingHours ?? org.businessHours ?? null;

      // One display currency for the whole page, from the venue's country
      // (fallback: EUR). Every priceCents below is in it.
      const currency = currencyForCountry(location.country);

      return ok({
        organization: {
          name: org.name,
          slug: org.slug,
          logo: org.logo,
          timezone: org.timezone,
          reschedulingNoticeRequiredHours: org.reschedulingNoticeRequiredHours,
          noShowOrLateCancelFeeCents: org.noShowOrLateCancelFeeCents,
        },
        location: {
          id: location.id,
          slug: location.slug,
          name: location.name,
          about: location.about,
          amenities: (location.amenities ?? []) as VenueAmenity[],
          addressLine1: location.addressLine1,
          addressLine2: location.addressLine2,
          city: location.city,
          county: location.county,
          postalCode: location.postalCode,
          country: location.country,
          latitude: location.latitude,
          longitude: location.longitude,
          openingHours,
        },
        currency,
        photos: [...locationPhotos, ...sharedPhotos],
        // Both: this branch's per-branch price override, and main's real
        // category name.
        services: services
          .map((s) => applyServiceLocationOverride(s, priceOverrides.get(s.id)))
          .map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            category: serviceCategoryName(s, categoryNames),
            priceText: s.priceText,
            priceType: s.priceType,
            priceCents: s.priceCents,
            appointmentDuration: s.appointmentDuration,
            variants: variantsByService.get(s.id) ?? [],
          })),
        team: team.map((p) => ({
          id: p.id,
          name: p.name,
          photo: p.photo,
          title: p.title,
          bio: p.bio,
        })),
        hasOtherLocations: !!siblingBranch,
      });
    },
    { db }
  );
};

export const getVenueConfig = (db: DbConnection, input: GetVenueConfigInput) =>
  trackedResult('venue.getVenueConfig', () => getVenueConfigImpl(db, input), {
    properties: {
      organizationSlug: input.organizationSlug,
      locationSlug: input.locationSlug,
    },
    internalErrorsOnly: true,
  });

export type GetVenueConfigResult = Awaited<ReturnType<typeof getVenueConfig>>;
