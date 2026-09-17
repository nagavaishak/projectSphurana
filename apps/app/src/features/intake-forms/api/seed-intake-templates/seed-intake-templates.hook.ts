'use client';

import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  SeedIntakeTemplatesInput,
  SeedIntakeTemplatesResponse,
} from '../types';

export const useSeedIntakeTemplates = (options?: {
  onSuccess?: (result: SeedIntakeTemplatesResponse) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: SeedIntakeTemplatesInput = {}) =>
      apiClient.post<SeedIntakeTemplatesResponse>(
        'intake-forms/seed-templates',
        input
      ),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.intakeForms.all() });
      const created = result.created.length;
      toast.success(
        created > 0
          ? `Added ${created} form${created === 1 ? '' : 's'} from templates`
          : 'Those templates are already in your account'
      );
      options?.onSuccess?.(result);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to add templates');
    },
  });

  return {
    seedTemplates: mutation.mutate,
    isSeeding: mutation.isPending,
  };
};
