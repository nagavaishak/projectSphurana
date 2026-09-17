import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type RenderOptions,
  type RenderResult,
  render,
} from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

/**
 * Shared render helper for component tests.
 *
 * Wraps the UI in a fresh React Query client with retries disabled and a
 * zero-length gc/stale window, so tests are deterministic and don't leak
 * cache between cases. Most components consume ergonomic feature hooks
 * (`useListLeads`, etc.) that call `apiClient` under the hood — mock
 * `@borradh-workspace/api-client` in the spec (`vi.mock`) and this provider
 * feeds the resolved data through React Query exactly as production does.
 *
 * Router-coupled components (those calling useNavigate/useParams/useSearch or
 * rendering <Link>) should `vi.mock('@tanstack/react-router', …)` in the spec —
 * we intentionally do NOT stand up a real RouterProvider here (route-tree +
 * loaders make isolated rendering brittle). Presentational components that take
 * plain props need no router mock at all.
 *
 * Since the location redesign (plan §4) a component that builds branch-scoped
 * links reads the branch out of the PATHNAME, so such a spec must also mock
 * `useRouterState`:
 *
 * ```ts
 * useRouterState: ({ select }) =>
 *   select({ location: { pathname: '/dashboard/l/test-location/calendar' } }),
 * ```
 *
 * Point it at a `/dashboard/l/:id/…` path for anything rendered inside the
 * branch layout. `useBranchRoutes()` throws without one on purpose — building a
 * branch link with no branch in scope is a data-scoping bug, and a loud failure
 * in a test is the cheap place to find it.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'> & { queryClient?: QueryClient }
): RenderResult & { queryClient: QueryClient } {
  const queryClient = options?.queryClient ?? createTestQueryClient();

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  return {
    queryClient,
    ...render(ui, { wrapper: Wrapper, ...options }),
  };
}

export * from '@testing-library/react';
