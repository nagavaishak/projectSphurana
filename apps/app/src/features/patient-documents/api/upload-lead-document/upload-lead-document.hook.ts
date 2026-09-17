import { apiClient } from '@borradh-workspace/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { queryKeys } from '@/lib/query-keys';

import { patientDocumentKeys } from '../keys';
import type {
  PatientDocumentItem,
  PresignPatientDocumentResponse,
} from '../types';
import {
  type DocumentUploadTransport,
  useDocumentUploads,
} from '../use-document-uploads';

/**
 * Staff upload-on-behalf: presign/record through the staff-guarded
 * `leads/:leadId/documents` routes — the server records
 * `uploadedByType: 'staff'` with the acting user id.
 */
export const useUploadLeadDocuments = (leadId: string) => {
  const queryClient = useQueryClient();

  const transport = useMemo<DocumentUploadTransport>(
    () => ({
      presign: (body) =>
        apiClient.post<PresignPatientDocumentResponse>(
          `leads/${leadId}/documents/presign`,
          body
        ),
      record: (body) =>
        apiClient.post<PatientDocumentItem>(`leads/${leadId}/documents`, body),
    }),
    [leadId]
  );

  return useDocumentUploads(transport, {
    onRecorded: () => {
      queryClient.invalidateQueries({
        queryKey: patientDocumentKeys.lead(leadId),
      });
      // The staff Documents tab reads its rows from the lead PROFILE query,
      // not the standalone documents list — without this the upload lands on
      // the server but the table only shows it after a manual reload.
      queryClient.invalidateQueries({
        queryKey: queryKeys.leads.profile(leadId),
      });
    },
  });
};
