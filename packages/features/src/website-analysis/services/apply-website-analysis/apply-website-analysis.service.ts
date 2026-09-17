import { organizationService } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import { createLocation } from '../../../organization-locations/index.js';
import {
  createService,
  updateService,
} from '../../../organization-services/index.js';
import { updateOrganizationSettings } from '../../../organizations/index.js';
import { createPackage, updatePackage } from '../../../packages/index.js';
import {
  createPractitioner,
  updatePractitioner,
} from '../../../practitioners/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { updateLocationVenue } from '../../../venue/index.js';
import {
  type ApplyWebsiteAnalysisInput,
  type ApplyWebsiteAnalysisOutput,
  type PlanWebsiteAnalysisInput,
  type WebsiteAnalysisPlan,
  type WebsiteAnalysisSnapshot,
  applyModesSchema,
  applyWebsiteAnalysisSchema,
  planWebsiteAnalysisSchema,
  websiteAnalysisSnapshotSchema,
} from './apply-website-analysis.schema.js';
import { buildWebsiteAnalysisPlan, nameKey } from './plan-website-analysis.js';

/**
 * Staff rows require a unique email per organization, but a scanned team page
 * almost never publishes one. `.invalid` is reserved by RFC 6761 precisely so
 * it can never resolve, and `isUndeliverableEmail` already skips sends to it —
 * so a placeholder here is inert rather than a mail address we invented for a
 * real person. The owner replaces it when they invite the person for real.
 */
const placeholderEmail = (name: string, taken: Set<string>): string => {
  const slug =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.+|\.+$/g, '')
      .slice(0, 40) || 'staff';
  let candidate = `${slug}@scraped.invalid`;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${slug}.${n}@scraped.invalid`;
    n += 1;
  }
  return candidate;
};

/**
 * Drop every plan row the owner un-ticked in the review step, in place.
 *
 * Filtering the PLAN rather than guarding each write site keeps the selection
 * rule in one place, and means the counts reported back describe exactly the
 * rows that were actually considered.
 *
 * A deselected SERVICE that some package depends on needs no special handling
 * here: the package write re-resolves its items against the services that
 * actually got created, so it lands in `skipped` with the reason rather than
 * being created as an empty bundle.
 */
const applyDeselection = (
  plan: WebsiteAnalysisPlan,
  deselected: ReadonlySet<string>
): void => {
  const keep = <T extends { key: string }>(rows: T[]): T[] =>
    rows.filter((row) => !deselected.has(row.key));

  plan.services.create = keep(plan.services.create);
  plan.services.priceChanges = keep(plan.services.priceChanges);
  plan.services.notFound = keep(plan.services.notFound);
  plan.packages.create = keep(plan.packages.create);
  plan.packages.notFound = keep(plan.packages.notFound);
  plan.team.create = keep(plan.team.create);
  plan.team.notFound = keep(plan.team.notFound);
  plan.locations.create = keep(plan.locations.create);
};

/** Shared front half: validate, revive the snapshot, diff against live state. */
const planFrom = async (
  db: DbConnection,
  organizationId: string,
  rawAnalysis: unknown,
  scanFor: PlanWebsiteAnalysisInput['scanFor']
): Promise<{
  plan: WebsiteAnalysisPlan;
  analysis: WebsiteAnalysisSnapshot;
}> => {
  // Lenient by construction: every field of the snapshot degrades on its own,
  // so a thin or older-shaped result still applies whatever it does carry.
  const revived = websiteAnalysisSnapshotSchema.safeParse(rawAnalysis ?? {});
  const analysis = revived.success
    ? revived.data
    : websiteAnalysisSnapshotSchema.parse({});
  const plan = await buildWebsiteAnalysisPlan(
    db,
    organizationId,
    analysis,
    scanFor
  );
  return { plan, analysis };
};

/**
 * Diff a finished scan against the organization — WITHOUT writing anything.
 *
 * This is what the Settings panel renders before the owner commits, and it is
 * computed by the same function the apply executes, so the preview cannot
 * promise work the apply won't do.
 */
const planWebsiteAnalysisImpl = async (
  db: DbConnection,
  input: PlanWebsiteAnalysisInput
): Promise<Result<WebsiteAnalysisPlan>> => {
  const parsed = planWebsiteAnalysisSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { plan } = await planFrom(
    db,
    parsed.data.organizationId,
    parsed.data.analysis,
    parsed.data.scanFor
  );
  return ok(plan);
};

export const planWebsiteAnalysis = (
  db: DbConnection,
  input: PlanWebsiteAnalysisInput
) =>
  trackedResult(
    'websiteAnalysis.planWebsiteAnalysis',
    () => planWebsiteAnalysisImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );

export type PlanWebsiteAnalysisResult = Awaited<
  ReturnType<typeof planWebsiteAnalysis>
>;

/**
 * Write a website-analysis snapshot onto an organization: services and their
 * prices, physical locations, the venue's booking-page description (ENG-645),
 * opening hours, brand fields, staff and packages.
 *
 * Shared by two callers — the onboarding bootstrap (which creates the org
 * first, then applies) and the Settings > Organisation details rescan
 * (ENG-659). The plan is recomputed here against live state rather than trusted
 * from the preview, so an account that changed in between is diffed as it
 * actually is.
 *
 * Never deletes. `replace` mode DEACTIVATES the rows a scan didn't find; every
 * other mode only adds. A single failed row never fails the apply — it lands in
 * `skipped` so the surface can show exactly what was left alone.
 *
 * SCOPE: the caller owns the RLS scope. The onboarding path runs inside
 * `withSystemScope` (pre-org), the rescan path inside the request's org scope.
 */
const applyWebsiteAnalysisImpl = async (
  db: DbConnection,
  input: ApplyWebsiteAnalysisInput
): Promise<Result<ApplyWebsiteAnalysisOutput>> => {
  const parsed = applyWebsiteAnalysisSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;
  const modes = applyModesSchema.parse(parsed.data.modes ?? {});
  const { plan } = await planFrom(
    db,
    organizationId,
    parsed.data.analysis,
    parsed.data.scanFor
  );

  // The plan was just rebuilt from live state, so the keys the owner un-ticked
  // against the preview are re-derived here rather than trusted from it. A key
  // that no longer matches any row is inert.
  const deselected = new Set(parsed.data.deselected ?? []);
  if (deselected.size > 0) applyDeselection(plan, deselected);

  const out: ApplyWebsiteAnalysisOutput = {
    createdServiceIds: [],
    servicesPriceUpdated: 0,
    servicesDeactivated: 0,
    locationsCreated: 0,
    venueDescriptionUpdated: false,
    openingHoursUpdated: false,
    brandUpdated: false,
    practitionersCreated: 0,
    practitionersDeactivated: 0,
    packagesCreated: 0,
    packagesDeactivated: 0,
    skipped: [],
  };

  // ── Services ────────────────────────────────────────────────────────────
  /** lowercase name → id, so packages can resolve items created in this run. */
  const serviceIdByName = new Map<string, string>();
  if (modes.services !== 'ignore') {
    const existing = await db
      .select({ id: organizationService.id, name: organizationService.name })
      .from(organizationService)
      .where(eq(organizationService.organizationId, organizationId));
    for (const row of existing) serviceIdByName.set(nameKey(row.name), row.id);

    // Sequential on purpose: 15+ parallel inserts exhaust the connection pool.
    for (const planned of plan.services.create) {
      const created = await createService(db, {
        organizationId,
        name: planned.name,
        category: 'treatment',
        appointmentDuration: 30,
        priceText: planned.priceText,
        priceType: planned.priceType,
        priceCents: planned.priceCents ?? undefined,
        sortOrder: 0,
        isCustom: true,
        isActive: true,
        requiresDeposit: false,
      });
      if (created.success) {
        out.createdServiceIds.push(created.data.id);
        serviceIdByName.set(nameKey(planned.name), created.data.id);
      } else {
        out.skipped.push(`Could not add the service "${planned.name}"`);
      }
    }

    for (const change of plan.services.priceChanges) {
      const updated = await updateService(db, {
        id: change.id,
        organizationId,
        priceType: change.priceType,
        priceCents: change.priceCents,
      });
      if (updated.success) {
        out.servicesPriceUpdated += 1;
      } else {
        out.skipped.push(`Could not update the price for "${change.name}"`);
      }
    }

    if (modes.services === 'replace') {
      for (const stale of plan.services.notFound) {
        const updated = await updateService(db, {
          id: stale.id,
          organizationId,
          isActive: false,
        });
        if (updated.success) {
          out.servicesDeactivated += 1;
        } else {
          out.skipped.push(`Could not switch off the service "${stale.name}"`);
        }
      }
    }
  }

  // ── Locations ───────────────────────────────────────────────────────────
  let descriptionLocationId = plan.description.locationId;
  if (modes.locations !== 'ignore') {
    for (const [index, planned] of plan.locations.create.entries()) {
      const created = await createLocation(db, {
        organizationId,
        name: planned.name?.slice(0, 100) ?? null,
        addressLine1: planned.addressLine1.slice(0, 200),
        addressLine2: null,
        city: planned.city.slice(0, 100),
        county: planned.county?.slice(0, 100) ?? null,
        postalCode: planned.postalCode?.slice(0, 20) ?? null,
        country: planned.country,
        // Only the very first location an org ever gets becomes primary; a
        // rescan must never move an established primary branch.
        isPrimary: plan.locations.matched === 0 && index === 0,
        latitude: null,
        longitude: null,
      });
      if (created.success) {
        out.locationsCreated += 1;
        // The venue description needs somewhere to land on a fresh org, where
        // the plan necessarily found no location to point at.
        descriptionLocationId ??= created.data.id;
      } else {
        out.skipped.push(`Could not add the address "${planned.addressLine1}"`);
      }
    }
    for (const blocked of plan.locations.blocked) {
      out.skipped.push(
        `Skipped the address "${blocked.name}" — ${blocked.reason}`
      );
    }
  }

  // ── Venue description (ENG-645) ─────────────────────────────────────────
  if (modes.description === 'apply' && plan.description.scanned) {
    if (!descriptionLocationId) {
      out.skipped.push(
        'No venue to write the business description to — add a location first'
      );
    } else {
      const updated = await updateLocationVenue(db, {
        organizationId,
        locationId: descriptionLocationId,
        about: plan.description.scanned,
      });
      if (updated.success) {
        out.venueDescriptionUpdated = true;
      } else {
        out.skipped.push('Could not save the booking page description');
      }
    }
  }

  // ── Opening hours + brand ───────────────────────────────────────────────
  // One settings write for both: they land on the same row, and two calls
  // would mean the second silently reverting nothing but costing a round trip.
  const settingsPatch: Parameters<typeof updateOrganizationSettings>[1] = {
    organizationId,
  };
  let writesHours = false;
  let writesBrand = false;

  if (modes.hours === 'apply' && plan.hours.scanned) {
    settingsPatch.businessHours = plan.hours.scanned;
    writesHours = true;
  }
  if (modes.brand === 'apply') {
    const { scanned } = plan.brand;
    if (scanned.logoUrl) settingsPatch.logo = scanned.logoUrl;
    if (scanned.primaryColor) settingsPatch.primaryColor = scanned.primaryColor;
    if (scanned.secondaryColor) {
      settingsPatch.secondaryColor = scanned.secondaryColor;
    }
    writesBrand =
      settingsPatch.logo !== undefined ||
      settingsPatch.primaryColor !== undefined ||
      settingsPatch.secondaryColor !== undefined;
  }

  if (writesHours || writesBrand) {
    const updated = await updateOrganizationSettings(db, settingsPatch);
    if (updated.success) {
      out.openingHoursUpdated = writesHours;
      out.brandUpdated = writesBrand;
    } else {
      out.skipped.push(
        writesHours && writesBrand
          ? 'Could not save the opening hours or brand details'
          : writesHours
            ? 'Could not save the opening hours'
            : 'Could not save the brand details'
      );
    }
  }

  // ── Team ────────────────────────────────────────────────────────────────
  if (modes.team !== 'ignore') {
    // Emails must be unique per org, so the placeholder generator needs to see
    // the addresses already taken — including ones minted earlier in this loop.
    const takenEmails = new Set<string>();
    for (const planned of plan.team.create) {
      const email =
        planned.email && !takenEmails.has(planned.email)
          ? planned.email
          : placeholderEmail(planned.name, takenEmails);
      takenEmails.add(email);

      const created = await createPractitioner(db, {
        organizationId,
        name: planned.name,
        email,
        title: planned.title,
        acceptsBookings: true,
      });
      if (created.success) {
        out.practitionersCreated += 1;
      } else {
        out.skipped.push(`Could not add the team member "${planned.name}"`);
      }
    }

    if (modes.team === 'replace') {
      for (const stale of plan.team.notFound) {
        const updated = await updatePractitioner(db, {
          id: stale.id,
          organizationId,
          isActive: false,
        });
        if (updated.success) {
          out.practitionersDeactivated += 1;
        } else {
          out.skipped.push(`Could not switch off "${stale.name}"`);
        }
      }
    }
  }

  // ── Packages ────────────────────────────────────────────────────────────
  if (modes.packages !== 'ignore') {
    for (const planned of plan.packages.create) {
      // Re-resolve against what actually got created: a package whose service
      // failed to insert must not become an empty bundle.
      const quantities = new Map<string, number>();
      let unresolved: string | undefined;
      for (const itemName of planned.serviceNames) {
        const serviceId = serviceIdByName.get(nameKey(itemName));
        if (!serviceId) {
          unresolved = itemName;
          break;
        }
        quantities.set(serviceId, (quantities.get(serviceId) ?? 0) + 1);
      }
      if (unresolved || quantities.size === 0) {
        out.skipped.push(
          `Skipped the package "${planned.name}" — "${unresolved ?? ''}" isn't one of your services`
        );
        continue;
      }

      const created = await createPackage(db, {
        organizationId,
        name: planned.name,
        description: planned.description?.slice(0, 1000) ?? null,
        priceCents: planned.priceCents,
        validityDays: planned.validityDays ?? null,
        requiresDeposit: false,
        sortOrder: 0,
        isActive: true,
        items: [...quantities.entries()].map(
          ([serviceId, quantity], index) => ({
            serviceId,
            quantity,
            sortOrder: index,
          })
        ),
      });
      if (created.success) {
        out.packagesCreated += 1;
      } else {
        out.skipped.push(`Could not add the package "${planned.name}"`);
      }
    }

    for (const blocked of plan.packages.blocked) {
      out.skipped.push(
        `Skipped the package "${blocked.name}" — ${blocked.reason}`
      );
    }

    if (modes.packages === 'replace') {
      for (const stale of plan.packages.notFound) {
        const updated = await updatePackage(db, {
          id: stale.id,
          organizationId,
          isActive: false,
        });
        if (updated.success) {
          out.packagesDeactivated += 1;
        } else {
          out.skipped.push(`Could not switch off the package "${stale.name}"`);
        }
      }
    }
  }

  return ok(out);
};

export const applyWebsiteAnalysis = (
  db: DbConnection,
  input: ApplyWebsiteAnalysisInput
) =>
  trackedResult(
    'websiteAnalysis.applyWebsiteAnalysis',
    () => applyWebsiteAnalysisImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );

export type ApplyWebsiteAnalysisResult = Awaited<
  ReturnType<typeof applyWebsiteAnalysis>
>;
