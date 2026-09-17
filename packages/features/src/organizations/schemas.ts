// Client-safe organization schemas and types (no server-side dependencies)
// Use this entry point in frontend apps to avoid pulling in server-side code

// Models (pure types, no server dependencies)
export type {
  Organization,
  OrganizationMember,
  OrganizationRole,
} from './models/index.js';

// update-organization (legacy - uses Better Auth)
export {
  updateOrganizationSchema,
  type UpdateOrganizationInput,
} from './services/update-organization/update-organization.schema.js';

// update-organization-settings (recommended - direct DB update)
export {
  updateOrganizationSettingsSchema,
  CONTENT_STYLE_TEMPLATES,
  type UpdateOrganizationSettingsInput,
} from './services/update-organization-settings/update-organization-settings.schema.js';

// Response types (from types files - NOT service files, to avoid pulling in server-side code)
export type { OrganizationSettingsResponse } from './services/update-organization-settings/update-organization-settings.types.js';
