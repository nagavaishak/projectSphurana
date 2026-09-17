'use client';

import { apiClient } from '@borradh-workspace/api-client';
import {
  campaignAnalyticsSchema,
  campaignLifecycleResponseSchema,
  listCampaignRecipientsResponseSchema,
  messagingCampaignListResponseSchema,
  messagingCampaignSchema,
  messagingCampaignWithMessagesSchema,
} from '@borradh-workspace/contracts';
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  type CreateCampaignIntent,
  buildCreateCampaignPayload,
} from './create-campaign.payload';
import { buildLaunchCampaignPayload } from './launch-campaign.payload';
import type {
  Campaign,
  CampaignAnalytics,
  CampaignListResponse,
  CampaignRecipientRow,
  CampaignWithMessages,
  LaunchCampaignResponse,
  UpdateCampaignInput,
} from './types';
import {
  type UpsertCampaignMessageIntent,
  buildUpsertCampaignMessagePayload,
} from './upsert-campaign-message.payload';

const campaignKeys = {
  all: ['campaigns'] as const,
  list: (params: ListCampaignsParams) => ['campaigns', 'list', params] as const,
  detail: (id: string) => ['campaigns', id] as const,
};

export interface ListCampaignsParams {
  status?: string;
  limit?: number;
  offset?: number;
}

function buildQuery(params: ListCampaignsParams): string {
  const sp = new URLSearchParams();
  if (params.status) sp.set('status', params.status);
  if (params.limit != null) sp.set('limit', String(params.limit));
  if (params.offset != null) sp.set('offset', String(params.offset));
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

export const listCampaignsQueryOptions = (params: ListCampaignsParams = {}) =>
  queryOptions({
    queryKey: campaignKeys.list(params),
    queryFn: () =>
      apiClient.get<CampaignListResponse>(`campaigns${buildQuery(params)}`, {
        schema: messagingCampaignListResponseSchema,
      }),
    staleTime: 60 * 1000,
  });

export const useListCampaigns = (params: ListCampaignsParams = {}) => {
  const query = useQuery(listCampaignsQueryOptions(params));
  return {
    campaigns: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};

export const campaignAnalyticsQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['campaigns', id, 'analytics'],
    queryFn: () =>
      apiClient.get<CampaignAnalytics>(`campaigns/${id}/analytics`, {
        schema: campaignAnalyticsSchema,
      }),
    enabled: !!id,
    staleTime: 30 * 1000,
  });

export const useCampaignAnalytics = (id: string) => {
  const query = useQuery(campaignAnalyticsQueryOptions(id));
  return {
    analytics: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
};

export const campaignRecipientsQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['campaigns', id, 'recipients'],
    queryFn: () =>
      apiClient.get<CampaignRecipientRow[]>(`campaigns/${id}/recipients`, {
        schema: listCampaignRecipientsResponseSchema,
      }),
    enabled: !!id,
    staleTime: 30 * 1000,
  });

export const useCampaignRecipients = (id: string, enabled = true) => {
  const query = useQuery({
    ...campaignRecipientsQueryOptions(id),
    enabled: !!id && enabled,
  });
  return {
    recipients: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
};

export const getCampaignQueryOptions = (id: string) =>
  queryOptions({
    queryKey: campaignKeys.detail(id),
    queryFn: () =>
      apiClient.get<CampaignWithMessages>(`campaigns/${id}`, {
        schema: messagingCampaignWithMessagesSchema,
      }),
    enabled: !!id,
    staleTime: 30 * 1000,
  });

export const useGetCampaign = (id: string) => {
  const query = useQuery(getCampaignQueryOptions(id));
  return {
    campaign: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};

export const useCreateCampaign = (options?: {
  onSuccess?: (c: Campaign) => void;
  /** Suppress this hook's own toasts — used when an orchestrator owns them. */
  silent?: boolean;
}) => {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: CreateCampaignIntent) =>
      apiClient.post<Campaign>('campaigns', buildCreateCampaignPayload(input), {
        schema: messagingCampaignSchema,
      }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: campaignKeys.all });
      if (!options?.silent) toast.success('Bulk message created');
      options?.onSuccess?.(c);
    },
    onError: (e: Error) => {
      if (!options?.silent)
        toast.error(e.message || 'Failed to create bulk message');
    },
  });
  return {
    createCampaign: mutation.mutate,
    createCampaignAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
  };
};

export const useUpdateCampaign = (options?: {
  onSuccess?: (c: Campaign) => void;
}) => {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ id, ...input }: UpdateCampaignInput & { id: string }) =>
      apiClient.put<Campaign>(`campaigns/${id}`, input, {
        schema: messagingCampaignSchema,
      }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: campaignKeys.all });
      qc.invalidateQueries({ queryKey: campaignKeys.detail(c.id) });
      toast.success('Bulk message updated');
      options?.onSuccess?.(c);
    },
    onError: (e: Error) =>
      toast.error(e.message || 'Failed to update bulk message'),
  });
  return { updateCampaign: mutation.mutate, isUpdating: mutation.isPending };
};

export const useDeleteCampaign = (options?: { onSuccess?: () => void }) => {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`campaigns/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: campaignKeys.all });
      toast.success('Bulk message deleted');
      options?.onSuccess?.();
    },
    onError: (e: Error) =>
      toast.error(e.message || 'Failed to delete bulk message'),
  });
  return { deleteCampaign: mutation.mutate, isDeleting: mutation.isPending };
};

export const useUpsertCampaignMessage = (
  campaignId: string,
  options?: { silent?: boolean }
) => {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: UpsertCampaignMessageIntent) =>
      apiClient.post(
        `campaigns/${campaignId}/messages`,
        buildUpsertCampaignMessagePayload(input)
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: campaignKeys.detail(campaignId) });
      if (!options?.silent) toast.success('Message saved');
    },
    onError: (e: Error) => {
      if (!options?.silent) toast.error(e.message || 'Failed to save message');
    },
  });
  return {
    saveMessage: mutation.mutate,
    saveMessageAsync: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
};

const lifecycleMutation = (
  action: 'launch' | 'resume' | 'cancel',
  qc: ReturnType<typeof useQueryClient>,
  successMsg: string,
  silent?: boolean
) => ({
  mutationFn: (id: string) =>
    apiClient.post<LaunchCampaignResponse | Campaign>(
      `campaigns/${id}/${action}`,
      buildLaunchCampaignPayload(),
      { schema: campaignLifecycleResponseSchema }
    ),
  onSuccess: (_data: unknown, id: string) => {
    qc.invalidateQueries({ queryKey: campaignKeys.all });
    // Refresh the detail view so status + stats + per-recipient outcomes update.
    qc.invalidateQueries({ queryKey: campaignKeys.detail(id) });
    qc.invalidateQueries({ queryKey: ['campaigns', id, 'analytics'] });
    qc.invalidateQueries({ queryKey: ['campaigns', id, 'recipients'] });
    if (!silent) toast.success(successMsg);
  },
  onError: (e: Error) => {
    if (!silent) toast.error(e.message || `Failed to ${action}`);
  },
});

export const useLaunchCampaign = (options?: { silent?: boolean }) => {
  const qc = useQueryClient();
  const mutation = useMutation(
    lifecycleMutation('launch', qc, 'Campaign launched', options?.silent)
  );
  return {
    launchCampaign: mutation.mutate,
    launchCampaignAsync: mutation.mutateAsync,
    isLaunching: mutation.isPending,
  };
};

export const useResumeCampaign = () => {
  const qc = useQueryClient();
  const mutation = useMutation(
    lifecycleMutation('resume', qc, 'Campaign resumed')
  );
  return { resumeCampaign: mutation.mutate, isResuming: mutation.isPending };
};

export const useCancelCampaign = () => {
  const qc = useQueryClient();
  const mutation = useMutation(
    lifecycleMutation('cancel', qc, 'Campaign cancelled')
  );
  return { cancelCampaign: mutation.mutate, isCancelling: mutation.isPending };
};
