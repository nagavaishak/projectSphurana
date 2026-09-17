/**
 * Resource selection on the BOOKING surfaces — the chip, the picker popover,
 * the side-panel row and the warn-don't-block toast.
 *
 * These live in `features/resources`, not under `routes/`, because the rooms
 * calendar needs them too. Keeping them under the calendar route made
 * `features/resources` import from `@/routes/...` while those same route
 * components imported back from `@/features/resources` — a circular import,
 * which ESM resolves to `undefined` bindings and React reports as an invalid
 * element type. It took the whole calendar down behind its error boundary.
 *
 * The rule this enforces: features never import from routes.
 */
export {
  useResourceScheduling,
  type ResourceScheduling,
  type RequiredResourceCategory,
  type BookingWindow,
  RESOURCE_WARNING_CLASSES,
  RESOURCE_WARNING_TEXT_CLASSES,
  categoryNoun,
  categoryNounLower,
  resolveRequiredCategories,
  busyResourceIds,
  eligibleResources,
  predictAutoResource,
} from './appointment-resource-gate';
export { AppointmentResourcePanelRow } from './appointment-resource-panel-row';
export {
  AppointmentResourceOptions,
  type ResourceAssignmentKind,
} from './appointment-resource-picker';
export { AppointmentResourceSelect } from './appointment-resource-select';
export {
  AppointmentResourceFields,
  useAppointmentResourceSelection,
  type AppointmentResourceSelection,
} from './appointment-resource-fields';
export {
  useResourceWarningToasts,
  resourceWarningsOf,
  resourceWarningMessage,
  type NotifyResourceWarningsInput,
} from './appointment-resource-warnings';
