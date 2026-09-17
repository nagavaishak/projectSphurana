import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';

/**
 * Organization response type
 */
export interface OrganizationResponse {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  businessType: string;
  mainProduct: string;
  city: string;
  country: string;
  minPrice: number;
  maxPrice: number;
  idealCustomerProfile: string;
  previousSuccesses: string;
  createdAt: string;
  metadata: string | null;
  websiteUrl: string | null;
  privacyPolicyUrl: string | null;

  // Rescheduling policy
  reschedulingNoticeRequiredHours: number | null;
  noShowOrLateCancelFeeCents: number | null;
  // Freeform brand style guide — authority for colours/typography/look of
  // generated graphics. Editable on the Style settings page.
  brandStyleGuide: string | null;
  // 'clean' → edge-to-edge graphics, 'basic' → solid brand-color border
  stylePreference: string | null;
  // Video defaults — new videos inherit these caption & music settings
  videoCaptionColor: string | null;
  videoCaptionFont: string | null;
  videoCaptionPosition: 'top' | 'center' | 'bottom' | null;
  videoMusicVolume: number | null;
}

/**
 * Query options for get organization (enables prefetching, invalidation)
 */
export const getOrganizationQueryOptions = (organizationId: string) => {
  return queryOptions({
    queryKey: ['organization', organizationId],
    queryFn: async () => {
      return apiClient.get<OrganizationResponse>(
        `organizations/${organizationId}`
      );
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!organizationId,
  });
};

/**
 * Get Organization Hook
 * Returns an organization by ID via NestJS API
 *
 * @param organizationId - The organization ID to fetch
 */
export const useGetOrganization = (organizationId: string) => {
  const query = useQuery(getOrganizationQueryOptions(organizationId));

  return {
    organization: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
