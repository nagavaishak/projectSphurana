/**
 * @borradh-workspace/api-client - Organization Services API Types
 */

import {
  serviceCategoryLabels,
  serviceCategoryValues,
} from '@borradh-workspace/features/shared';

import type {
  CreateServiceInput as BackendCreateInput,
  ImportServicesCsvInput as BackendImportServicesCsvInput,
  UpdateServiceInput as BackendUpdateInput,
} from '@borradh-workspace/features/organization-services';
import type { OrganizationService as BackendOrganizationService } from '@borradh-workspace/features/shared';

import type { Serialize } from './serialization.js';

// ============================================================================
// ENUM TYPES
// ============================================================================

/**
 * Service category (legacy enum). Kept around for back-compat with
 * code that hasn't switched to the user-defined category rows yet.
 */
export type ServiceCategory = keyof typeof serviceCategoryLabels;
export { serviceCategoryLabels, serviceCategoryValues };

// ============================================================================
// ENTITY TYPES
// ============================================================================

/**
 * Organization service response type (dates serialized to ISO strings).
 */
/**
 * `regions` and `specSource` ARE exposed — the footage-spec backfill UI reads
 * and writes them ("which area is this?", and showing whether a spec was
 * declared by the clinic or only guessed from the service name).
 *
 * `expectedShot` is omitted: it is generated server-side from the spec purely
 * to be embedded for retrieval, and is never rendered or edited by a client.
 */
export type OrganizationService = Omit<
  Serialize<BackendOrganizationService>,
  'expectedShot'
>;

/**
 * A listed service plus `hasGraphicMedia` — whether the service has uploaded
 * media (photos / video screenshots) usable for a graphic. Drives the
 * generate-graphic picker: with the "Use AI-generated images" toggle off,
 * only services where `hasGraphicMedia === true` are selectable.
 */
export type ListedService = OrganizationService & {
  hasGraphicMedia: boolean;
  /** Whether the service has its OWN uploaded video clips — the gate for
   *  organic video content. The "Create Batch" dialog uses this to prompt
   *  for a video upload when the user wants video for a service with none. */
  hasVideoFootage: boolean;
  /** The branches offering this service. EMPTY MEANS EVERYWHERE — the
   *  empty-junction convention, not "offered nowhere". The promotion editor's
   *  service picker groups by branch off this. */
  locationIds: string[];
};

// ============================================================================
// RESPONSE TYPES
// ============================================================================

export interface ListServicesResponse {
  items: ListedService[];
  total: number;
  limit: number;
  offset: number;
}

// ============================================================================
// INPUT TYPES
// ============================================================================

export type CreateServiceInput = Omit<BackendCreateInput, 'organizationId'>;
export type UpdateServiceInput = Omit<
  BackendUpdateInput,
  'id' | 'organizationId'
>;

/**
 * Spreadsheet import: .csv text or a base64 .csv/.xlsx file, columns
 * auto-identified and imported (POST /organization-services/import-csv).
 *
 * Note this is the schema's OUTPUT type, so keys carrying a `.default()`
 * (`onDuplicate`, `createMissingCategories`, `importAsInactive`) are required
 * here even though the endpoint accepts a body without them — the caller sends
 * them explicitly. Same shape as `ImportLeadsCsvInput`.
 */
export type ImportServicesCsvInput = Omit<
  BackendImportServicesCsvInput,
  'organizationId'
>;

/** A single rejected row from a catalogue import. */
export interface ServiceImportError {
  row: number;
  message: string;
  data?: Record<string, unknown>;
}

/** `POST /organization-services/import-csv` — the import outcome summary. */
export interface ImportServicesCsvResponse {
  imported: number;
  skipped: number;
  updated: number;
  errors: ServiceImportError[];
  rowsInFile: number;
  cleanedRows: number;
  skippedRows: number;
  categoriesCreated: number;
  columnMapping: Record<string, string>;
}
