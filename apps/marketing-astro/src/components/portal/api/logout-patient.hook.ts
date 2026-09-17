'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { patientFetch } from '@/lib/patient-fetch';

import { PATIENT_PORTAL_PATHS } from './paths';
import { usePortal } from './portal-provider';

interface UseLogoutPatientOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Sign out. Best-effort: whether or not the server call succeeds we ALWAYS
 * drop the local cache and let the caller navigate away. A failed revoke must
 * never strand a patient on a screen that still looks signed-in.
 *
 * There is no token to clear here — that is the point of the cookie-only
 * transport. The cookie is cleared by the API's Set-Cookie on this response,
 * proxied through same-origin.
 *
 * Wipe the ENTIRE query cache, not just the portal namespace. Patient PHI is
 * cached under several keys (documents, consent forms, bookings), and clearing
 * only one of them left a signed-out patient's documents readable to the next
 * person on a shared device. A full clear is the only guarantee no namespace
 * is missed now or later.
 */
export const useLogoutPatient = (options?: UseLogoutPatientOptions) => {
  const { organizationSlug } = usePortal();
  const queryClient = useQueryClient();

  const clearLocalSession = () => queryClient.clear();

  const mutation = useMutation({
    mutationFn: () =>
      patientFetch<unknown>(PATIENT_PORTAL_PATHS.logout, {
        method: 'POST',
        organizationSlug,
        // Signing out of an already-dead session is a success, not a reason
        // to fire the session-expired redirect on top of our own.
        onUnauthorized: 'keep-session',
      }),
    onSuccess: () => {
      clearLocalSession();
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      clearLocalSession();
      options?.onError?.(error);
    },
  });

  return {
    logout: mutation.mutate,
    logoutAsync: mutation.mutateAsync,
    isLoggingOut: mutation.isPending,
  };
};
