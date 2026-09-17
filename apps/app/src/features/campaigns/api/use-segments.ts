'use client';

import { apiClient } from '@borradh-workspace/api-client';
import {
  segmentListResponseSchema,
  segmentPreviewResponseSchema,
  segmentSchema,
} from '@borradh-workspace/contracts';
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  type CreateSegmentIntent,
  buildCreateSegmentPayload,
} from './create-segment.payload';
import type {
  PreviewSegmentInput,
  Segment,
  SegmentListResponse,
  SegmentPreviewResponse,
} from './types';

const segmentKeys = {
  all: ['segments'] as const,
  list: ['segments', 'list'] as const,
  detail: (id: string) => ['segments', id] as const,
};

export const listSegmentsQueryOptions = () =>
  queryOptions({
    queryKey: segmentKeys.list,
    queryFn: () =>
      apiClient.get<SegmentListResponse>('campaigns/segments', {
        schema: segmentListResponseSchema,
      }),
    staleTime: 60 * 1000,
  });

export const useListSegments = () => {
  const query = useQuery(listSegmentsQueryOptions());
  return {
    segments: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
};

export const useCreateSegment = (options?: {
  onSuccess?: (s: Segment) => void;
  /** Suppress this hook's own toasts — used when an orchestrator owns them. */
  silent?: boolean;
}) => {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: CreateSegmentIntent) =>
      apiClient.post<Segment>(
        'campaigns/segments',
        buildCreateSegmentPayload(input),
        { schema: segmentSchema }
      ),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: segmentKeys.all });
      if (!options?.silent) toast.success('Segment saved');
      options?.onSuccess?.(s);
    },
    onError: (e: Error) => {
      if (!options?.silent) toast.error(e.message || 'Failed to save segment');
    },
  });
  return {
    createSegment: mutation.mutate,
    createSegmentAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
  };
};

export const useDeleteSegment = () => {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`campaigns/segments/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: segmentKeys.all });
      toast.success('Segment deleted');
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to delete segment'),
  });
  return { deleteSegment: mutation.mutate, isDeleting: mutation.isPending };
};

/**
 * Live reach for an audience filter, as a QUERY keyed under ['leads', …]:
 * any mutation that invalidates leads (create, import, delete) automatically
 * refetches the count — the composer never needs a manual refresh.
 */
export const useSegmentReach = (
  filterJson: PreviewSegmentInput['filterJson']
) => {
  const query = useQuery({
    queryKey: ['leads', 'segment-reach', filterJson],
    queryFn: () =>
      apiClient.post<SegmentPreviewResponse>(
        'campaigns/segments/preview',
        { filterJson },
        { schema: segmentPreviewResponseSchema }
      ),
    staleTime: 15 * 1000,
    placeholderData: (prev) => prev,
  });
  return {
    reach: query.data ?? null,
    isLoading: query.isLoading,
  };
};

/**
 * Preview a segment's reach (total + per-channel eligible counts) for an inline
 * filter — used live in the audience step + the cost estimate.
 */
export const usePreviewSegment = () => {
  const mutation = useMutation({
    mutationFn: (input: PreviewSegmentInput) =>
      apiClient.post<SegmentPreviewResponse>(
        'campaigns/segments/preview',
        input,
        { schema: segmentPreviewResponseSchema }
      ),
    onError: (e: Error) =>
      toast.error(e.message || 'Failed to preview segment'),
  });
  return {
    preview: mutation.mutate,
    previewAsync: mutation.mutateAsync,
    data: mutation.data ?? null,
    isPreviewing: mutation.isPending,
  };
};
