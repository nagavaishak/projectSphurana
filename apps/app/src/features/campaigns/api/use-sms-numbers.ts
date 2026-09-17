'use client';

import { apiClient } from '@borradh-workspace/api-client';
import {
  availableSmsNumbersResponseSchema,
  smsNumberOrNullSchema,
  smsNumberSchema,
} from '@borradh-workspace/contracts';
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  AvailableSmsNumber,
  ProvisionSmsNumberInput,
  SmsNumber,
} from './types';

const smsNumberKey = ['campaigns', 'sms-number'] as const;

export const smsNumberQueryOptions = () =>
  queryOptions({
    queryKey: smsNumberKey,
    // Returns the org's number, or null if none is provisioned.
    queryFn: () =>
      apiClient.get<SmsNumber | null>('campaigns/sms-number', {
        schema: smsNumberOrNullSchema,
      }),
    staleTime: 60 * 1000,
  });

export const useSmsNumber = () => {
  const query = useQuery(smsNumberQueryOptions());
  return {
    smsNumber: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
};

export interface SearchSmsNumbersParams {
  country: string;
  areaCode?: string;
  limit?: number;
}

export const useSearchSmsNumbers = () => {
  const mutation = useMutation({
    mutationFn: (params: SearchSmsNumbersParams) => {
      const sp = new URLSearchParams({ country: params.country });
      if (params.areaCode) sp.set('areaCode', params.areaCode);
      if (params.limit) sp.set('limit', String(params.limit));
      return apiClient.get<AvailableSmsNumber[]>(
        `campaigns/sms-number/available?${sp}`,
        { schema: availableSmsNumbersResponseSchema }
      );
    },
    onError: (e: Error) =>
      toast.error(e.message || 'Could not search for numbers'),
  });
  return {
    search: mutation.mutate,
    searchAsync: mutation.mutateAsync,
    results: mutation.data ?? [],
    isSearching: mutation.isPending,
    reset: mutation.reset,
  };
};

export const useProvisionSmsNumber = (options?: {
  onSuccess?: (n: SmsNumber) => void;
}) => {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: ProvisionSmsNumberInput) =>
      apiClient.post<SmsNumber>('campaigns/sms-number', input, {
        schema: smsNumberSchema,
      }),
    onSuccess: (n) => {
      qc.setQueryData(smsNumberKey, n);
      qc.invalidateQueries({ queryKey: ['campaigns', 'entitlements'] });
      toast.success(`SMS number ${n.phoneNumber} is ready`);
      options?.onSuccess?.(n);
    },
    onError: (e: Error) => toast.error(e.message || 'Could not buy the number'),
  });
  return {
    provision: mutation.mutate,
    isProvisioning: mutation.isPending,
  };
};
