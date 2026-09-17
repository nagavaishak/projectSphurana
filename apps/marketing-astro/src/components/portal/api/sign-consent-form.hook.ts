'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { patientFetch } from '@/lib/patient-fetch';

import { patientPortalKeys } from './paths';
import { usePortal } from './portal-provider';

/**
 * Server responds 400 when `attested` isn't true and 409 when the form is
 * already signed; both surface via PatientApiError.
 */
const endpoint = (id: string) => `patient/consent-forms/${id}/sign`;

export interface SignConsentFormInput {
  fieldData: Record<string, string | boolean>;
  signedByName: string;
  attested: true;
  /** Drawn/typed signature (PNG data URL) when the form needs a signature. */
  signatureImageDataUrl?: string;
}

export const useSignConsentForm = (
  id: string,
  options?: { onSuccess?: () => void; onError?: (error: Error) => void }
) => {
  const { organizationSlug } = usePortal();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: SignConsentFormInput) =>
      patientFetch<void>(endpoint(id), {
        method: 'POST',
        body: input,
        organizationSlug,
      }),
    onSuccess: () => {
      // The submission — and the pending-forms banner that counts it —
      // changed server-side.
      queryClient.invalidateQueries({
        queryKey: patientPortalKeys.consentForms(organizationSlug),
      });
      options?.onSuccess?.();
    },
    onError: (error: Error) => options?.onError?.(error),
  });

  return {
    signConsentForm: mutation.mutate,
    signConsentFormAsync: mutation.mutateAsync,
    isSigning: mutation.isPending,
    isSigned: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
    reset: mutation.reset,
  };
};
