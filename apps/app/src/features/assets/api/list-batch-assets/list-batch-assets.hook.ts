import { apiClient } from '@borradh-workspace/api-client';
import type { AssetContentType } from '@borradh-workspace/api-client/types';
import { queryOptions, useQuery } from '@tanstack/react-query';

interface BatchAssetAnalysis {
  id: string;
  status: string;
  contentType: AssetContentType | null;
  analysisResult: Record<string, unknown> | null;
}

interface BatchAssetItem {
  id: string;
  name: string;
  blobUrl: string;
  sourceFileName: string | null;
  tags: string[];
  clientName: string | null;
  type: 'video' | 'image';
  duration: number | null;
  width: number | null;
  height: number | null;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
  analysis: BatchAssetAnalysis | null;
  uploader: {
    id: string;
    name: string;
    image: string | null;
  } | null;
  serviceIds: string[];
}

interface ListBatchAssetsResponse {
  items: BatchAssetItem[];
  total: number;
  limit: number;
  offset: number;
}

interface ListBatchAssetsParams {
  batchId: string;
  contentType?: AssetContentType;
  contentTypeIn?: AssetContentType[];
  contentTypeNotIn?: AssetContentType[];
  limit?: number;
  offset?: number;
}

export const listBatchAssetsQueryOptions = (params: ListBatchAssetsParams) => {
  const searchParams = new URLSearchParams();
  if (params.contentType) searchParams.set('contentType', params.contentType);
  if (params.contentTypeIn && params.contentTypeIn.length > 0)
    searchParams.set('contentTypeIn', params.contentTypeIn.join(','));
  if (params.contentTypeNotIn && params.contentTypeNotIn.length > 0)
    searchParams.set('contentTypeNotIn', params.contentTypeNotIn.join(','));
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.offset) searchParams.set('offset', String(params.offset));
  const qs = searchParams.toString();

  const cacheSegment =
    params.contentType ??
    (params.contentTypeIn
      ? `in:${params.contentTypeIn.join(',')}`
      : params.contentTypeNotIn
        ? `notIn:${params.contentTypeNotIn.join(',')}`
        : 'all');

  return queryOptions({
    queryKey: ['assets', 'batch', params.batchId, cacheSegment],
    queryFn: () =>
      apiClient.get<ListBatchAssetsResponse>(
        `assets/batch/${params.batchId}${qs ? `?${qs}` : ''}`
      ),
    enabled: !!params.batchId,
    staleTime: 30 * 1000,
  });
};

export const useListBatchAssets = (params: ListBatchAssetsParams) => {
  const query = useQuery(listBatchAssetsQueryOptions(params));
  return {
    assets: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};

export type { BatchAssetItem, ListBatchAssetsResponse };
