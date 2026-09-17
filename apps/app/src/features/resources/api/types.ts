/**
 * Rooms & Equipment (resource scheduling) types for the frontend.
 *
 * Re-exports from @borradh-workspace/api-client/types following the
 * type-sharing pattern. See: .claude/rules/_patterns/type-sharing.md
 *
 * DO NOT define types here — import from api-client so the frontend and the
 * backend can never drift apart.
 */

// Entities
export type {
  AppointmentResourceAllocation,
  Resource,
  ResourceCategory,
  ResourceSpecs,
  ResourceUtilisationResponse,
  ResourceUtilisationRow,
  ResourceWarning,
  ResourceWorkingHours,
  ServiceResourceRequirements,
  ServiceResourceRequirementView,
} from '@borradh-workspace/api-client/types';

// Enum types (derived from the label records, single source of truth)
export type {
  AppointmentResourceSource,
  ResourceAssignmentMode,
  ResourceCategoryKind,
} from '@borradh-workspace/api-client/types';

// Inputs
export type {
  CreateResourceCategoryInput,
  CreateResourceInput,
  ReorderResourcesInput,
  SetServiceResourceRequirementsInput,
  UpdateResourceCategoryInput,
  UpdateResourceInput,
} from '@borradh-workspace/api-client/types';

// Labels and values for UI components (selects, chips, empty-state copy)
export {
  appointmentResourceSourceLabels,
  appointmentResourceSourceValues,
  resourceAssignmentModeLabels,
  resourceAssignmentModeValues,
  resourceCategoryKindLabels,
  resourceCategoryKindPluralLabels,
  resourceCategoryKindRequiresLabels,
  resourceCategoryKindSingularLabels,
  resourceCategoryKindValues,
  resourceCountLabel,
} from '@borradh-workspace/api-client/types';

// The category cap, re-exported so components don't reach past the api layer.
export { MAX_RESOURCE_CATEGORIES } from '@borradh-workspace/api-client/types';
