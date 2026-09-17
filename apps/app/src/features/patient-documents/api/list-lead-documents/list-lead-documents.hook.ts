import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';

import { patientDocumentKeys } from '../keys';
import type { PatientDocumentListResponse } from '../types';

/** GET leads/:leadId/documents — staff view of a patient's vault. */
export const listLeadDocumentsQueryOptions = (leadId: string) =>
  queryOptions({
    queryKey: patientDocumentKeys.lead(leadId),
    queryFn: () =>
      apiClient.get<PatientDocumentListResponse>(`leads/${leadId}/documents`),
    enabled: !!leadId,
    staleTime: 30 * 1000,
  });

export const useListLeadDocuments = (leadId: string) => {
  const query = useQuery(listLeadDocumentsQueryOptions(leadId));

  return {
    documents: query.data?.items ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
