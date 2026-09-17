import { apiClient } from '@borradh-workspace/api-client';
import { useMutation } from '@tanstack/react-query';

export type HealthCheckStatus = 'pass' | 'fail' | 'warn';

export interface HealthCheckItem {
  check: string;
  status: HealthCheckStatus;
  detail?: string;
  actionUrl?: string;
  actionLabel?: string;
  videoGuideSlug?: string;
}

export interface HealthCheckResult {
  overall: HealthCheckStatus;
  checks: HealthCheckItem[];
}

interface HealthCheckParams {
  metaAdsPageId?: string;
  requireInstagram?: boolean;
}

/**
 * Run a pre-launch health check on the Meta ad account.
 * Uses a mutation (not query) because it's triggered on-demand before publish.
 */
export const useHealthCheck = () => {
  const mutation = useMutation({
    mutationFn: (params: HealthCheckParams = {}) => {
      const searchParams = new URLSearchParams();
      if (params.metaAdsPageId)
        searchParams.set('metaAdsPageId', params.metaAdsPageId);
      if (params.requireInstagram) searchParams.set('requireInstagram', 'true');
      const qs = searchParams.toString();
      return apiClient.get<HealthCheckResult>(
        `meta-ads/health-check${qs ? `?${qs}` : ''}`
      );
    },
  });

  return {
    runHealthCheck: mutation.mutateAsync,
    healthCheckResult: mutation.data ?? null,
    isChecking: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
    reset: mutation.reset,
  };
};
