import {
  useGetMetaIntegration,
  useListWhatsAppAccounts,
} from '@/features/integrations/api';
import { useListLeadForms } from '@/features/lead-forms';
import type { LeadForm } from '@/features/lead-forms/api/types';
import { useListLocations } from '@/features/organization-locations';
import { useResolvedRoutes } from '@/lib/use-routes';
import type { MetaErrorDetail } from '@borradh-workspace/api-client';
import type { MessagingDestination } from '@borradh-workspace/api-client/types';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { useCreateCampaign } from '../../api';
import type { CampaignPlatformFilterValue } from '../campaign-mobile/campaign-mobile-utils';
import type { OptimizationMode } from './create-campaign-form-fields';
import { buildCreateCampaignPayload } from './create-campaign-form.payload';
import {
  type CreateCampaignFormData,
  createCampaignFormDefaultValues,
  createCampaignFormSchema,
  forcesEngagement,
  showsOptimizationMode,
} from './create-campaign-form.schema';
import {
  extractMetaErrorFromResponse,
  getCurrencySymbol,
} from './create-campaign-form.utils';

/**
 * The create-campaign core. Owns validation, the Meta-integration derived
 * state (page / currency / destinations availability), the location prefill and
 * — crucially — the mutation payload. The desktop dialog and the mobile funnel
 * are two presentations of this hook; neither may build a payload itself.
 */
export function useCreateCampaignForm(options?: {
  onSuccessNavigate?: boolean;
  onSuccess?: () => void;
}) {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();
  const { executeAsync, isExecuting } = useCreateCampaign(true, false);
  const [metaError, setMetaError] = useState<MetaErrorDetail | null>(null);
  const [showMetaErrorDialog, setShowMetaErrorDialog] = useState(false);

  const {
    integration,
    isConnected,
    isLoading: isLoadingIntegration,
  } = useGetMetaIntegration();

  const pages = useMemo(
    () => (integration?.pages ?? []).filter((p) => p.isActive),
    [integration?.pages]
  );

  const defaultPage = useMemo(
    () =>
      pages.find((p) => p.id === integration?.defaultPageId) ??
      pages[0] ??
      null,
    [pages, integration?.defaultPageId]
  );

  const selectedCurrency = defaultPage?.defaultAdAccountCurrency ?? 'EUR';
  const currencySymbol = useMemo(
    () => getCurrencySymbol(selectedCurrency),
    [selectedCurrency]
  );
  const hasInstagramLinked = !!defaultPage?.linkedInstagramAccountId;

  const { leadForms, isLoading: isLoadingLeadForms } = useListLeadForms({
    limit: 100,
  });
  const syncedLeadForms = useMemo(
    () => leadForms.filter((f) => f.status === 'synced' && !!f.metaFormId),
    [leadForms]
  );
  const hasNoLeadForms = !isLoadingLeadForms && syncedLeadForms.length === 0;

  const { locations, isLoading: isLoadingLocations } = useListLocations();

  const form = useForm<CreateCampaignFormData>({
    // biome-ignore lint/suspicious/noExplicitAny: zodResolver type mismatch with complex schema
    resolver: zodResolver(createCampaignFormSchema) as any,
    defaultValues: createCampaignFormDefaultValues,
  });

  const followUpType = form.watch('followUpType');
  const isChatbot = followUpType === 'chatbot';
  const destinations = form.watch('destinations') ?? [];
  const optimizationMode = form.watch('optimizationMode');
  const showOptimization = showsOptimizationMode({
    followUpType,
    destinations,
  });
  const leadFormId = form.watch('leadFormId');
  const selectedLeadForm = useMemo(
    () => syncedLeadForms.find((f) => f.id === leadFormId) ?? null,
    [syncedLeadForms, leadFormId]
  );

  const { accounts: whatsappAccounts } = useListWhatsAppAccounts({
    queryConfig: { enabled: isChatbot },
  });
  const hasWhatsApp = whatsappAccounts.length > 0;

  useEffect(() => {
    if (isChatbot && destinations.length === 0) {
      form.setValue('destinations', ['messenger'], { shouldDirty: false });
    } else if (!isChatbot && destinations.length > 0) {
      form.setValue('destinations', [], { shouldDirty: false });
    }
  }, [isChatbot, destinations.length, form]);

  const targetingLocation = form.watch('targetingLocation');
  const targetingDistanceKm = form.watch('targetingDistanceKm');

  // The coordinates are only ever written together with the name (by the
  // geocoding search, or by the single-location prefill below), so the name is
  // the whole signal — there is no state where one is set without the others.
  const hasLocation = !!targetingLocation;

  // While the org's locations are still loading — or there's a single geocoded
  // location the effect below is about to fill in — hold off on rendering the
  // location-search fallback. Otherwise it flashes (and, under slower
  // responses, sticks) before the auto-prefill resolves.
  const onlyGeocodedLocation =
    locations.length === 1 &&
    locations[0]?.latitude != null &&
    locations[0]?.longitude != null;
  const locationPrefillPending =
    !hasLocation && (isLoadingLocations || onlyGeocodedLocation);

  useEffect(() => {
    if (locations.length !== 1) return;
    const only = locations[0];
    if (only.latitude == null || only.longitude == null) return;
    if (form.getValues('targetingLocation')) return;
    form.setValue('targetingLocation', only.name ?? only.city, {
      shouldValidate: true,
    });
    form.setValue('targetingLatitude', Number(only.latitude), {
      shouldValidate: true,
    });
    form.setValue('targetingLongitude', Number(only.longitude), {
      shouldValidate: true,
    });
  }, [locations, form]);

  const clearLocation = () => {
    form.setValue('targetingLocation', '', { shouldValidate: true });
    form.setValue('targetingLatitude', 0, { shouldValidate: true });
    form.setValue('targetingLongitude', 0, { shouldValidate: true });
  };

  const setLocation = (result: {
    name: string;
    latitude: number;
    longitude: number;
  }) => {
    form.setValue('targetingLocation', result.name, { shouldValidate: true });
    form.setValue('targetingLatitude', result.latitude, {
      shouldValidate: true,
    });
    form.setValue('targetingLongitude', result.longitude, {
      shouldValidate: true,
    });
  };

  /**
   * Meta blocks Lead Generation optimization for WhatsApp destinations, so any
   * selection that includes WhatsApp forces Engagement.
   */
  const setDestinations = (
    next: MessagingDestination[],
    opts?: { shouldValidate?: boolean }
  ) => {
    form.setValue('destinations', next, {
      shouldValidate: opts?.shouldValidate ?? true,
      shouldDirty: true,
    });
    if (forcesEngagement(next)) {
      form.setValue('optimizationMode', 'engagement');
    }
  };

  const toggleDestination = (value: MessagingDestination) => {
    const next = destinations.includes(value)
      ? destinations.filter((d) => d !== value)
      : [...destinations, value];
    setDestinations(next as MessagingDestination[]);
  };

  const setOptimizationMode = (value: OptimizationMode) => {
    form.setValue('optimizationMode', value, { shouldDirty: true });
  };

  const isDestinationDisabled = (value: MessagingDestination): boolean => {
    if (value === 'whatsapp') return !hasWhatsApp;
    if (value === 'instagram_dm') return !hasInstagramLinked;
    return false;
  };

  const applyPlatformFilter = (platform: CampaignPlatformFilterValue) => {
    if (!isChatbot) return;

    if (platform === 'instagram_dm') {
      if (!hasInstagramLinked) return;
      setDestinations(['instagram_dm'], { shouldValidate: false });
      return;
    }

    if (platform === 'facebook_messenger') {
      setDestinations(['messenger'], { shouldValidate: false });
      return;
    }

    const next: MessagingDestination[] = ['messenger'];
    if (hasInstagramLinked) next.push('instagram_dm');
    if (hasWhatsApp) next.push('whatsapp');
    setDestinations(next, { shouldValidate: false });
  };

  const getPlatformFilterValue = (): CampaignPlatformFilterValue => {
    if (!isChatbot) return 'all';
    if (destinations.length === 1 && destinations[0] === 'instagram_dm') {
      return 'instagram_dm';
    }
    if (destinations.length === 1 && destinations[0] === 'messenger') {
      return 'facebook_messenger';
    }
    return 'all';
  };

  const onSubmit = async (data: CreateCampaignFormData) => {
    if (!defaultPage) {
      toast.error('No active Facebook Page found');
      return;
    }
    if (data.followUpType === 'chatbot' && data.destinations.length === 0) {
      toast.error('Select at least one destination');
      return;
    }
    if (data.followUpType === 'lead_form' && !data.leadFormId) {
      toast.error('Select a lead form');
      return;
    }

    try {
      const result = await executeAsync(
        buildCreateCampaignPayload(data, { metaAdsPageId: defaultPage.id })
      );

      form.reset();
      options?.onSuccess?.();

      if (options?.onSuccessNavigate !== false) {
        navigate({
          to: routes.advertisingCampaign(result.metaCampaignId),
        });
      }

      return result;
    } catch (error) {
      const metaErrorDetail = await extractMetaErrorFromResponse(error);
      if (metaErrorDetail) {
        setMetaError(metaErrorDetail);
        setShowMetaErrorDialog(true);
      } else {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        toast.error(message || 'Failed to create campaign');
      }
      throw error;
    }
  };

  const isMetaNotConfigured = !isLoadingIntegration && !isConnected;

  return {
    form,
    onSubmit,
    isExecuting,
    isMetaNotConfigured,
    isLoadingIntegration,
    currencySymbol,
    hasInstagramLinked,
    hasWhatsApp,
    hasLocation,
    locationPrefillPending,
    targetingLocation,
    targetingDistanceKm,
    clearLocation,
    setLocation,
    isChatbot,
    followUpType,
    destinations,
    optimizationMode,
    showOptimization,
    setOptimizationMode,
    toggleDestination,
    isDestinationDisabled,
    applyPlatformFilter,
    getPlatformFilterValue,
    syncedLeadForms,
    selectedLeadForm,
    hasNoLeadForms,
    isLoadingLeadForms,
    metaError,
    showMetaErrorDialog,
    setShowMetaErrorDialog,
  };
}

export type { LeadForm };
