import { queryOptions, useQuery } from '@tanstack/react-query';

import { assistantApiUrl, assistantRequestInit } from '@/lib/assistant-request';

/**
 * One memory row as it travels over the wire from
 * `GET /assistant/memories`. Dates are ISO strings (`Serialize<T>`
 * convention from `.claude/rules/_patterns/type-sharing.md`).
 *
 * `scope` is derived server-side from `userId === null` so the frontend
 * doesn't need to redo the check. Embeddings are stripped server-side.
 */
export interface MemoryListItem {
  id: string;
  organizationId: string;
  userId: string | null;
  type: string;
  title: string;
  content: string;
  source: string | null;
  confidence: number | null;
  metadata: unknown;
  scope: 'personal' | 'organization';
  createdAt: string;
  updatedAt: string;
}

export interface MemoriesListResponse {
  items: MemoryListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface UseMemoriesParams {
  type?: 'preference';
  limit?: number;
  offset?: number;
}

const buildSearch = (params: UseMemoriesParams) => {
  const sp = new URLSearchParams();
  if (params.type) sp.set('type', params.type);
  if (params.limit !== undefined) sp.set('limit', String(params.limit));
  if (params.offset !== undefined) sp.set('offset', String(params.offset));
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
};

export const memoriesQueryOptions = (params: UseMemoriesParams = {}) =>
  queryOptions({
    queryKey: ['assistant', 'memories', params] as const,
    queryFn: async (): Promise<MemoriesListResponse> => {
      const res = await fetch(
        assistantApiUrl(`memories${buildSearch(params)}`),
        assistantRequestInit()
      );
      if (!res.ok) throw new Error('Failed to load memories');
      return res.json();
    },
    staleTime: 30 * 1000,
  });

export function useMemories(params: UseMemoriesParams = {}) {
  const query = useQuery(memoriesQueryOptions(params));
  return {
    items: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    limit: query.data?.limit ?? 50,
    offset: query.data?.offset ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}
