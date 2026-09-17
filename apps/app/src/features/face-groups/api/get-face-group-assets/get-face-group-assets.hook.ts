import { apiClient } from '@borradh-workspace/api-client';
import { getFaceGroupAssetsResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

interface FaceGroupAssetItem {
  id: string;
  assetId: string;
  role: 'before' | 'after' | 'untagged';
  asset: {
    id: string;
    name: string;
    blobUrl: string;
    type: string;
    duration: number | null;
    width: number | null;
    height: number | null;
    createdAt: string;
  };
}

interface GetFaceGroupAssetsResponse {
  faceGroup: {
    id: string;
    clientName: string | null;
    serviceId: string | null;
  };
  assets: FaceGroupAssetItem[];
}

export const getFaceGroupAssetsQueryOptions = (faceGroupId: string) =>
  queryOptions({
    queryKey: ['face-groups', faceGroupId, 'assets'],
    queryFn: () =>
      apiClient.get<GetFaceGroupAssetsResponse>(
        `face-groups/${faceGroupId}/assets`,
        { schema: getFaceGroupAssetsResponseSchema }
      ),
    enabled: !!faceGroupId,
    staleTime: 30 * 1000,
  });

export const useGetFaceGroupAssets = (faceGroupId: string) => {
  const query = useQuery(getFaceGroupAssetsQueryOptions(faceGroupId));
  return {
    faceGroup: query.data?.faceGroup ?? null,
    assets: query.data?.assets ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};

export type { FaceGroupAssetItem, GetFaceGroupAssetsResponse };
