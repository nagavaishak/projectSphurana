import { queryOptions, useQuery } from '@tanstack/react-query';

import { assistantApiUrl, assistantRequestInit } from '@/lib/assistant-request';

export interface WhatsappLink {
  id: string;
  status: 'pending' | 'active' | 'revoked';
  phoneE164: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

export interface WhatsappLinkStatusResponse {
  link: WhatsappLink | null;
}

export const whatsappLinkStatusQueryKey = ['assistant', 'whatsapp-link'];

export const whatsappLinkStatusQueryOptions = (poll: boolean) =>
  queryOptions({
    queryKey: whatsappLinkStatusQueryKey,
    queryFn: async (): Promise<WhatsappLinkStatusResponse> => {
      const res = await fetch(
        assistantApiUrl('whatsapp-link/status'),
        assistantRequestInit()
      );
      if (!res.ok) throw new Error('Failed to fetch WhatsApp link status');
      return res.json();
    },
    staleTime: 5 * 1000,
    // Poll while a pairing is pending so the card flips to "connected"
    // automatically once the owner sends the code.
    refetchInterval: poll ? 4 * 1000 : false,
  });

/**
 * Read + poll the owner's WhatsApp pairing state. Pass `poll` true while a
 * pending code is outstanding to auto-detect verification.
 */
export function useWhatsappLinkStatus(poll = false) {
  const query = useQuery(whatsappLinkStatusQueryOptions(poll));
  return {
    link: query.data?.link ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
