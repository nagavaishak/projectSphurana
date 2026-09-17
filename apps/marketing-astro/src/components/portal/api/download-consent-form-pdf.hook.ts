'use client';

import { useMutation } from '@tanstack/react-query';

import { patientFetch } from '@/lib/patient-fetch';

import { usePortal } from './portal-provider';

/**
 * Fetch a short-lived presigned URL for the signed-form PDF and open it. The
 * endpoint generates the PDF on demand when it wasn't stored at sign time, so
 * completed forms can always offer the download.
 */
export const useDownloadFormPdf = (submissionId: string) => {
  const { organizationSlug } = usePortal();

  const mutation = useMutation({
    mutationFn: () =>
      patientFetch<{ url: string }>(
        `patient/consent-forms/${submissionId}/pdf`,
        { organizationSlug }
      ),
    onSuccess: ({ url }) => {
      window.open(url, '_blank', 'noopener,noreferrer');
    },
  });

  return {
    downloadPdf: () => mutation.mutate(),
    isDownloading: mutation.isPending,
    downloadError: mutation.isError,
  };
};
