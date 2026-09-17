import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

/**
 * Response for `POST patient-portal-access/:leadId` (Portal v2 STAFF-LINK).
 *
 * `url` is a one-time magic sign-in link into the customer's portal,
 * valid for 7 days (`expiresAt` is the ISO expiry).
 */
export interface PortalAccessLink {
  url: string;
  expiresAt: string;
}

/**
 * Copy Portal Link Hook — staff-side mint of a magic sign-in link for a
 * customer's portal. The caller handles the clipboard write + success toast
 * (it needs the fallback dialog when the Clipboard API is unavailable).
 */
export const useCopyPortalLink = (
  leadId: string,
  options?: {
    onSuccess?: (link: PortalAccessLink) => void;
    onError?: (error: Error) => void;
  }
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post<PortalAccessLink>(`patient-portal-access/${leadId}`),
    onSuccess: (link) => {
      // Minting may create the portal account, flipping `hasPortalAccount`.
      queryClient.invalidateQueries({
        queryKey: queryKeys.leads.profile(leadId),
      });
      options?.onSuccess?.(link);
    },
    onError: (error: Error) => {
      toast.error("Couldn't create the link. Try again.");
      options?.onError?.(error);
    },
  });

  return {
    copyPortalLink: mutation.mutate,
    copyPortalLinkAsync: mutation.mutateAsync,
    isCopying: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
  };
};
