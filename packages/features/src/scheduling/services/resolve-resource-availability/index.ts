export {
  resolveResourceAvailability,
  type ResolveResourceAvailabilityInput,
  type ResolvedResourceAvailability,
  type ResourceBusyRange,
} from './resolve-resource-availability.service.js';
export {
  filterSlotsByResources,
  hasFreeResourcesFor,
  loadResourceGateContext,
  pickResourcesFor,
  type ResourceGateContext,
  type ResourceRequirementSpec,
} from './filter-slots-by-resources.js';
