/**
 * Organization Services types for the frontend
 *
 * Re-exports from @borradh-workspace/api-client/types following the type-sharing pattern.
 * See: .claude/rules/_patterns/type-sharing.md
 *
 * DO NOT define types here - import from api-client to ensure type consistency.
 */

// Entity and enum types
export type {
  OrganizationService,
  ServiceCategory,
} from '@borradh-workspace/api-client/types';

// Input types
export type {
  CreateServiceInput,
  UpdateServiceInput,
} from '@borradh-workspace/api-client/types';

// Response types
export type { ListServicesResponse } from '@borradh-workspace/api-client/types';

// Service variant (customer-chosen pricing option) — the contract atom, verbatim.
export type { ServiceVariantResponse } from '@borradh-workspace/contracts';

// Labels and values for UI components (dropdowns, badges, etc.)
export {
  serviceCategoryLabels,
  serviceCategoryValues,
} from '@borradh-workspace/api-client/types';
