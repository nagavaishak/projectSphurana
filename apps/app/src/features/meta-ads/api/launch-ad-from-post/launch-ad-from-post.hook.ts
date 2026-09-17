import { trackEvent } from '@/components/providers';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { LaunchAdFromPostInput, LaunchAdFromPostResponse } from '../types';

/**
 * Launch ad from existing post hook (boost post)
 *
 * Creates ad creative from a published social post using object_story_id,
 * creates ad set + ad on Meta, and activates everything.
 * No video upload needed — much faster than the standard launch flow.
 */
export const useLaunchAdFromPost = (
  toastOnSuccess = true,
  toastOnError = true
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: LaunchAdFromPostInput) => {
      return apiClient.post<LaunchAdFromPostResponse>(
        'meta-ads/launch-from-post',
        input,
        { timeout: 30000 }
      );
    },
    onSuccess: () => {
      trackEvent('ad_launched_from_post');
      queryClient.invalidateQueries({ queryKey: ['meta-ads'] });
      queryClient.invalidateQueries({ queryKey: ['meta-campaigns'] });
      if (toastOnSuccess) toast.success('Ad from post is being published!');
    },
    onError: (error) => {
      if (toastOnError)
        toast.error(`Failed to launch ad from post: ${error.message}`);
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
