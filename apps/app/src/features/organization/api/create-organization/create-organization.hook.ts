import { trackEvent } from '@/components/providers';
import { invalidateKeys, queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import type {
  BusinessType,
  OutroStyle,
} from '@borradh-workspace/api-client/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';

/**
 * Content style template options
 */
export type ContentStyleTemplate =
  | 'clean_minimal'
  | 'bold_energetic'
  | 'elegant_professional'
  | 'playful_colorful';

/**
 * Business hours entry for a single day
 */
export interface BusinessHoursEntry {
  from: number; // minutes from midnight (0-1440)
  to: number; // minutes from midnight (0-1440)
}

/**
 * Business hours configuration
 * Keys are day indexes (0=Sunday, 6=Saturday)
 */
export type BusinessHours = Record<string, BusinessHoursEntry>;

/**
 * Create organization input type
 * Onboarding v2: includes website analysis fields
 */
export interface CreateOrganizationInput {
  name: string;
  logo?: string;
  businessType: BusinessType;

  // Onboarding v2 fields - Website & Social
  websiteUrl?: string;
  facebookPageUrl?: string;

  // Onboarding v2 fields - AI-extracted brand info
  brandVoice?: string[];
  targetAudienceDescription?: string;
  credibilityLine?: string;

  // Brand settings
  contentStyleTemplate?: ContentStyleTemplate;
  outroStyle?: OutroStyle;
  primaryColor?: string;
  secondaryColor?: string;

  // Primary calendar type (booking destination)
  primaryCalendarType?: string;

  // Legacy fields (kept for backwards compatibility)
  city?: string;
  country?: string;
  minPrice?: number;
  maxPrice?: number;
  idealCustomerProfile?: string;
  previousSuccesses?: string;
  businessHours?: BusinessHours;
  depositEnabled?: boolean;
  depositAmount?: number; // in cents
  defaultBookingLink?: string;
}

/**
 * Create organization response type
 */
export interface CreateOrganizationResponse {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  businessType: string;

  // Onboarding v2 fields
  websiteUrl: string | null;
  facebookPageUrl: string | null;
  brandVoice: string[] | null;
  targetAudienceDescription: string | null;
  credibilityLine: string | null;

  // Brand settings
  contentStyleTemplate: ContentStyleTemplate | null;
  outroStyle: OutroStyle | null;
  primaryColor: string | null;
  secondaryColor: string | null;

  // Legacy fields
  city: string | null;
  country: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  idealCustomerProfile: string | null;
  previousSuccesses: string | null;
  businessHours: Record<number, { from: number; to: number }> | null;
  depositEnabled: boolean;
  depositAmount: number | null;
  defaultBookingLink: string | null;
  primaryCalendarType: string | null;
  createdAt: string;
}

/**
 * Create Organization Hook
 * Creates a new organization via NestJS API
 *
 * @param options.onSuccess - Custom success callback
 * @param options.onError - Custom error callback
 * @param options.redirectTo - Redirect path after successful creation
 */
export const useCreateOrganization = (options?: {
  onSuccess?: (data: CreateOrganizationResponse) => void;
  onError?: (error: Error) => void;
  redirectTo?: string;
  /** Set to false to suppress the default success toast */
  showSuccessToast?: boolean;
}) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const mutation = useMutation({
    mutationFn: async (data: CreateOrganizationInput) => {
      return apiClient.post<CreateOrganizationResponse>('organizations', data);
    },
    onSuccess: (data) => {
      trackEvent('organization_created', { businessType: data.businessType });

      // The new org is set active server-side, so the session (which carries
      // `activeOrganizationId`) has to be refetched too. This used to
      // invalidate `['session']` — a key no query has, so it did nothing.
      invalidateKeys(
        queryClient,
        queryKeys.organization.all(),
        queryKeys.auth.session()
      );

      if (options?.showSuccessToast !== false) {
        toast.success('Organization created successfully');
      }

      if (options?.onSuccess) {
        options.onSuccess(data);
      } else if (options?.redirectTo) {
        navigate({ to: options.redirectTo as never });
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create organization');
      options?.onError?.(error);
    },
  });

  return {
    ...mutation,
    execute: mutation.mutate,
    executeAsync: mutation.mutateAsync,
    isExecuting: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
