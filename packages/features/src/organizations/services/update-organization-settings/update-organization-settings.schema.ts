import { updateOrganizationSettingsRequestBase } from '@borradh-workspace/contracts';
import { contentStyleTemplateValues } from '@borradh-workspace/labels';
import { z } from 'zod';

/**
 * Valid content style templates. Sourced from the shared labels vocabulary and
 * re-exported under its original name so existing imports keep working.
 */
export const CONTENT_STYLE_TEMPLATES = contentStyleTemplateValues;

/**
 * Schema for updating organization settings (writes directly to the database,
 * not through Better Auth).
 *
 * DERIVED from the wire contract — see
 * `updateOrganizationSettingsRequestBase` in
 * `packages/contracts/src/requests/organizations.ts`. Every settable field,
 * plus its ABSENT-vs-`null` semantics, is documented there.
 */
export const updateOrganizationSettingsSchema =
  updateOrganizationSettingsRequestBase.extend({
    organizationId: z.string().min(1, 'Organization ID is required'),
  });

/**
 * Input type inferred from schema
 */
export type UpdateOrganizationSettingsInput = z.infer<
  typeof updateOrganizationSettingsSchema
>;
