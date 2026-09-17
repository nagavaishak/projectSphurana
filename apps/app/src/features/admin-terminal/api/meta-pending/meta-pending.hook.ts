import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';

export interface PendingMetaConnection {
  id: string;
  metaUserName: string | null;
  /** Null means the credential never lapses — the expected case. */
  tokenExpiresAt: string | null;
  createdAt: string;
  pages: Array<{
    id: string;
    name: string;
    category: string | null;
    instagramUsername: string | null;
  }>;
  adAccounts: Array<{ id: string; name: string; currency: string | null }>;
  /** Required permissions the FLfB configuration did NOT grant. */
  missingScopes: string[];
}

export interface SelfServeMetaLink {
  url: string;
  redirectUri: string;
}

export interface ClaimPendingMetaInput {
  pendingConnectionId: string;
  organizationId: string;
  pageIds: string[];
  adAccountId?: string;
  adAccountName?: string;
}

export const pendingMetaConnectionsQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.adminTerminal.metaPending(),
    queryFn: () =>
      apiClient.get<PendingMetaConnection[]>('admin-terminal/meta/pending'),
    // Short: a prospect can authorise while an operator is looking at this
    // screen, and a stale empty list reads as "they haven't done it yet".
    staleTime: 15 * 1000,
    retry: false,
  });

export const usedPendingMetaConnections = () => {
  const query = useQuery(pendingMetaConnectionsQueryOptions());
  return {
    connections: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};

export const selfServeMetaLinkQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.adminTerminal.selfServeMetaLink(),
    queryFn: () =>
      apiClient.get<SelfServeMetaLink>('admin-terminal/meta/self-serve-link'),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

export const useSelfServeMetaLink = () => {
  const query = useQuery(selfServeMetaLinkQueryOptions());
  return {
    link: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
};

export const useClaimPendingMetaConnection = (options?: {
  onSuccess?: () => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ pendingConnectionId, ...body }: ClaimPendingMetaInput) =>
      apiClient.post<{ integrationId: string; pageIds: string[] }>(
        `admin-terminal/meta/pending/${pendingConnectionId}/claim`,
        body
      ),
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.adminTerminal.all(),
      });
      toast.success(`Linked ${result.pageIds.length} Page(s)`);
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      // The server names the specific problem — already claimed, unreachable
      // Page — and that is the only thing that says what to do next.
      toast.error(error.message || 'Could not link that connection');
    },
  });

  return { claim: mutation.mutate, isClaiming: mutation.isPending };
};
