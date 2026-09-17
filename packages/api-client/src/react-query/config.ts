// @borradh-workspace/api-client/react-query - Query configuration

import type { DefaultOptions } from '@tanstack/react-query';

/**
 * Default React Query configuration
 * Shared between Next.js and Expo applications
 */
export const queryConfig = {
  queries: {
    // Data is considered fresh for 1 minute
    staleTime: 1000 * 60,
    // Garbage collect after 5 minutes
    gcTime: 1000 * 60 * 5,
    // Don't refetch when window regains focus
    refetchOnWindowFocus: false,
    // Retry once on failure
    retry: 1,
    // Exponential backoff with max 30s
    retryDelay: (attemptIndex: number) =>
      Math.min(1000 * 2 ** attemptIndex, 30000),
  },
  mutations: {
    // Don't retry mutations by default
    retry: 0,
  },
} satisfies DefaultOptions;
