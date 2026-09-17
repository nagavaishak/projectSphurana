import { useMemo } from 'react';

import { useActiveOrganization } from '@/features/organization';
import { useListPractitioners } from '@/features/practitioners';

import { useListBlockedTimeTypes } from '../api';

import type {
  BlockedTimeBuildContext,
  BlockedTimeTypeOption,
} from './blocked-time-form';

export interface BlockedTimePractitionerOption {
  id: string;
  name: string;
}

/**
 * The one data source every blocked-time surface reads from: the type presets
 * (which carry the `paid` flag), the practitioner list, and the business
 * timezone. Desktop and mobile must resolve all three identically.
 */
export function useBlockedTimeContext(): BlockedTimeBuildContext & {
  practitionerOptions: BlockedTimePractitionerOption[];
} {
  const { blockedTimeTypes } = useListBlockedTimeTypes();
  const { practitioners } = useListPractitioners({
    params: { isActive: true },
  });
  const { data: organization } = useActiveOrganization();

  const timeZone = organization?.timezone ?? 'UTC';

  return useMemo(
    () => ({
      types: blockedTimeTypes as BlockedTimeTypeOption[],
      timeZone,
      practitionerOptions: practitioners.map((p) => ({
        id: p.id,
        name: p.name,
      })),
    }),
    [blockedTimeTypes, practitioners, timeZone]
  );
}
