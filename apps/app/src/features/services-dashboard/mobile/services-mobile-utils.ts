import type { OrganizationService } from '@/features/organization-services';
import type {
  Offer,
  OrganizationServiceCategory,
  PractitionerWithRelations,
} from '@borradh-workspace/api-client/types';

export const ALL_CATEGORIES = 'all' as const;
export const ALL_STAFF = 'all' as const;

/** Bucket for services with no user-defined menu category. */
export const UNCATEGORISED_KEY = '__uncategorised__';
export const UNCATEGORISED_LABEL = 'Uncategorised';

/** Grouping/filtering is by `categoryId` — the same key the desktop page uses. */
export type CategoryFilterValue = typeof ALL_CATEGORIES | string;
export type StaffFilterValue = typeof ALL_STAFF | string;

/** Accent bar colors cycled across menu categories (mirrors the desktop palette). */
export const CATEGORY_ACCENT_COLORS = [
  '#476c23',
  '#534ab7',
  '#faad4f',
  '#1447e6',
  '#b91c5c',
  '#0d9488',
] as const;

export const UNCATEGORISED_ACCENT = '#71717b';

export function serviceCategoryKey(service: OrganizationService): string {
  return service.categoryId ?? UNCATEGORISED_KEY;
}

/** categoryId → accent color, cycling the palette in category order. */
export function buildCategoryAccents(
  categories: OrganizationServiceCategory[]
): Map<string, string> {
  const map = new Map<string, string>();
  categories.forEach((category, index) => {
    map.set(
      category.id,
      CATEGORY_ACCENT_COLORS[index % CATEGORY_ACCENT_COLORS.length]
    );
  });
  map.set(UNCATEGORISED_KEY, UNCATEGORISED_ACCENT);
  return map;
}

export function formatServiceDuration(
  minutes: number | null | undefined
): string | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) {
    return null;
  }
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? '1hr' : `${hours}hr`;
  }
  return `${minutes}m`;
}

export interface ServiceListRow {
  id: string;
  service: OrganizationService;
  offers: (Offer & { serviceIds: string[] })[];
  title: string;
  accentColor: string;
  /** Grey lines under the title — duration only, or `Offer • duration` per offer. */
  detailLines: string[];
}

export function buildPractitionersByService(
  practitioners: PractitionerWithRelations[]
): Map<string, PractitionerWithRelations[]> {
  const map = new Map<string, PractitionerWithRelations[]>();
  for (const practitioner of practitioners) {
    for (const link of practitioner.services ?? []) {
      const existing = map.get(link.serviceId) ?? [];
      existing.push(practitioner);
      map.set(link.serviceId, existing);
    }
  }
  return map;
}

export function buildOffersByServiceId(
  offers: (Offer & { serviceIds: string[] })[]
): Map<string, (Offer & { serviceIds: string[] })[]> {
  const map = new Map<string, (Offer & { serviceIds: string[] })[]>();
  for (const offer of offers) {
    for (const serviceId of offer.serviceIds) {
      const existing = map.get(serviceId) ?? [];
      existing.push(offer);
      map.set(serviceId, existing);
    }
  }
  return map;
}

export function filterServices({
  services,
  search,
  categoryFilter,
  staffFilter,
  practitionersByService,
}: {
  services: OrganizationService[];
  search: string;
  categoryFilter: CategoryFilterValue;
  staffFilter: StaffFilterValue;
  practitionersByService: Map<string, PractitionerWithRelations[]>;
}): OrganizationService[] {
  let items = services;

  if (categoryFilter !== ALL_CATEGORIES) {
    items = items.filter(
      (service) => serviceCategoryKey(service) === categoryFilter
    );
  }

  if (staffFilter !== ALL_STAFF) {
    items = items.filter((service) =>
      (practitionersByService.get(service.id) ?? []).some(
        (p) => p.id === staffFilter
      )
    );
  }

  const query = search.trim().toLowerCase();
  if (query) {
    items = items.filter((service) =>
      service.name.toLowerCase().includes(query)
    );
  }

  return items;
}

export function serviceToListRow(
  service: OrganizationService,
  offers: (Offer & { serviceIds: string[] })[],
  accentColor: string = UNCATEGORISED_ACCENT
): ServiceListRow {
  const durationLabel = formatServiceDuration(
    service.appointmentDuration != null
      ? Number(service.appointmentDuration)
      : null
  );

  const detailLines = durationLabel ? [durationLabel] : [];

  return {
    id: `service-${service.id}`,
    service,
    offers,
    title: service.name,
    accentColor,
    detailLines,
  };
}

export interface ServiceCategoryGroup {
  /** categoryId, or UNCATEGORISED_KEY. */
  key: string;
  label: string;
  rows: ServiceListRow[];
}

export function groupServicesForMobileList({
  services,
  offersByServiceId,
  categories,
}: {
  services: OrganizationService[];
  offersByServiceId: Map<string, (Offer & { serviceIds: string[] })[]>;
  categories: OrganizationServiceCategory[];
}): ServiceCategoryGroup[] {
  const accents = buildCategoryAccents(categories);
  const rowsByKey = new Map<string, ServiceListRow[]>();

  for (const service of services) {
    const key = serviceCategoryKey(service);
    const row = serviceToListRow(
      service,
      offersByServiceId.get(service.id) ?? [],
      accents.get(key) ?? UNCATEGORISED_ACCENT
    );
    rowsByKey.set(key, [...(rowsByKey.get(key) ?? []), row]);
  }

  const groups: ServiceCategoryGroup[] = [];
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

export function getCategoryFilterOptions(
  services: OrganizationService[],
  categories: OrganizationServiceCategory[]
): { value: CategoryFilterValue; label: string }[] {
  const present = new Set(services.map(serviceCategoryKey));

  const options: { value: CategoryFilterValue; label: string }[] = [
    { value: ALL_CATEGORIES, label: 'All services' },
  ];

  for (const category of categories) {
    if (present.has(category.id)) {
      options.push({ value: category.id, label: category.name });
    }
  }

  if (present.has(UNCATEGORISED_KEY)) {
    options.push({ value: UNCATEGORISED_KEY, label: UNCATEGORISED_LABEL });
  }

  return options;
}

export function getStaffFilterOptions(
  practitioners: PractitionerWithRelations[]
): { value: StaffFilterValue; label: string }[] {
  return [
    { value: ALL_STAFF, label: 'All staff' },
    ...practitioners.map((p) => ({
      value: p.id,
      label: p.name.split(/\s+/)[0] || p.name,
    })),
  ];
}
