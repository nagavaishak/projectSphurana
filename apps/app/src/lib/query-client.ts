import { QueryClient } from '@tanstack/react-query';

/**
 * Build a QueryClient with the app's shared defaults. Used for the singleton
 * below and for the admin panel's per-org isolated client (`AdminOrgScope`).
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        retry: (failureCount, error: unknown) => {
          const status = (error as { response?: { status?: number } } | null)
            ?.response?.status;
          if (status === 401 || status === 403) return false;
          return failureCount < 2;
        },
        refetchOnWindowFocus: false,
      },
    },
  });
}

export const queryClient = makeQueryClient();
