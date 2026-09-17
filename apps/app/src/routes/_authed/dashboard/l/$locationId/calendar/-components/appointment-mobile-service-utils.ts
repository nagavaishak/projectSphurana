import type { OrganizationService } from '@/features/organization-services';
import {
  UNCATEGORISED_ACCENT,
  UNCATEGORISED_KEY,
  UNCATEGORISED_LABEL,
  buildCategoryAccents,
  serviceCategoryKey,
} from '@/features/services-dashboard/mobile/services-mobile-utils';
import type { OrganizationServiceCategory } from '@borradh-workspace/api-client/types';

export interface AppointmentServicePickerRow {
  id: string;
  name: string;
  durationLabel: string | null;
  accentColor: string;
}

export interface AppointmentServiceCategoryGroup {
  /** categoryId, or UNCATEGORISED_KEY. */
  key: string;
  label: string;
  rows: AppointmentServicePickerRow[];
}

export function formatAppointmentPickerDuration(
  minutes: number | null | undefined
): string | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) {
    return null;
  }
  return `${minutes} min`;
}

function serviceToPickerRow(
  service: OrganizationService,
  accentColor: string
): AppointmentServicePickerRow {
  const durationMinutes =
    service.appointmentDuration != null
      ? Number(service.appointmentDuration)
      : null;

  return {
    id: service.id,
    name: service.name,
    durationLabel: formatAppointmentPickerDuration(durationMinutes),
    accentColor,
  };
}

/**
 * Groups the booking flow's service picker by menu category — the same
 * `categoryId` taxonomy (and accent palette) the services list uses, so the two
 * screens can't disagree about which category a service is in.
 */
export function groupServicesForAppointmentPicker(
  services: OrganizationService[],
  categories: OrganizationServiceCategory[]
): AppointmentServiceCategoryGroup[] {
  const accents = buildCategoryAccents(categories);
  const rowsByKey = new Map<string, AppointmentServicePickerRow[]>();

  for (const service of services) {
    const key = serviceCategoryKey(service);
    const row = serviceToPickerRow(
      service,
      accents.get(key) ?? UNCATEGORISED_ACCENT
    );
    rowsByKey.set(key, [...(rowsByKey.get(key) ?? []), row]);
  }

  const groups: AppointmentServiceCategoryGroup[] = [];
  for (const category of categories) {
    const rows = rowsByKey.get(category.id);
    if (rows?.length) {
      groups.push({ key: category.id, label: category.name, rows });
    }
  }

  const uncategorised = rowsByKey.get(UNCATEGORISED_KEY);
  if (uncategorised?.length) {
    groups.push({
      key: UNCATEGORISED_KEY,
      label: UNCATEGORISED_LABEL,
      rows: uncategorised,
    });
  }

  return groups;
}
