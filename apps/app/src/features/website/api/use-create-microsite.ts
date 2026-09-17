'use client';

import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import type { MicrositeMineResponse } from './types';
import { micrositeQueryKey } from './use-microsite';

/**
 * Create this org's website (contract §4, `POST microsites`).
 *
 * Provisioning is a REQUEST, not a side effect of onboarding: it costs a model
 * call to write the site's copy, and while the editor is preview-only a site
 * every org silently owns but nobody can edit is worse than no site. So the
 * empty state asks.
 *
 * The response is the same shape as `GET microsites/mine`, so it seeds the
 * cache directly — the editor renders the new site without a second round
 * trip. Idempotent server-side, so a double-click is safe.
 */
export function useCreateMicrosite() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => apiClient.post<MicrositeMineResponse>('microsites'),
    onSuccess: (workspace) => {
      queryClient.setQueryData(micrositeQueryKey, workspace);
      void queryClient.invalidateQueries({ queryKey: micrositeQueryKey });
      toast.success('Your website is ready');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Could not create your website');
    },
  });

  return {
    createMicrosite: mutation.mutate,
    isCreating: mutation.isPending,
  };
}
