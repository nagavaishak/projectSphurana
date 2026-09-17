'use client';

import { apiClient } from '@borradh-workspace/api-client';
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';

import type {
  MicrositeRevisionListResponse,
  MicrositeRevisionSummary,
} from './types';
import { micrositeQueryKey } from './use-microsite';

export const revisionsQueryKey = (micrositeId: string) =>
  ['microsites', micrositeId, 'revisions'] as const;

export const revisionsQueryOptions = (micrositeId: string | null) =>
  queryOptions({
    queryKey: revisionsQueryKey(micrositeId ?? 'none'),
    queryFn: () =>
      apiClient
        .get<MicrositeRevisionListResponse | MicrositeRevisionSummary[]>(
          `microsites/${micrositeId}/revisions`
        )
        .then(normalizeRevisionList),
    enabled: !!micrositeId,
    staleTime: 30_000,
  });

/** Accepts the cursor-paginated envelope or a bare array (see types.ts). */
export function normalizeRevisionList(
  response: MicrositeRevisionListResponse | MicrositeRevisionSummary[]
): MicrositeRevisionListResponse {
  return Array.isArray(response)
    ? { items: response, nextCursor: null }
    : { items: response.items ?? [], nextCursor: response.nextCursor ?? null };
}

/** `GET microsites/:id/revisions` — version history (§4). */
export function useMicrositeRevisions(micrositeId: string | null) {
  const query = useQuery(revisionsQueryOptions(micrositeId));
  return {
    revisions: query.data?.items ?? [],
    nextCursor: query.data?.nextCursor ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * `POST microsites/:id/revisions/:rid/restore` — undo/redo AND "restore this
 * version" from history. One endpoint, because §1 makes undo a restore: the
 * revision list is the stack and nothing is ever deleted, so stepping back and
 * jumping to an old version are the same operation.
 */
export function useRestoreRevision(
  micrositeId: string | null,
  options?: { onSuccess?: (revisionId: string) => void }
) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (revisionId: string) =>
      apiClient
        .post(`microsites/${micrositeId}/revisions/${revisionId}/restore`, {})
        .then(() => revisionId),
    onSuccess: (revisionId) => {
      // The restore rewrote the draft pages AND the theme (contract §1
      // amendment 2), so the whole document is refetched — the canvas must not
      // keep a separately cached theme, or an undone theme turn leaves the
      // preview showing brand colours the draft no longer has. History and the
      // changes-since-publish count move with it.
      void queryClient.invalidateQueries({ queryKey: micrositeQueryKey });
      void queryClient.invalidateQueries({
        queryKey: revisionsQueryKey(micrositeId ?? 'none'),
      });
      toast.success('Restored');
      options?.onSuccess?.(revisionId);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Could not restore that version');
    },
  });

  return {
    restoreRevision: mutation.mutate,
    restoreRevisionAsync: mutation.mutateAsync,
    isRestoring: mutation.isPending,
    restoringId: mutation.variables ?? null,
  };
}
