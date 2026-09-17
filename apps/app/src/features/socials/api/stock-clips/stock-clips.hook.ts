'use client';

import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';

export interface StockClipOption {
  stockClipId: string;
  mediaType: 'video' | 'image';
  description: string | null;
  isGeneric: boolean;
  durationSec: number | null;
  previewUrl: string;
  /**
   * The org's asset for this clip when it has already been minted — stock is
   * copy-on-attach, and it is the ASSET id that lands in a video's clip list.
   * Null until this org picks the clip for the first time.
   */
  mintedAssetId: string | null;
}

interface ListStockClipsResponse {
  items: StockClipOption[];
}

export const listStockClipsQueryOptions = (params: {
  serviceId: string | null;
  mediaType?: 'video' | 'image';
}) =>
  queryOptions({
    queryKey: queryKeys.stockClips.list(
      params.serviceId,
      params.mediaType ?? 'video'
    ),
    queryFn: () => {
      const qs = new URLSearchParams();
      if (params.serviceId) qs.set('serviceId', params.serviceId);
      qs.set('mediaType', params.mediaType ?? 'video');
      return apiClient.get<ListStockClipsResponse>(
        `videos/stock-clips?${qs.toString()}`
      );
    },
    staleTime: 5 * 60 * 1000,
  });

export const useListStockClips = (params: {
  serviceId: string | null;
  mediaType?: 'video' | 'image';
}) => {
  const query = useQuery(listStockClipsQueryOptions(params));
  return {
    stockClips: query.data?.items ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
  };
};

export async function mintStockClips(
  stockClipIds: string[]
): Promise<Record<string, string>> {
  if (stockClipIds.length === 0) return {};
  const res = await apiClient.post<{ assetIds: Record<string, string> }>(
    'videos/stock-clips/mint',
    { stockClipIds }
  );
  return res.assetIds ?? {};
}
