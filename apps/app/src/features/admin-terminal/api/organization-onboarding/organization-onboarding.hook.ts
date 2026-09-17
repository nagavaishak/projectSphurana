import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';

export interface OrganizationOnboardingState {
  subscription: {
    stripeSubscriptionId: string | null;
    stripeCustomerId: string;
    status: string;
    currentPeriodEnd: string | null;
  } | null;
  stripeAccount: {
    stripeAccountId: string;
    accountName: string | null;
    accountType: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
  } | null;
  meta: {
    connectionMethod: string | null;
    adAccountId: string | null;
    adAccountName: string | null;
    pages: Array<{
      pageId: string;
      pageName: string | null;
      instagramUsername: string | null;
    }>;
    whatsappNumbers: string[];
  } | null;
}

/**
 * What this org already has attached.
 *
 * The onboarding screen is otherwise stateless — a set of inputs and tickboxes
 * that reset on reload — so it would report "nothing done" for an org that was
 * fully onboarded last week.
 */
export const organizationOnboardingQueryOptions = (organizationId: string) =>
  queryOptions({
    queryKey: queryKeys.adminTerminal.onboarding(organizationId),
    queryFn: () =>
      apiClient.get<OrganizationOnboardingState>(
        `admin-terminal/organizations/${organizationId}/onboarding`
      ),
    enabled: !!organizationId,
    staleTime: 10 * 1000,
  });

export const useOrganizationOnboarding = (organizationId: string) => {
  const query = useQuery(organizationOnboardingQueryOptions(organizationId));
  return {
    onboarding: query.data ?? null,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
};
