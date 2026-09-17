'use client';

import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import type { SampleRecipientsInput, SampleRecipientsResponse } from './types';

// `{ recipients }` isn't a generated contract atom, so compose its shape here.
const sampleRecipientSchema = z.object({
  leadId: z.string(),
  firstName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  whatsapp: z.string().nullable(),
});

const sampleRecipientsResponseSchema = z.object({
  recipients: z.array(sampleRecipientSchema),
});

/**
 * Query the first N eligible leads for a segment + channel so the composer's
 * mail-merge preview can page through REAL recipients (their first name and
 * merge fields). It's a POST (the filter travels in the body) driven as a
 * QUERY so paging/typing re-runs it with sensible caching.
 */
export const sampleRecipientsQueryOptions = (input: SampleRecipientsInput) =>
  queryOptions({
    queryKey: queryKeys.campaigns.sampleRecipients(
      input.channel,
      input.filterJson,
      input.limit ?? null
    ),
    queryFn: () =>
      apiClient.post<SampleRecipientsResponse>(
        'campaigns/segments/sample-recipients',
        input,
        { schema: sampleRecipientsResponseSchema }
      ),
    staleTime: 30 * 1000,
    placeholderData: (prev) => prev,
  });

export const useSampleRecipients = (
  input: SampleRecipientsInput | null,
  enabled = true
) => {
  const query = useQuery({
    ...sampleRecipientsQueryOptions(
      input ?? { filterJson: {}, channel: 'email' }
    ),
    enabled: enabled && input !== null,
  });
  return {
    recipients: query.data?.recipients ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  };
};
