/**
 * Resource-scheduling enums (rooms, equipment) — SOURCE OF TRUTH.
 * Pure TypeScript - no Drizzle imports.
 */

/**
 * What kind of thing a resource category holds. Drives UI copy and defaults
 * only — the scheduling engine treats every category identically.
 */
export const resourceCategoryKindLabels = {
  room: 'Rooms',
  equipment: 'Equipment',
  other: 'Other',
} as const;

export const resourceCategoryKindValues = Object.keys(
  resourceCategoryKindLabels
) as [
  keyof typeof resourceCategoryKindLabels,
  ...(keyof typeof resourceCategoryKindLabels)[],
];

export type ResourceCategoryKind = keyof typeof resourceCategoryKindLabels;

/**
 * Singular noun per kind, for inline copy ("Add a room" / "Add equipment").
 */
export const resourceCategoryKindSingularLabels = {
  room: 'Room',
  equipment: 'Equipment',
  other: 'Resource',
} as const;

/**
 * Plural noun per kind, for counts ("2 rooms" / "2 equipment").
 *
 * "Equipment" is a mass noun: "0 equipments" is not English, and it is what a
 * category header printed for every clinic that added a laser.
 */
export const resourceCategoryKindPluralLabels = {
  room: 'rooms',
  equipment: 'equipment',
  other: 'resources',
} as const;

/**
 * "Requires a room" / "Requires equipment" — the article only fits a count
 * noun, so it is part of the label rather than glued on at the call site.
 */
export const resourceCategoryKindRequiresLabels = {
  room: 'Requires a room',
  equipment: 'Requires equipment',
  other: 'Requires a resource',
} as const;

/** "2 rooms" / "1 room" / "2 equipment", in the clinic's own noun. */
export const resourceCountLabel = (
  kind: keyof typeof resourceCategoryKindLabels,
  count: number
): string =>
  count === 1
    ? `1 ${resourceCategoryKindSingularLabels[kind].toLowerCase()}`
    : `${count} ${resourceCategoryKindPluralLabels[kind]}`;

/**
 * How an appointment gets its resources. Org-level setting
 * (`org_defaults.resource_assignment_mode`), `auto` by default.
 *
 * - `auto`   — the system picks a free eligible resource at booking time; staff
 *              may override it afterwards.
 * - `manual` — staff assign resources themselves for console bookings.
 *              ONLINE bookings are always auto-assigned (a client can't pick a
 *              room), otherwise online bookings could never be gated.
 */
export const resourceAssignmentModeLabels = {
  auto: 'Assign automatically',
  manual: 'Assign manually',
} as const;

export const resourceAssignmentModeValues = Object.keys(
  resourceAssignmentModeLabels
) as [
  keyof typeof resourceAssignmentModeLabels,
  ...(keyof typeof resourceAssignmentModeLabels)[],
];

export type ResourceAssignmentMode = keyof typeof resourceAssignmentModeLabels;

/** Who chose the resource on an allocation row. */
export const appointmentResourceSourceLabels = {
  auto: 'Assigned automatically',
  manual: 'Assigned by staff',
} as const;

export const appointmentResourceSourceValues = Object.keys(
  appointmentResourceSourceLabels
) as [
  keyof typeof appointmentResourceSourceLabels,
  ...(keyof typeof appointmentResourceSourceLabels)[],
];

export type AppointmentResourceSource =
  keyof typeof appointmentResourceSourceLabels;

/**
 * Hard cap on resource categories per organization.
 *
 * A clinic needs a handful of KINDS of thing a booking can occupy — rooms,
 * lasers, maybe chairs. Beyond that they stop being a taxonomy and become a
 * second, worse tag system, and every service's requirement editor grows a row
 * per category whether or not it applies.
 *
 * Lives HERE, not in `features/resources`, because the browser needs it: this
 * package is a leaf with no drizzle/postgres deps and is safe to bundle.
 * Re-exporting it from the features barrel through api-client pulled the whole
 * server graph into the web bundle and broke the app with
 * "does not provide an export named 'fromNodeProviderChain'" (AWS SDK).
 */
export const MAX_RESOURCE_CATEGORIES = 3;
