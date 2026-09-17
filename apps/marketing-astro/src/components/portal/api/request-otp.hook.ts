'use client';

import { useMutation } from '@tanstack/react-query';

import { patientFetch } from '@/lib/patient-fetch';

import { PATIENT_PORTAL_PATHS } from './paths';
import { usePortal } from './portal-provider';
import type { RequestOtpInput } from './types';

interface UseRequestOtpOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Ask the API to email a 6-digit sign-in code. The response is ALWAYS a
 * neutral 202 (no account enumeration) — success here only means "if that
 * email is on file, a code is on its way". Errors are transport-level only
 * (network, 429) and surface inline on the form — deliberately no toast.
 */
export const useRequestOtp = (options?: UseRequestOtpOptions) => {
  const { organizationSlug } = usePortal();

  const mutation = useMutation({
    mutationFn: (input: RequestOtpInput) =>
      patientFetch<unknown>(PATIENT_PORTAL_PATHS.requestOtp, {
        method: 'POST',
        body: input,
        organizationSlug,
        // Pre-auth: there is no session to lose, and a 401 here must not
        // bounce the customer off the very page they are signing in on.
        onUnauthorized: 'keep-session',
      }),
    onSuccess: () => options?.onSuccess?.(),
    onError: (error: Error) => options?.onError?.(error),
  });

  return {
    requestOtp: mutation.mutate,
    requestOtpAsync: mutation.mutateAsync,
    isRequestingOtp: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  };
};
