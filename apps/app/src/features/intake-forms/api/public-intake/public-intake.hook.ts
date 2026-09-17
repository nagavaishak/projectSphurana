'use client';

import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import type {
  PublicIntakeView,
  SubmitIntakeFormResponse,
} from '@borradh-workspace/contracts';
import { queryOptions, useMutation, useQuery } from '@tanstack/react-query';

/**
 * The patient-facing intake fill-in surface.
 *
 * The token is the credential, so it lives in the path and nowhere else — not
 * in a query string (which lands in referrer headers and server access logs)
 * and not in localStorage. Same bearer pattern as manage-booking.
 */

export const getIntakeSubmissionQueryOptions = (
  organizationSlug: string,
  token: string
) =>
  queryOptions({
    queryKey: queryKeys.intakeForms.fill(organizationSlug, token),
    queryFn: async () =>
      apiClient.get<PublicIntakeView>(
        `public/intake/${organizationSlug}/${encodeURIComponent(token)}`
      ),
    enabled: !!organizationSlug && !!token,
    // A completed/expired link changes what the page must show; never serve a
    // stale "still open" view of a form that has since been submitted.
    staleTime: 0,
    retry: false,
  });

export const useGetIntakeSubmission = (
  organizationSlug: string,
  token: string
) => {
  const query = useQuery(
    getIntakeSubmissionQueryOptions(organizationSlug, token)
  );
  return {
    view: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};

export const useSubmitIntakeForm = (
  organizationSlug: string,
  token: string,
  options?: {
    onSuccess?: (r: SubmitIntakeFormResponse) => void;
    onError?: (e: Error) => void;
  }
) => {
  const mutation = useMutation({
    mutationFn: async (input: { answers: Record<string, unknown> }) =>
      apiClient.post<SubmitIntakeFormResponse>(
        `public/intake/${organizationSlug}/${encodeURIComponent(token)}/submit`,
        input
      ),
    onSuccess: (result) => {
      options?.onSuccess?.(result);
    },
    onError: (error: Error) => {
      options?.onError?.(error);
    },
  });

  return {
    submitForm: mutation.mutate,
    isSubmitting: mutation.isPending,
  };
};
