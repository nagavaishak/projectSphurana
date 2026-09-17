import { listLocationsQueryOptions } from '@/features/organization-locations/api/list-locations';
import { useActiveOrganization } from '@/features/organization/api/get-active-organization/get-active-organization.hook';
import {
  type OrgCurrency,
  currencyForCountry,
  formatCents,
} from '@/lib/org-currency';
import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';

/**
 * The org's display currency (from the primary location country) plus a
 * bound cents formatter. Falls back to EUR while loading / with no locations.
 */
export function useOrgCurrency(): {
  currency: OrgCurrency;
  format: (cents: number) => string;
} {
  // Same org-scoped key as `useListLocations`: without it this shared one
  // cache entry served every organization, so the currency could be read from
  // another org's primary location.
  const { data: organization } = useActiveOrganization();
  const { data } = useQuery(listLocationsQueryOptions(organization?.id));
  const locations = data?.items ?? [];
  const primary = locations.find((l) => l.isPrimary) ?? locations[0];
  const currency = currencyForCountry(primary?.country);
  const format = useCallback(
    (cents: number) => formatCents(cents, currency),
    [currency]
  );
  return { currency, format };
}
