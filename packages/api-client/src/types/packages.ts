/**
 * @borradh-workspace/api-client - Packages API Types
 */

import type {
  AddPackageItemInput as BackendAddItemInput,
  CreatePackageInput as BackendCreateInput,
  OrganizationPackage as BackendPackage,
  OrganizationPackageItem as BackendPackageItem,
  PackageItemInput as BackendPackageItemInput,
  ReorderPackageItemsInput as BackendReorderInput,
  UpdatePackageInput as BackendUpdateInput,
  UpdatePackageItemInput as BackendUpdateItemInput,
} from '@borradh-workspace/features/packages';

import type { OrganizationService } from './organization-services.js';
import type { Serialize } from './serialization.js';

// ============================================================================
// ENTITY TYPES
// ============================================================================

export type OrganizationPackage = Serialize<BackendPackage>;

export type OrganizationPackageItem = Serialize<BackendPackageItem>;

export interface PackageWithItems extends OrganizationPackage {
  items: (OrganizationPackageItem & { service: OrganizationService })[];
}

// ============================================================================
// INPUT TYPES
// ============================================================================

export type CreatePackageItemInput = BackendPackageItemInput;

export type CreatePackageInput = Omit<BackendCreateInput, 'organizationId'>;

export type UpdatePackageInput = Omit<
  BackendUpdateInput,
  'id' | 'organizationId'
>;

export type AddPackageItemInput = Omit<
  BackendAddItemInput,
  'packageId' | 'organizationId'
>;

export type UpdatePackageItemInput = Omit<
  BackendUpdateItemInput,
  'packageId' | 'itemId' | 'organizationId'
>;

export type ReorderPackageItemsInput = Omit<
  BackendReorderInput,
  'packageId' | 'organizationId'
>;
