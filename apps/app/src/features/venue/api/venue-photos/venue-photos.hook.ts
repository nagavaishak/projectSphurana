'use client';

import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import {
  type ListOrganizationPhotosResponse,
  type OrganizationPhotoResponse,
  listOrganizationPhotosResponseSchema,
  organizationPhotoSchema,
} from '@borradh-workspace/contracts';
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';

/**
 * Dashboard gallery-photo management for a single location (venue).
 *
 * Every mutation invalidates the location's photo list AND the public `venue`
 * config, so the manager preview and the live page stay in step. All routes are
 * org-scoped server-side from the session; the locationId is passed explicitly.
 */

export const listVenuePhotosQueryOptions = (locationId: string) =>
  queryOptions({
    queryKey: queryKeys.venue.photos(locationId),
    queryFn: () =>
      apiClient.get<ListOrganizationPhotosResponse>(
        `venue/photos?locationId=${encodeURIComponent(locationId)}`,
        { schema: listOrganizationPhotosResponseSchema }
      ),
    enabled: !!locationId,
    staleTime: 60 * 1000,
  });

export const useListVenuePhotos = (locationId: string) => {
  const query = useQuery(listVenuePhotosQueryOptions(locationId));
  return {
    photos: query.data?.items ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};

const invalidatePhotos = (
  queryClient: ReturnType<typeof useQueryClient>,
  locationId: string
) => {
  queryClient.invalidateQueries({
    queryKey: queryKeys.venue.photos(locationId),
  });
  queryClient.invalidateQueries({ queryKey: queryKeys.venue.all() });
};

export const useCreateVenuePhoto = (
  locationId: string,
  options?: { onSuccess?: (photo: OrganizationPhotoResponse) => void }
) => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: { url: string; caption?: string | null }) =>
      apiClient.post<OrganizationPhotoResponse>(
        'venue/photos',
        { locationId, ...input },
        { schema: organizationPhotoSchema }
      ),
    onSuccess: (photo) => {
      invalidatePhotos(queryClient, locationId);
      options?.onSuccess?.(photo);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to add photo');
    },
  });
  return {
    createPhoto: mutation.mutate,
    createPhotoAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
  };
};

export const useReorderVenuePhotos = (locationId: string) => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (orderedIds: string[]) =>
      apiClient.post<ListOrganizationPhotosResponse>(
        'venue/photos/reorder',
        { locationId, orderedIds },
        { schema: listOrganizationPhotosResponseSchema }
      ),
    onSuccess: () => invalidatePhotos(queryClient, locationId),
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to reorder photos');
      // Re-sync from the server so the UI doesn't keep the failed local order.
      invalidatePhotos(queryClient, locationId);
    },
  });
  return {
    reorderPhotos: mutation.mutate,
    isReordering: mutation.isPending,
  };
};

export const useSetCoverPhoto = (locationId: string) => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (photoId: string) =>
      apiClient.post<ListOrganizationPhotosResponse>(
        'venue/photos/cover',
        { locationId, photoId },
        { schema: listOrganizationPhotosResponseSchema }
      ),
    onSuccess: () => {
      invalidatePhotos(queryClient, locationId);
      toast.success('Cover photo updated');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to set cover photo');
    },
  });
  return {
    setCover: mutation.mutate,
    isSettingCover: mutation.isPending,
  };
};

export const useDeleteVenuePhoto = (locationId: string) => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (photoId: string) =>
      apiClient.delete<{ id: string }>(
        `venue/photos/${encodeURIComponent(photoId)}`
      ),
    onSuccess: () => {
      invalidatePhotos(queryClient, locationId);
      toast.success('Photo removed');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to remove photo');
    },
  });
  return {
    deletePhoto: mutation.mutate,
    isDeleting: mutation.isPending,
  };
};
