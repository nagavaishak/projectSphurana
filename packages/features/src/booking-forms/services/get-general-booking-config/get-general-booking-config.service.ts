import {
  organization,
  organizationService,
  organizationServiceLocation,
  organizationServiceVariant,
  practitioner,
  practitionerLocation,
  practitionerService,
  stripeConnectIntegration,
} from '@borradh-workspace/database';
import { withPublicOrgScope } from '@borradh-workspace/database';
import { resolveAppointmentDuration } from '@borradh-workspace/labels';
import { trackedResult } from '@borradh-workspace/observability';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  formatBookingLocationAddress,
  resolveBookingLocation,
} from '../../../organization-locations/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  applyServiceLocationOverride,
  applyVariantLocationOverride,
  atLocationOrUnassigned,
  currencyForCode,
  currencyForCountry,
  customerBookablePractitioner,
  err,
  loadServiceCategoryNames,
  loadServiceLocationOverrides,
  loadVariantLocationOverrides,
  notDeleted,
  ok,
  serviceCategoryName,
} from '../../../shared/index.js';
import type { GeneralBookingConfig } from '../../models/index.js';
import { toBookingPaymentDefaults } from '../../shared/booking-payment-adapters.js';
import {
  type GetGeneralBookingConfigInput,
  getGeneralBookingConfigSchema,
} from './get-general-booking-config.schema.js';

const getGeneralBookingConfigImpl = async (
  db: DbConnection,
  input: GetGeneralBookingConfigInput
): Promise<Result<GeneralBookingConfig>> => {
  const parsed = getGeneralBookingConfigSchema.safeParse(input);
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
  // this is the "chicken-and-egg" step that the slug_bootstrap RLS policy on
  // `organization` exists for. That policy allows app_public to SELECT a
  // non-mock org row by slug with no app.current_org_id set.
  //
  // RLS flag OFF: plain unscoped read (same behaviour as before).
  // RLS flag ON:  app_public pool + slug_bootstrap policy permits this SELECT.
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

  // The displayed deposit currency MUST match what Stripe will actually charge.
  // A deposit can only be charged in the connected account's currency
  // (default_currency) — you can't charge a currency the account doesn't
  // support without FX. Showing the org's COUNTRY currency instead (the old
  // behaviour) mislabels and effectively mischarges any org whose Stripe
  // account currency differs from its country. Read default_currency the SAME
  // way submit-general-booking does — owner connection, OUTSIDE
  // withPublicOrgScope — so display and charge can never diverge. Fall back to
  // the country currency only when there is no integration, in which case no
  // deposit can be charged anyway (display-only).
  const stripeIntegration = await db.query.stripeConnectIntegration.findFirst({
    where: eq(stripeConnectIntegration.organizationId, org.id),
    columns: { defaultCurrency: true },
  });

  // ── Scoped reads (runs INSIDE withPublicOrgScope) ─────────────────────────
  // Now that we have the org id, every subsequent query is scoped to this org
  // via SET LOCAL app.current_org_id. The org_isolation policy on
  // organization_service (and all other Bucket A tables) ensures reads return
  // only this org's rows even if the SQL WHERE clause were tampered.
  //
  // ALWAYS pass { db } so the helper uses the injected connection (the
  // app_public pool wired in Phase 2 / I3, or the test mock db, not the shared
  // default pool). Omitting { db } would fall back to the global db and break
  // pool separation + test isolation.
  const scoped = await withPublicOrgScope(
    org.id,
    async (tx) => {
      // Which branch this form is for: the one named in the URL, else the
      // org's DEFAULT branch — the same branch `submitGeneralBooking` stamps
      // on the appointment it creates. Resolving it here (rather than only for
      // currency, as this used to) is what lets the price on the form and the
      // price at the till be the same number.
      const defaultLocation = await resolveBookingLocation(
        tx,
        org.id,
        locationSlug
      );

      // A slug that names no branch of this org must 404 rather than quietly
      // serving another branch's catalogue at the address the customer picked.
      // `null` returns out of the scope and is turned into NOT_FOUND below.
      if (locationSlug && !defaultLocation) return null;

      const services = await tx.query.organizationService.findMany({
        where: and(
          eq(organizationService.organizationId, org.id),
          eq(organizationService.isActive, true),
          ...(defaultLocation
            ? [
                atLocationOrUnassigned(
                  tx,
                  organizationServiceLocation,
                  organizationServiceLocation.serviceId,
                  organizationService.id,
                  organizationServiceLocation.locationId,
                  defaultLocation.id
                ),
              ]
            : [])
        ),
        orderBy: [asc(organizationService.sortOrder)],
      });
      // The Professional step needs the team; "any professional" is always an
      // option, so an org with no practitioner rows still books fine.
      // Branch-scoped, the same way the services above are. Listing the whole
      // org's team beside a branch's catalogue made the page contradict itself:
      // a Cork customer was offered a Dublin-only practitioner for a Cork
      // service. Zero `practitioner_location` rows still means "works at every
      // branch" (see `atLocationOrUnassigned`), so an org that has never
      // assigned anyone is unchanged.
      const practitioners = await tx.query.practitioner.findMany({
        where: and(
          eq(practitioner.organizationId, org.id),
          customerBookablePractitioner(),
          ...(defaultLocation
            ? [
                atLocationOrUnassigned(
                  tx,
                  practitionerLocation,
                  practitionerLocation.practitionerId,
                  practitioner.id,
                  practitionerLocation.locationId,
                  defaultLocation.id
                ),
              ]
            : [])
        ),
        orderBy: [asc(practitioner.name)],
      });

      // Active variants for the listed services, grouped by service — one IN
      // query. The 92% of single-price services get an empty list.
      const serviceIds = services.map((s) => s.id);

      // Which services each practitioner can perform (practitioner_service),
      // restricted to the active services above. The Professional step uses
      // this to only offer a practitioner for services they're assigned to.
      const practitionerServiceRows =
        serviceIds.length > 0
          ? await tx.query.practitionerService.findMany({
              where: inArray(practitionerService.serviceId, serviceIds),
              columns: { practitionerId: true, serviceId: true },
            })
          : [];
      const serviceIdsByPractitioner = new Map<string, string[]>();
      for (const row of practitionerServiceRows) {
        const list = serviceIdsByPractitioner.get(row.practitionerId) ?? [];
        list.push(row.serviceId);
        serviceIdsByPractitioner.set(row.practitionerId, list);
      }
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
      const variantsByService = new Map<
        string,
        {
          id: string;
          name: string;
          priceCents: number | null;
          durationMinutes: number | null;
        }[]
      >();
      // Per-branch VARIANT prices for the default branch — the same branch
      // `submitGeneralBooking` stamps on the appointment.
      const variantOverrides = await loadVariantLocationOverrides(tx, {
        variantIds: variantRows.map((v) => v.id),
        locationId: defaultLocation?.id,
      });

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

      // Per-branch price / duration for the default branch, via the helper the
      // dashboard and the venue page use. Without it this wizard quotes the
      // org price and the customer is charged the branch's — a wrong number in
      // front of a member of the public, which is the whole reason the
      // override lookup is one shared function.
      const priceOverrides = await loadServiceLocationOverrides(tx, {
        serviceIds,
        locationId: defaultLocation?.id,
      });
      const pricedServices = services.map((s) =>
        applyServiceLocationOverride(s, priceOverrides.get(s.id))
      );

      // The org's REAL categories — what drives the chips on the Services step.
      const categoryNames = await loadServiceCategoryNames(tx, org.id);

      return {
        services: pricedServices,
        practitioners,
        variantsByService,
        primaryLocation: defaultLocation,
        serviceIdsByPractitioner,
        categoryNames,
      };
    },
    { db }
  );

  if (!scoped) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Location not found'));
  }

  const {
    services,
    practitioners,
    variantsByService,
    primaryLocation,
    serviceIdsByPractitioner,
    categoryNames,
  } = scoped;

  if (services.length === 0) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        'No active services found for this organization'
      )
    );
  }

  return ok({
    organizationName: org.name,
    organizationSlug: org.slug,
    organizationLogo: org.logo,
    // The RESOLVED branch's address — Cork's on a Cork booking. The wizard
    // renders it in the cart panel and, on the confirmation screen, hands it
    // to the calendar invite as the event `location`, which is what the
    // customer's phone navigates to on the day. Null when the branch has no
    // address on file (or the org has no branches yet), which every consumer
    // already treats as "omit the line".
    organizationAddress: formatBookingLocationAddress(primaryLocation),
    timezone: org.timezone,
    reschedulingNoticeRequiredHours: org.reschedulingNoticeRequiredHours,
    noShowOrLateCancelFeeCents: org.noShowOrLateCancelFeeCents,
    // The org defaults every service inherits, mapped through the SAME adapter
    // submit-general-booking uses. The wizard feeds these straight back into
    // `resolveBookingPayment`, so the amount on the button is computed by the
    // same function, from the same inputs, as the amount Stripe is asked for.
    paymentDefaults: toBookingPaymentDefaults(org),
    // Stripe account currency (what's charged) wins; country currency is only a
    // display fallback when the org has no Stripe integration to charge with.
    currency: stripeIntegration?.defaultCurrency
      ? currencyForCode(stripeIntegration.defaultCurrency)
      : currencyForCountry(primaryLocation?.country),
    services: services.map((s) => ({
      id: s.id,
      name: s.name,
      pricingDescription: s.priceText,
      priceType: s.priceType,
      priceCents: s.priceCents,
      category: serviceCategoryName(s, categoryNames),
      // RESOLVED, not raw. The wizard renders this as "45 mins" and sums it
      // into the cart's total length, so shipping a null and letting the
      // browser pick its own fallback is how the page came to disagree with
      // the slots it was offered. The server answers the duration question
      // once, through the canonical ladder (ENG-793).
      appointmentDuration: resolveAppointmentDuration(
        s.appointmentDuration,
        org.defaultAppointmentDuration
      ),
      description: s.description,
      payment: {
        paymentPolicy: s.paymentPolicy,
        depositBasis: s.depositBasis,
        depositAmountCents: s.depositAmountCents,
        depositPercent: s.depositPercent,
      },
      variants: variantsByService.get(s.id) ?? [],
    })),
    practitioners: practitioners.map((p) => ({
      id: p.id,
      name: p.name,
      photo: p.photo,
      title: p.title,
      serviceIds: serviceIdsByPractitioner.get(p.id) ?? [],
    })),
  });
};

export const getGeneralBookingConfig = (
  db: DbConnection,
  input: GetGeneralBookingConfigInput
) =>
  trackedResult(
    'bookingForms.getGeneralBookingConfig',
    () => getGeneralBookingConfigImpl(db, input),
    {
      properties: {
        organizationSlug: input.organizationSlug,
        locationSlug: input.locationSlug,
      },
      internalErrorsOnly: true,
    }
  );

export type GetGeneralBookingConfigResult = Awaited<
  ReturnType<typeof getGeneralBookingConfig>
>;
