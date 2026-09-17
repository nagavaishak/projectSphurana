import { member, organization } from '@borradh-workspace/database';
import { getStripeService } from '@borradh-workspace/integrations/stripe';
import {
  identifyOrganization,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { ensureDefaultPractitionerBestEffort } from '../../../practitioners/index.js';
import { seedBlockedTimeTypes } from '../../../scheduling/services/seed-blocked-time-types/index.js';
import { createDefaultSequence } from '../../../sequences/services/create-default-sequence/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  internalError,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { fireLoopsEvent } from '../../../shared/loops.js';
import { fireNotionOrgCreated } from '../../../shared/notion-crm.js';
import {
  type CreateOrganizationInput,
  createOrganizationSchema,
} from './create-organization.schema.js';

/**
 * Generate a URL-friendly slug from a name
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

/**
 * Generate a unique ID
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Create organization response
 */
export interface CreateOrganizationResponse {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  businessType: string;
  createdAt: Date;

  // Onboarding v2 fields - Website & Social
  websiteUrl: string | null;
  facebookPageUrl: string | null;

  // Onboarding v2 fields - AI-extracted brand info
  brandVoice: string[];
  targetAudienceDescription: string | null;
  credibilityLine: string | null;

  // Brand settings
  primaryColor: string | null;
  secondaryColor: string | null;
  contentStyleTemplate: string | null;
  outroStyle: string | null;

  // Business hours & deposit settings
  businessHours: Record<number, { from: number; to: number }> | null;
  depositEnabled: boolean;
  depositAmount: number | null;

  // Booking links
  defaultBookingLink: string | null;

  // Primary calendar type (booking destination)
  primaryCalendarType: string | null;
}

/**
 * Internal implementation of create organization
 */
const createOrganizationImpl = async (
  db: DbConnection,
  input: CreateOrganizationInput
): Promise<Result<CreateOrganizationResponse>> => {
  // Validate input
  const parsed = createOrganizationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { createdByUserId, ...orgData } = parsed.data;

  // Check if user exists
  const existingUser = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.id, createdByUserId),
  });

  if (!existingUser) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        `User with ID ${createdByUserId} not found`,
        {
          userId: createdByUserId,
        }
      )
    );
  }

  // Generate unique slug
  let slug = generateSlug(orgData.name);
  const slugExists = await db.query.organization.findFirst({
    where: and(eq(organization.slug, slug), notDeleted(organization)),
  });

  // If slug exists, append random string
  if (slugExists) {
    slug = `${slug}-${generateId().substring(0, 8)}`;
  }

  const orgId = generateId();
  const memberId = generateId();
  const now = new Date();

  // Create organization and add creator as owner in a transaction
  // Use raw queries if transaction is not supported
  // Kept in lockstep with primaryCalendarType while both columns exist (ENG-500
  // expand/contract). Writing only one of them makes the two disagree, and the
  // org's booking link then changes the moment the other is dropped.
  const bookingDestination =
    (orgData.primaryCalendarType ?? 'borradh') === 'borradh'
      ? ('borradh' as const)
      : ('external_link' as const);

  try {
    // Insert organization
    const [newOrg] = await db
      .insert(organization)
      .values({
        id: orgId,
        name: orgData.name,
        slug,
        logo: orgData.logo ?? null,
        businessType: orgData.businessType,
        createdAt: now,
        // Onboarding v2 fields - Website & Social
        websiteUrl: orgData.websiteUrl ?? null,
        facebookPageUrl: orgData.facebookPageUrl ?? null,
        // Onboarding v2 fields - AI-extracted brand info
        brandVoice: orgData.brandVoice ?? [],
        targetAudienceDescription: orgData.targetAudienceDescription ?? null,
        credibilityLine: orgData.credibilityLine ?? null,
        // Brand settings
        primaryColor: orgData.primaryColor ?? null,
        secondaryColor: orgData.secondaryColor ?? null,
        backgroundColor: orgData.backgroundColor ?? null,
        contentStyleTemplate: orgData.contentStyleTemplate ?? 'clean_minimal',
        outroStyle: orgData.outroStyle ?? 'tagline',
        address: orgData.address ?? null,
        // Business hours & deposit settings
        businessHours: orgData.businessHours ?? undefined,
        depositEnabled: orgData.depositEnabled ?? false,
        depositAmount: orgData.depositAmount ?? null,
        // Set EXPLICITLY rather than left to the column default, which is `sum`
        // only so that existing orgs keep collecting exactly what they already
        // collect. A new clinic gets the honest rule: one appointment is one
        // no-show risk, so a three-service booking is not charged three
        // deposits to hold one slot.
        depositAggregation: 'largest',
        defaultBookingLink: orgData.defaultBookingLink ?? null,
        // A new business books on OUR calendar unless it says otherwise. The
        // Claire onboarding never sets this (there is no calendar slide), and
        // /dashboard/calendar renders a "connect a calendar" empty state for
        // anything that isn't 'borradh' — so writing NULL here left every
        // onboarded org with no calendar at all.
        primaryCalendarType: orgData.primaryCalendarType ?? 'borradh',
        bookingDestination,
      })
      .returning();

    // Add creator as owner member
    await db.insert(member).values({
      id: memberId,
      organizationId: orgId,
      userId: createdByUserId,
      role: 'owner',
      createdAt: now,
    });

    // Create default follow-up sequence for the organization
    // This runs in the background - don't fail org creation if it fails
    try {
      await createDefaultSequence(db, {
        organizationId: orgId,
        createdById: createdByUserId,
      });
    } catch (seqError) {
      // Log error but don't fail organization creation
      logError('organizations.createOrganization.defaultSequence', seqError, {
        feature: 'organizations',
        extra: { organizationId: orgId },
      });
    }

    // Seed preset blocked-time types (Lunch/Training/Meeting) — idempotent,
    // non-fatal if it fails.
    try {
      await seedBlockedTimeTypes(db, { organizationId: orgId });
    } catch (seedError) {
      logError(
        'organizations.createOrganization.seedBlockedTimeTypes',
        seedError,
        {
          feature: 'organizations',
          extra: { organizationId: orgId },
        }
      );
    }

    // Every org gets a practitioner, unconditionally. Availability is derived
    // solely from `shift` rows, which hang off a practitioner — an org without
    // one has nowhere to record when it works, or when it is off, so its
    // booking page cannot be described at all. Doing this for external-link
    // orgs too is deliberate: gating on bookingDestination would mean an org
    // that switches to our calendar later silently lands in the broken state,
    // and an unused practitioner row costs nothing. Non-fatal.
    await ensureDefaultPractitionerBestEffort(db, orgId);

    // Pre-create Stripe customer so checkout is faster later (non-blocking)
    try {
      const stripe = getStripeService();
      const customer = await stripe.getOrCreateCustomer(
        orgId,
        existingUser.email,
        orgData.name
      );
      // Store customer ID on the org so checkout can reuse it
      await db
        .update(organization)
        .set({ stripeCustomerId: customer.id })
        .where(eq(organization.id, orgId));
    } catch (stripeError) {
      // Log but don't fail org creation if Stripe setup fails
      logError('organizations.createOrganization.stripeSetup', stripeError, {
        feature: 'organizations',
        extra: { organizationId: orgId, email: existingUser.email },
      });
    }

    // Fire marketing events (non-blocking)
    fireLoopsEvent({
      email: existingUser.email,
      userId: createdByUserId,
      eventName: 'onboarding_completed',
      contactProperties: {
        businessName: newOrg.name,
        businessType: newOrg.businessType,
      },
    });
    fireNotionOrgCreated(newOrg.name, newOrg.businessType, existingUser.email);

    // Name the PostHog `organization` group so usage/cost events attributed to
    // this org render with a readable name instead of a bare UUID. Group key =
    // DB org id (matches the `groups: { organization }` carried on events).
    identifyOrganization(newOrg.id, {
      name: newOrg.name,
      slug: newOrg.slug,
      businessType: newOrg.businessType,
      createdAt: newOrg.createdAt.toISOString(),
    });

    return ok({
      id: newOrg.id,
      name: newOrg.name,
      slug: newOrg.slug,
      logo: newOrg.logo,
      businessType: newOrg.businessType,
      createdAt: newOrg.createdAt,
      // Onboarding v2 fields
      websiteUrl: newOrg.websiteUrl,
      facebookPageUrl: newOrg.facebookPageUrl,
      brandVoice: (newOrg.brandVoice as string[]) ?? [],
      targetAudienceDescription: newOrg.targetAudienceDescription,
      credibilityLine: newOrg.credibilityLine,
      // Brand settings
      primaryColor: newOrg.primaryColor,
      secondaryColor: newOrg.secondaryColor,
      contentStyleTemplate: newOrg.contentStyleTemplate,
      outroStyle: newOrg.outroStyle,
      // Business hours & deposit settings
      businessHours: newOrg.businessHours as Record<
        number,
        { from: number; to: number }
      > | null,
      depositEnabled: newOrg.depositEnabled ?? false,
      depositAmount: newOrg.depositAmount,
      defaultBookingLink: newOrg.defaultBookingLink,
      primaryCalendarType: newOrg.primaryCalendarType,
    });
  } catch (error) {
    logError('organizations.createOrganization', error, {
      feature: 'organizations',
      extra: { userId: createdByUserId, orgName: orgData.name },
    });
    return internalError(
      'An error occurred while creating the organization. Please try again.',
      error
    );
  }
};

/**
 * Create a new organization
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Organization data including creator user ID
 * @returns Result with created organization or error
 *
 * @example
 * ```ts
 * const result = await createOrganization(db, {
 *   name: 'My Salon',
 *   businessType: 'salon',
 *   mainProduct: 'Hair styling',
 *   city: 'New York',
 *   country: 'us',
 *   minPrice: 50,
 *   maxPrice: 200,
 *   idealCustomerProfile: 'Young professionals',
 *   previousSuccesses: 'Featured in local magazine',
 *   createdByUserId: 'user-123',
 * });
 *
 * if (result.success) {
 *   console.log('Created organization:', result.data);
 * }
 * ```
 */
export const createOrganization = (
  db: DbConnection,
  input: CreateOrganizationInput
) =>
  trackedResult(
    'organizations.createOrganization',
    () => createOrganizationImpl(db, input),
    {
      properties: { userId: input.createdByUserId },
    }
  );

/**
 * Result type for createOrganization
 */
export type CreateOrganizationResult = Awaited<
  ReturnType<typeof createOrganization>
>;
