'use client';

import { apiClient, isApiClientError } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';

import type { MicrositeMineResponse } from './types';

/**
 * The HTTP status behind a failed query.
 *
 * `isApiClientError` alone does NOT work here, and the way it fails is silent:
 * the api-client is built on ky, whose `beforeError` hook augments and
 * re-throws ky's own `HTTPError` — it never constructs an `ApiClientError`. So
 * `isApiClientError(error)` is always false, `status` was always undefined,
 * and the "no website yet" empty state below could never render. An org
 * without a site got the red "we could not load your website" banner instead,
 * which reads like an outage.
 *
 * Read the status structurally, from whichever shape actually arrives.
 */
const statusOf = (error: unknown): number | undefined => {
  if (isApiClientError(error)) return error.status;
  const response = (error as { response?: { status?: number } } | null)
    ?.response;
  return response?.status;
};

export const micrositeQueryKey = ['microsites', 'mine'] as const;

export const micrositeQueryOptions = () =>
  queryOptions({
    queryKey: micrositeQueryKey,
    queryFn: () => apiClient.get<MicrositeMineResponse>('microsites/mine'),
    // The draft is mutated by the agent, by the inspector and by drag-reorder.
    // Every one of those invalidates this key, so a long stale window is safe
    // and stops the canvas iframe from being torn down on every refocus.
    staleTime: 60_000,
    retry: false,
  });

/**
 * The caller's org microsite + draft document (contract §4, `GET microsites/mine`).
 *
 * A 404 is a first-class state, not an error: an org that has never provisioned
 * a site should see the "no microsite yet" empty state, not a red banner. Any
 * other failure IS an error — an editor that silently shows an empty document
 * when the API is down is indistinguishable from an editor that lost the user's
 * work.
 */
export function useMicrosite() {
  const query = useQuery(micrositeQueryOptions());

  const isMissing = statusOf(query.error) === 404;

  return {
    microsite: query.data?.microsite ?? null,
    document: query.data?.document ?? null,
    isLoading: query.isLoading,
    /** No microsite provisioned for this org yet. */
    isMissing,
    /** A real failure — not "nothing here yet". */
    isError: query.isError && !isMissing,
    error: query.error,
    refetch: query.refetch,
  };
}
