export {
  type AllocateAppointmentResourcesInput,
  type AllocateAppointmentResourcesResult,
  type AllocatedResource,
  ResourceAllocationError,
  type ResourceWarning,
  allocateAppointmentResources,
  asResourceFeatureError,
  checkAppointmentResourcesAvailable,
  reallocateAppointmentResources,
  resolveAppointmentServiceIds,
  resolveResourceAssignmentMode,
} from './allocate-appointment-resources.js';
export {
  type ReleaseAppointmentResourcesInput,
  type ReleaseAppointmentResourcesResult,
  type ReleaseAppointmentResourcesServiceResult,
  releaseAppointmentResources,
  releaseAppointmentResourcesSchema,
} from './release-appointment-resources.js';
