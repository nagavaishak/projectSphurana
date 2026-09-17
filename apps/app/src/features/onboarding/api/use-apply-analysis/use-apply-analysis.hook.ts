import { invalidateKeys, queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ApplyAnalysisResponse } from '../../types';

interface UseApplyAnalysisOptions {
  onSuccess?: (data: ApplyAnalysisResponse) => void;
  onError?: (error: Error) => void;
}

/**
 * Create the organization + services from the analysis snapshot (idempotent)
 * and set it as the user's active organization server-side.
 */
export const useApplyAnalysis = (options?: UseApplyAnalysisOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post<ApplyAnalysisResponse>('onboarding/apply-analysis'),
    onSuccess: (data) => {
      // Org was just created + set active — mirror useCreateOrganization's
      // invalidations so the app picks up the new active organization. The
      // auth session is what carries `activeOrganizationId`; this used to
      // invalidate `['session']`, a key no query has, so it did nothing.
      invalidateKeys(
        queryClient,
        queryKeys.onboarding.session(),
        queryKeys.organization.all(),
        queryKeys.auth.session()
      );
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to set up your organization');
      options?.onError?.(error);
    },
  });

  return {
    applyAnalysis: mutation.mutate,
    applyAnalysisAsync: mutation.mutateAsync,
    isApplying: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
