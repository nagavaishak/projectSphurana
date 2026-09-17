'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { patientFetch } from '@/lib/patient-fetch';

import { PATIENT_PORTAL_PATHS, patientPortalKeys } from './paths';
import { usePortal } from './portal-provider';
import type { PatientAuthResponse, VerifyMagicLinkInput } from './types';

interface UseVerifyMagicLinkOptions {
  onSuccess?: (data: PatientAuthResponse) => void;
  onError?: (error: Error) => void;
}

/**
 * Exchange a staff-shared magic-link token for a patient session. The token
 * is single-use — failure means expired/consumed, and the landing page offers
 * the OTP sign-in as the way forward (no dead ends).
 */
export const useVerifyMagicLink = (options?: UseVerifyMagicLinkOptions) => {
  const { organizationSlug } = usePortal();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: VerifyMagicLinkInput) =>
      patientFetch<PatientAuthResponse>(PATIENT_PORTAL_PATHS.verifyMagicLink, {
        method: 'POST',
        body: input,
        organizationSlug,
        // A dead link is a 401. The landing page renders its own "link
        // expired" state — a global bounce to sign-in would replace that
        // explanation with a bare form and lose the reason.
        onUnauthorized: 'keep-session',
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: patientPortalKeys.all });
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => options?.onError?.(error),
  });

  return {
    verifyMagicLink: mutation.mutate,
    verifyMagicLinkAsync: mutation.mutateAsync,
    isVerifyingMagicLink: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  };
};
