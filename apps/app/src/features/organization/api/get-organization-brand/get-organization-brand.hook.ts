import { apiClient } from '@borradh-workspace/api-client';
import { organizationBrandResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

/**
 * Content style template IDs
 */
export type ContentStyleTemplateId =
  | 'clean_minimal'
  | 'bold_energetic'
  | 'elegant_professional'
  | 'playful_colorful';

/**
 * Organization brand response from API
 * Matches OrganizationBrandConfig from content-styles package
 */
export interface OrganizationBrandResponse {
  organizationId: string;
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  contentStyleTemplate: ContentStyleTemplateId;
  resolvedStyle: {
    id: ContentStyleTemplateId;
    name: string;
    description: string;
    defaultColors: {
      primary: string;
      secondary: string;
      accent: string;
      background: string;
      text: string;
    };
    fonts: {
      heading: string;
      body: string;
      accent: string;
    };
    captionStyle: {
      fontFamily: string;
      fontSize: number;
      color: string;
      backgroundColor: string;
      showBackground: boolean;
      backgroundStyle: 'none' | 'solid' | 'rounded' | 'highlight';
      borderRadius?: number;
      padding?: number;
    };
    outroStyle: {
      layout: 'centered' | 'split' | 'minimal' | 'branded';
      logoPosition:
        | 'top'
        | 'bottom'
        | 'center'
        | 'top-left'
        | 'top-right'
        | 'bottom-left'
        | 'bottom-right';
      animationStyle: 'fade' | 'slide' | 'zoom' | 'none';
      durationInFrames: number;
    };
    graphicStyle: {
      textAlignment: 'left' | 'center' | 'right';
      overlayOpacity: number;
      borderRadius: number;
      shadowStyle: 'none' | 'soft' | 'strong';
    };
    previewUrl?: string;
  };
  logoUrl: string | null;
  tagline: string | null;
}

/**
 * Query options for get organization brand (enables prefetching, invalidation)
 */
export const getOrganizationBrandQueryOptions = (organizationId: string) => {
  return queryOptions({
    queryKey: ['organization', organizationId, 'brand'],
    queryFn: async () => {
      return apiClient.get<OrganizationBrandResponse>(
        `organizations/${organizationId}/brand`,
        { schema: organizationBrandResponseSchema }
      );
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!organizationId,
  });
};

/**
 * Get Organization Brand Hook
 * Returns the organization's brand configuration including resolved style template
 *
 * @param organizationId - The organization ID to fetch brand for
 */
export const useGetOrganizationBrand = (organizationId: string) => {
  const query = useQuery(getOrganizationBrandQueryOptions(organizationId));

  return {
    brand: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
