import { organization, withOrgScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { normalizeLogoAsset } from '../../../image-generation/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type UpdateOrganizationSettingsInput,
  updateOrganizationSettingsSchema,
} from './update-organization-settings.schema.js';
import type { OrganizationSettingsResponse } from './update-organization-settings.types.js';

export type { OrganizationSettingsResponse } from './update-organization-settings.types.js';

/**
 * Internal implementation of update-organization-settings
 */
const updateOrganizationSettingsImpl = async (
  db: DbConnection,
  input: UpdateOrganizationSettingsInput
): Promise<Result<OrganizationSettingsResponse>> => {
  // Validate input
  const parsed = updateOrganizationSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, ...updateData } = parsed.data;

  // Check if there's anything to update
  if (Object.keys(updateData).length === 0) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'No fields to update')
    );
  }

  try {
    // Check if organization exists
    const existing = await db.query.organization.findFirst({
      where: and(eq(organization.id, organizationId), notDeleted(organization)),
      // `defaultPaymentPolicy` is read so the `depositEnabled` lockstep below
      // can tell a `full`-prepayment org apart from one taking a deposit.
      columns: { id: true, defaultPaymentPolicy: true },
    });

    if (!existing) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
      );
    }

    // Build the update object, only including defined fields
    const updateValues: Partial<typeof organization.$inferInsert> = {};

    if (updateData.name !== undefined) {
      updateValues.name = updateData.name;
    }
    if (updateData.logo !== undefined) {
      // Normalise AT THE MOMENT IT BECOMES A LOGO. Uploads are presigned, so
      // bytes never pass through us and there is no upload-time hook; this is
      // the one point where we know a URL is a logo. An alpha-less source
      // (JPEG — 18 of 59 orgs with a logo) makes every downstream polarity
      // decision measure the white page instead of the mark, and the model is
      // handed an inverted rectangle it cannot reproduce, so it re-letters the
      // business name. Best-effort: returns the original URL unchanged if it
      // cannot convert, so saving settings never fails on image processing.
      updateValues.logo = updateData.logo
        ? await normalizeLogoAsset(updateData.logo)
        : updateData.logo;
    }
    if (updateData.websiteUrl !== undefined) {
      updateValues.websiteUrl = updateData.websiteUrl;
    }
    if (updateData.privacyPolicyUrl !== undefined) {
      updateValues.privacyPolicyUrl = updateData.privacyPolicyUrl;
    }
    if (updateData.primaryColor !== undefined) {
      updateValues.primaryColor = updateData.primaryColor;
    }
    if (updateData.secondaryColor !== undefined) {
      updateValues.secondaryColor = updateData.secondaryColor;
    }
    if (updateData.backgroundColor !== undefined) {
      updateValues.backgroundColor = updateData.backgroundColor;
    }
    if (updateData.tagline !== undefined) {
      updateValues.tagline = updateData.tagline;
    }
    if (updateData.brandStyleGuide !== undefined) {
      updateValues.brandStyleGuide = updateData.brandStyleGuide;
    }
    if (updateData.contentStyleTemplate !== undefined) {
      updateValues.contentStyleTemplate = updateData.contentStyleTemplate;
    }
    if (updateData.stylePreference !== undefined) {
      updateValues.stylePreference = updateData.stylePreference;
    }
    if (updateData.videoCaptionColor !== undefined) {
      updateValues.videoCaptionColor = updateData.videoCaptionColor;
    }
    if (updateData.videoCaptionFont !== undefined) {
      updateValues.videoCaptionFont = updateData.videoCaptionFont;
    }
    if (updateData.videoCaptionPosition !== undefined) {
      updateValues.videoCaptionPosition = updateData.videoCaptionPosition;
    }
    if (updateData.videoMusicVolume !== undefined) {
      updateValues.videoMusicVolume = updateData.videoMusicVolume;
    }
    if (updateData.businessHours !== undefined) {
      updateValues.businessHours = updateData.businessHours ?? undefined;
    }
    if (updateData.defaultBookingLink !== undefined) {
      updateValues.defaultBookingLink = updateData.defaultBookingLink;
    }
    if (updateData.depositEnabled !== undefined) {
      updateValues.depositEnabled = updateData.depositEnabled;
      // Keep `default_payment_policy` in lockstep, the same way
      // `bookingDestination` keeps `primaryCalendarType` in step below.
      //
      // `default_payment_policy` is what the booking resolver actually reads;
      // `deposit_enabled` is the only thing any writer sets. Until the backfill
      // ran, an adapter inferred one from the other, which meant this toggle
      // worked by accident. Doing it here rather than in the settings form
      // covers every writer — onboarding, Claire, direct API — not just the one
      // screen.
      //
      // `full` is left alone: turning the deposit toggle off must not silently
      // downgrade an org that takes payment in full to taking nothing.
      const current = existing.defaultPaymentPolicy;
      if (current !== 'full') {
        updateValues.defaultPaymentPolicy = updateData.depositEnabled
          ? 'deposit'
          : 'in_clinic';
      }
    }
    if (updateData.defaultDepositBasis !== undefined) {
      updateValues.defaultDepositBasis = updateData.defaultDepositBasis;
    }
    if (updateData.defaultDepositPercent !== undefined) {
      updateValues.defaultDepositPercent = updateData.defaultDepositPercent;
    }
    if (updateData.depositAmount !== undefined) {
      updateValues.depositAmount = updateData.depositAmount;
    }
    if (updateData.reschedulingNoticeRequiredHours !== undefined) {
      updateValues.reschedulingNoticeRequiredHours =
        updateData.reschedulingNoticeRequiredHours;
    }
    if (updateData.noShowOrLateCancelFeeCents !== undefined) {
      updateValues.noShowOrLateCancelFeeCents =
        updateData.noShowOrLateCancelFeeCents;
    }
    if (updateData.customerReschedulingEnabled !== undefined) {
      updateValues.customerReschedulingEnabled =
        updateData.customerReschedulingEnabled;
    }
    if (updateData.customerCancellationsEnabled !== undefined) {
      updateValues.customerCancellationsEnabled =
        updateData.customerCancellationsEnabled;
    }
    if (updateData.cancellationNoticeRequiredHours !== undefined) {
      updateValues.cancellationNoticeRequiredHours =
        updateData.cancellationNoticeRequiredHours;
    }
    if (updateData.credibilityLine !== undefined) {
      updateValues.credibilityLine = updateData.credibilityLine;
    }
    if (updateData.primaryCalendarAccountId !== undefined) {
      updateValues.primaryCalendarAccountId =
        updateData.primaryCalendarAccountId;
    }
    if (updateData.bookingDestination !== undefined) {
      updateValues.bookingDestination = updateData.bookingDestination;
      // Keep the legacy column in lockstep while both exist (ENG-500). Any
      // reader still on `primaryCalendarType` would otherwise go stale and the
      // org's booking link would change the moment it is dropped.
      updateValues.primaryCalendarType =
        updateData.bookingDestination === 'borradh' ? 'borradh' : null;
    }
    if (updateData.contributeToAggregateInsights !== undefined) {
      updateValues.contributeToAggregateInsights =
        updateData.contributeToAggregateInsights;
    }

    // Update the organization
    const [updated] = await db
      .update(organization)
      .set(updateValues)
      .where(and(eq(organization.id, organizationId), notDeleted(organization)))
      .returning({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        logo: organization.logo,
        websiteUrl: organization.websiteUrl,
        privacyPolicyUrl: organization.privacyPolicyUrl,
        primaryColor: organization.primaryColor,
        secondaryColor: organization.secondaryColor,
        backgroundColor: organization.backgroundColor,
        tagline: organization.tagline,
        brandStyleGuide: organization.brandStyleGuide,
        contentStyleTemplate: organization.contentStyleTemplate,
        stylePreference: organization.stylePreference,
        videoCaptionColor: organization.videoCaptionColor,
        videoCaptionFont: organization.videoCaptionFont,
        videoCaptionPosition: organization.videoCaptionPosition,
        videoMusicVolume: organization.videoMusicVolume,
        defaultBookingLink: organization.defaultBookingLink,
        depositEnabled: organization.depositEnabled,
        depositAmount: organization.depositAmount,
        defaultDepositBasis: organization.defaultDepositBasis,
        defaultDepositPercent: organization.defaultDepositPercent,
        reschedulingNoticeRequiredHours:
          organization.reschedulingNoticeRequiredHours,
        noShowOrLateCancelFeeCents: organization.noShowOrLateCancelFeeCents,
        customerReschedulingEnabled: organization.customerReschedulingEnabled,
        customerCancellationsEnabled: organization.customerCancellationsEnabled,
        cancellationNoticeRequiredHours:
          organization.cancellationNoticeRequiredHours,
        credibilityLine: organization.credibilityLine,
        primaryCalendarAccountId: organization.primaryCalendarAccountId,
        primaryCalendarType: organization.primaryCalendarType,
        contributeToAggregateInsights:
          organization.contributeToAggregateInsights,
      });

    if (!updated) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
      );
    }

    return ok(updated);
  } catch (error) {
    logError('organizations.updateOrganizationSettings', error, {
      feature: 'organizations',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to update organization settings'
      )
    );
  }
};

/**
 * Update organization settings directly in the database
 *
 * This service updates organization properties directly in the database,
 * bypassing Better Auth for fields that are not managed by it (brand colors, tagline, etc.)
 *
 * @param db - Database connection
 * @param input - Input with organization ID and fields to update
 * @returns Result with updated organization
 *
 * @example
 * ```ts
 * const result = await updateOrganizationSettings(db, {
 *   organizationId: 'org-123',
 *   name: 'New Name',
 *   primaryColor: '#FF0000',
 *   secondaryColor: '#00FF00',
 * });
 *
 * if (result.success) {
 *   console.log('Updated:', result.data);
 * }
 * ```
 */
export const updateOrganizationSettings = (
  db: DbConnection,
  input: UpdateOrganizationSettingsInput
) =>
  trackedResult(
    'organizations.updateOrganizationSettings',
    () =>
      withOrgScope((tx) => updateOrganizationSettingsImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
    }
  );

/**
 * Result type for updateOrganizationSettings
 */
export type UpdateOrganizationSettingsResult = Awaited<
  ReturnType<typeof updateOrganizationSettings>
>;
