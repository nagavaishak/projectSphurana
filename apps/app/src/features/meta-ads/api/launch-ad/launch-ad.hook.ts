import { trackEvent } from '@/components/providers';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { LaunchAdInput, LaunchAdResponse } from '../types';

/**
 * Launch ad hook
 *
 * Creates campaign/ad set on Meta, uploads video, and returns immediately.
 * The backend finalizes the ad in the background (polls Meta for video
 * readiness, creates creative + ad, activates campaign).
 */
export const useLaunchAd = (toastOnSuccess = true, toastOnError = true) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: LaunchAdInput) => {
      return apiClient.post<LaunchAdResponse>('meta-ads/launch', input, {
        timeout: 60000,
      });
    },
    onSuccess: () => {
      trackEvent('ad_launched');
      queryClient.invalidateQueries({ queryKey: ['meta-ads'] });
      queryClient.invalidateQueries({ queryKey: ['meta-campaigns'] });
      if (toastOnSuccess) toast.success('Ad is being published!');
    },
    onError: (error) => {
      if (toastOnError) toast.error(`Failed to launch ad: ${error.message}`);
    },
  });

  return {
    ...mutation,
    execute: mutation.mutate,
    executeAsync: mutation.mutateAsync,
    isExecuting: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
