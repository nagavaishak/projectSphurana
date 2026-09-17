import { apiClient } from '@borradh-workspace/api-client';
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';

import { queryKeys } from '@/lib/query-keys';

/**
 * One standing content rule as it travels over the wire from
 * `GET /assistant/content-rules`.
 *
 * These are `knowledge_entry` rows — the same store as Claire's memories,
 * narrowed to org-wide preferences tagged `metadata.domain = 'content'`. They
 * are injected into every copy-generation prompt, which is why the review
 * workspace shows them as chips: a rule the owner cannot see is a rule they
 * cannot debug when a post comes out wrong.
 */
export interface ContentRule {
  id: string;
  title: string;
  content: string;
  createdAt: string;
}

export interface ContentRulesResponse {
  items: ContentRule[];
}

export const contentRulesQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.assistant.contentRules(),
    queryFn: () =>
      apiClient.get<ContentRulesResponse>('assistant/content-rules'),
    staleTime: 60 * 1000,
  });

export const useContentRules = () => {
  const query = useQuery(contentRulesQueryOptions());

  return {
    rules: query.data?.items ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error as Error | null,
  };
};

interface SaveContentRuleArgs {
  title: string;
  content: string;
  /** Which review session taught us this — provenance, not scoping. */
  batchId?: string;
}

/**
 * Promote a suggested rule into a standing one.
 *
 * Only ever called from an explicit tap. The rule applies to content generated
 * from now on and never retro-rewrites posts already accepted or scheduled,
 * which is why there is no invalidation of the batch query here — nothing
 * already on screen changes.
 */
export const useSaveContentRule = (options?: { onSuccess?: () => void }) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (args: SaveContentRuleArgs) =>
      apiClient.post<{ id: string }>('assistant/content-rules', args),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.assistant.contentRules(),
      });
      // The memories settings page lists the same rows.
      queryClient.invalidateQueries({
        queryKey: queryKeys.assistant.memories(),
      });
      toast.success('Claire will apply that to future posts');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to save that rule');
    },
  });

  return {
    saveContentRule: mutation.mutate,
    isSaving: mutation.isPending,
  };
};

/**
 * Remove a standing rule.
 *
 * Deletes through the shared memory endpoint — org-wide entries are admin-only
 * there, and that check belongs in one place rather than being re-derived for
 * content rules.
 */
export const useDeleteContentRule = (options?: { onSuccess?: () => void }) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`assistant/memories/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.assistant.contentRules(),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.assistant.memories(),
      });
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to remove that rule');
    },
  });

  return {
    deleteContentRule: mutation.mutate,
    isDeleting: mutation.isPending,
  };
};
