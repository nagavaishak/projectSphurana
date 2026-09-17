/**
 * @borradh-workspace/api-client - Service Categories API Types
 */

import type {
  OrganizationServiceCategory as BackendCategory,
  CreateCategoryInput as BackendCreateInput,
  ReorderCategoriesInput as BackendReorderInput,
  UpdateCategoryInput as BackendUpdateInput,
} from '@borradh-workspace/features/service-categories';

import type { Serialize } from './serialization.js';

/**
 * Organization service category — the new per-org category row.
 * Distinct from the legacy `ServiceCategory` enum re-exported from
 * `./organization-services.ts`.
 */
export type OrganizationServiceCategory = Serialize<BackendCategory>;

export type CreateServiceCategoryInput = Omit<
  BackendCreateInput,
  'organizationId'
>;

export type UpdateServiceCategoryInput = Omit<
  BackendUpdateInput,
  'id' | 'organizationId'
>;

export type ReorderServiceCategoriesInput = Omit<
  BackendReorderInput,
  'organizationId'
>;
