import { invalidateKeys, queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  ApplyAnalysisInput,
  ApplyAnalysisResponse,
  PreviewAnalysisInput,
  WebsiteAnalysisPlan,
} from '../types';

interface UsePreviewAnalysisOptions {
  onSuccess?: (plan: WebsiteAnalysisPlan) => void;
  onError?: (error: Error) => void;
}

/**
 * Diff a finished scan against the account without writing anything.
 *
 * A mutation rather than a query: it is an explicit step the owner takes, and
 * re-running it must re-read the account (a cached plan would describe a state
 * that has since moved on).
 */
export const usePreviewAnalysis = (options?: UsePreviewAnalysisOptions) => {
  const mutation = useMutation({
    mutationFn: (input: PreviewAnalysisInput) =>
      apiClient.post<WebsiteAnalysisPlan>('website-analysis/preview', input),
    onSuccess: (plan) => options?.onSuccess?.(plan),
    onError: (error: Error) => {
      toast.error(error.message || 'Could not read the scan results');
      options?.onError?.(error);
    },
  });

  return {
    previewAnalysis: mutation.mutate,
    previewAnalysisAsync: mutation.mutateAsync,
    isPreviewing: mutation.isPending,
    plan: mutation.data ?? null,
    reset: mutation.reset,
  };
};

interface UseApplyAnalysisOptions {
  onSuccess?: (summary: ApplyAnalysisResponse) => void;
  onError?: (error: Error) => void;
}

/**
 * Write a reviewed scan into the active organization.
 *
 * One apply can create rows across most of the catalog, so it invalidates every
 * root it can write to — leaving any of them stale would show the owner a
 * "12 services added" toast above an unchanged list.
 */
export const useApplyAnalysis = (options?: UseApplyAnalysisOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: ApplyAnalysisInput) =>
      apiClient.post<ApplyAnalysisResponse>('website-analysis/apply', input),
    onSuccess: (summary) => {
      invalidateKeys(
        queryClient,
        queryKeys.organizationServices.all(),
        queryKeys.organizationLocations.all(),
        queryKeys.locationOpeningHours.all(),
        queryKeys.practitioners.all(),
        // Business hours and brand live on the org row; the venue page reads
        // the location's `about`.
        queryKeys.organization.all(),
        queryKeys.venue.all()
      );
      options?.onSuccess?.(summary);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Could not apply the scan results');
      options?.onError?.(error);
    },
  });

  return {
    applyAnalysis: mutation.mutate,
    applyAnalysisAsync: mutation.mutateAsync,
    isApplying: mutation.isPending,
    summary: mutation.data ?? null,
    reset: mutation.reset,
  };
};
