'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { patientFetch } from '@/lib/patient-fetch';

import { PATIENT_PORTAL_PATHS, patientPortalKeys } from './paths';
import { usePortal } from './portal-provider';
import type { PatientAuthResponse, VerifyOtpInput } from './types';

interface UseVerifyOtpOptions {
  onSuccess?: (data: PatientAuthResponse) => void;
  onError?: (error: Error) => void;
}

/**
 * Exchange the emailed 6-digit code for a patient session. Failure is a
 * generic 401 ("that code didn't work or has expired") surfaced inline on
 * the code input — deliberately no toast.
 *
 * The session is the httpOnly cookie the API sets on THIS response, forwarded
 * first-party by the same-origin proxy. The body also carries a bearer token;
 * apps/app stored it in localStorage and this port deliberately drops it on
 * the floor. Nothing to persist, nothing readable from JS.
 */
export const useVerifyOtp = (options?: UseVerifyOtpOptions) => {
  const { organizationSlug } = usePortal();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: VerifyOtpInput) =>
      patientFetch<PatientAuthResponse>(PATIENT_PORTAL_PATHS.verifyOtp, {
        method: 'POST',
        body: input,
        organizationSlug,
        onUnauthorized: 'keep-session',
      }),
    onSuccess: (data) => {
      // Signing in changes who the customer is everywhere in this namespace.
      queryClient.invalidateQueries({ queryKey: patientPortalKeys.all });
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => options?.onError?.(error),
  });

  return {
    verifyOtp: mutation.mutate,
    verifyOtpAsync: mutation.mutateAsync,
    isVerifyingOtp: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  };
};
