import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type GetOrganizationInput,
  getOrganizationSchema,
} from './get-organization.schema.js';

/**
 * Organization response type
 * Matches current organization schema with onboarding v2 fields
 */
export interface GetOrganizationResponse {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  businessType: string;
  createdAt: Date;
  metadata: string | null;
  apiKey: string | null;
  // Onboarding v2 fields - Website & Social
  websiteUrl: string | null;
  facebookPageUrl: string | null;
  privacyPolicyUrl: string | null;
  // Onboarding v2 fields - AI-extracted brand info
  brandVoice: string[] | null;
  targetAudienceDescription: string | null;
  credibilityLine: string | null;
  // Brand settings
  primaryColor: string | null;
  secondaryColor: string | null;
  tagline: string | null;
  contentStyleTemplate: string | null;
  stylePreference: string | null;
  outroStyle: string | null;
  // Video defaults — new videos inherit these caption & music settings
  videoCaptionColor: string | null;
  videoCaptionFont: string | null;
  videoCaptionPosition: 'top' | 'center' | 'bottom' | null;
  videoMusicVolume: number | null;
  // Business settings
  businessHours: Record<number, { from: number; to: number }> | null;
  depositEnabled: boolean | null;
  depositAmount: number | null;
  completedOnboardingTasks: string[];
  // Calendar settings
  primaryCalendarType: string | null;
  primaryCalendarAccountId: string | null;
  defaultAppointmentDuration: number | null;

  // Rescheduling policy
  reschedulingNoticeRequiredHours: number | null;
  noShowOrLateCancelFeeCents: number | null;
}

/**
 * Internal implementation of get organization
 */
const getOrganizationImpl = async (
  db: DbConnection,
  input: GetOrganizationInput
): Promise<Result<GetOrganizationResponse>> => {
  // Validate input
  const parsed = getOrganizationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id } = parsed.data;

  // Find organization
  const result = await db.query.organization.findFirst({
    where: (org, { and, eq, isNull }) =>
      and(eq(org.id, id), isNull(org.deletedAt)),
  });

  if (!result) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        `Organization with ID ${id} not found`,
        {
          organizationId: id,
        }
      )
    );
  }

  return ok(result);
};

/**
 * Get an organization by ID
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Organization ID input
 * @returns Result with organization or error
 *
 * @example
 * ```ts
 * const result = await getOrganization(db, { id: 'org-123' });
 *
 * if (result.success) {
 *   console.log('Organization:', result.data);
 * } else {
 *   console.error('Error:', result.error.message);
 * }
 * ```
 */
export const getOrganization = (
  db: DbConnection,
  input: GetOrganizationInput
) =>
  trackedResult(
    'organizations.getOrganization',
    () => getOrganizationImpl(db, input),
    {
      properties: { organizationId: input.id },
      internalErrorsOnly: true,
    }
  );

/**
 * Result type for getOrganization
 */
export type GetOrganizationResult = Awaited<ReturnType<typeof getOrganization>>;
