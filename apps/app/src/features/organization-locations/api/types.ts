/**
 * Organization Locations types for the frontend
 *
 * Re-exports from @borradh-workspace/api-client/types following the type-sharing pattern.
 * See: .claude/rules/_patterns/type-sharing.md
 *
 * DO NOT define types here - import from api-client to ensure type consistency.
 */

// Entity types
export type {
  OrganizationLocation,
  CountryCode,
} from '@borradh-workspace/api-client/types';

// Input types
export type {
  CreateLocationInput,
  UpdateLocationInput,
} from '@borradh-workspace/api-client/types';

// Response types
export type { ListLocationsResponse } from '@borradh-workspace/api-client/types';

// Labels and values for UI components (dropdowns, badges, etc.)
export {
  countryCodeLabels,
  countryCodeValues,
} from '@borradh-workspace/api-client/types';
