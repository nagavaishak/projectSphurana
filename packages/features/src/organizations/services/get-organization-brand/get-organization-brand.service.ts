import { organization, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type ContentStyleTemplateId,
  type OrganizationBrandConfig,
  applyColorOverrides,
  getContentStyleTemplate,
} from '../../../content-styles/index.js';
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
  type GetOrganizationBrandInput,
  getOrganizationBrandSchema,
} from './get-organization-brand.schema.js';

/**
 * Internal implementation of get-organization-brand
 */
const getOrganizationBrandImpl = async (
  db: DbConnection,
  input: GetOrganizationBrandInput
): Promise<Result<OrganizationBrandConfig>> => {
  // Validate input
  const parsed = getOrganizationBrandSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Fetch organization brand fields
  const org = await db.query.organization.findFirst({
    where: and(
      eq(organization.id, parsed.data.organizationId),
      notDeleted(organization)
    ),
    columns: {
      id: true,
      primaryColor: true,
      secondaryColor: true,
      contentStyleTemplate: true,
      logo: true,
      tagline: true,
      backgroundColor: true,
    },
  });

  if (!org) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
    );
  }

  // Get the content style template
  const templateId = (org.contentStyleTemplate ??
    'clean_minimal') as ContentStyleTemplateId;
  const styleTemplate = getContentStyleTemplate(templateId);

  if (!styleTemplate) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Content style template not found')
    );
  }

  // Apply organization's color overrides to the template
  const resolvedStyle = applyColorOverrides(
    styleTemplate,
    org.primaryColor,
    org.secondaryColor
  );

  return ok({
    organizationId: org.id,
    primaryColor: org.primaryColor ?? styleTemplate.defaultColors.primary,
    secondaryColor: org.secondaryColor ?? styleTemplate.defaultColors.secondary,
    contentStyleTemplate: templateId,
    resolvedStyle,
    logoUrl: org.logo,
    tagline: org.tagline,
    backgroundColor: org.backgroundColor ?? '#FFFFFF',
  });
};

/**
 * Get organization's brand configuration including resolved style template
 *
 * @param db - Database connection
 * @param input - Input with organization ID
 * @returns Result with brand configuration
 *
 * @example
 * ```ts
 * const result = await getOrganizationBrand(db, {
 *   organizationId: 'org-123',
 * });
 *
 * if (result.success) {
 *   const { primaryColor, resolvedStyle } = result.data;
 *   // Use resolvedStyle.captionStyle for video captions
 *   // Use resolvedStyle.fonts for typography
 * }
 * ```
 */
export const getOrganizationBrand = (
  db: DbConnection,
  input: GetOrganizationBrandInput
) =>
  trackedResult(
    'organizations.getOrganizationBrand',
    () => withOrgScope((tx) => getOrganizationBrandImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

/**
 * Result type for getOrganizationBrand
 */
export type GetOrganizationBrandResult = Awaited<
  ReturnType<typeof getOrganizationBrand>
>;
