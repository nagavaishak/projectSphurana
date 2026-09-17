/**
 * @borradh-workspace/api-client - Organization Locations API Types
 *
 * Types for organization locations API endpoints.
 * Types are derived from backend packages - database schema and features schemas.
 */

import type {
  CreateLocationInput as BackendCreateInput,
  UpdateLocationInput as BackendUpdateInput,
} from '@borradh-workspace/features/organization-locations';
import type { OrganizationLocation as BackendOrganizationLocation } from '@borradh-workspace/features/shared';
import type { Serialize } from './serialization.js';

/**
 * Organization location response type (API response - dates serialized to ISO strings)
 */
export type OrganizationLocation = Serialize<BackendOrganizationLocation>;

/**
 * List locations response
 */
export interface ListLocationsResponse {
  items: OrganizationLocation[];
}

/**
 * Create location input
 * Omits organizationId (added by controller from session)
 */
export type CreateLocationInput = Omit<BackendCreateInput, 'organizationId'>;

/**
 * Update location input
 * Omits id and organizationId (added by controller)
 */
export type UpdateLocationInput = Omit<
  BackendUpdateInput,
  'id' | 'organizationId'
>;
