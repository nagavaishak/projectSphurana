import { apiClient } from '@borradh-workspace/api-client';
import { adSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { invalidateKeys, queryKeys } from '@/lib/query-keys';
import type { Ad } from '../types';

interface ReplaceAdCreativeParams {
  adId: string;
  /**
   * A `video.id` OR an uploaded `asset.id` — the server resolves either, the
   * same way the ad wizard's media step passes both through one field.
   */
  videoId?: string;
  /** A rendered `graphic.id`. */
  graphicId?: string;
}

/**
 * Swap the media on an UNPUBLISHED ad (`PUT /meta-ads/:id/creative`).
 *
 * The server refuses anything else — imported, existing-post, or an ad with a
 * `metaAdId` all come back `INVALID_AD_STATE`, because a creative that is
 * already on Meta is immutable and has to be replaced by launching a new ad.
 * Callers must gate on that rather than letting the owner discover it from a
 * red toast; see `CreativeEditButton`.
 */
export const useReplaceAdCreative = (
  toastOnSuccess = true,
  toastOnError = true
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ adId, videoId, graphicId }: ReplaceAdCreativeParams) => {
      return apiClient.put<Ad>(
        `meta-ads/${adId}/creative`,
        {
          ...(videoId ? { videoId } : {}),
          ...(graphicId ? { graphicId } : {}),
        },
        { schema: adSchema }
      );
    },
    onSuccess: (_, { adId }) => {
      invalidateKeys(
        queryClient,
        queryKeys.metaAds.all(),
        queryKeys.metaAds.detail(adId),
        queryKeys.metaAds.campaigns()
      );
      if (toastOnSuccess) toast.success('Creative replaced');
    },
    onError: (error) => {
      if (toastOnError)
        toast.error(`Failed to replace the creative: ${error.message}`);
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
