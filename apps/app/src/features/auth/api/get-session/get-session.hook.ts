import { useSession } from '@/lib/session';

/**
 * Session hook aligned with the web app’s `useGetSession` shape for ported
 * onboarding and other flows that expect this API.
 */
export function useGetSession() {
  const query = useSession();

  return {
    user: query.data?.user ?? null,
    session: query.data?.session ?? null,
    isLoading: query.isLoading,
    isAuthenticated: !!query.data?.user,
    error: query.error,
    refetch: query.refetch,
  };
}
