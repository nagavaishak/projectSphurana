import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';

export interface WhatsAppTemplate {
  id: string;
  name: string;
  status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DISABLED';
  category: string;
  language: string;
  components: Array<{
    type: string;
    text?: string;
    format?: string;
  }>;
}

export const listWhatsAppTemplatesQueryOptions = (accountId: string) =>
  queryOptions({
    queryKey: ['integrations', 'whatsapp', 'templates', accountId],
    queryFn: () =>
      apiClient.get<{ templates: WhatsAppTemplate[] }>(
        `integrations/whatsapp/accounts/${accountId}/templates`
      ),
    enabled: !!accountId,
    staleTime: 60 * 1000,
  });

export const useListWhatsAppTemplates = (accountId: string) => {
  const query = useQuery(listWhatsAppTemplatesQueryOptions(accountId));

  return {
    templates: query.data?.templates ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
};
