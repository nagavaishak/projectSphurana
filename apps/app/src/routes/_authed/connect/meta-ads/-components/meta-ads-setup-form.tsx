import {
  MultiStepForm,
  type StepConfig,
} from '@/components/ui/multi-step-form';
import {
  useConfigureMetaIntegration,
  useGetMetaIntegration,
  useInitiateMetaAdsAuth,
} from '@/features/integrations/api';
import { useMetaLoginForBusiness } from '@/features/integrations/hooks/use-meta-login-for-business';
import { ROUTES } from '@/lib/route-paths';
import { useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useFeatureFlagEnabled } from 'posthog-js/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { filterAssetsByBusiness } from './filter-assets-by-business';
import { Step0SelectBusiness } from './step-0-select-business';
import { Step1SelectAdAccount } from './step-1-select-ad-account';
import { Step2SelectPage } from './step-2-select-page';
import { Step3EnableChatbot } from './step-3-enable-chatbot';
import { Step4Confirm } from './step-4-confirm';

const metaAdsSetupSchema = z.object({
  selectedBusinessId: z.string().optional(),
  adAccountIds: z
    .array(z.string())
    .min(1, 'Please select at least one ad account'),
  pageIds: z
    .array(z.string())
    .min(1, 'Please select at least one Facebook page'),
  enableChatbot: z.boolean(),
});

export type MetaAdsSetupFormData = z.infer<typeof metaAdsSetupSchema>;

const businessStepSchema = z.object({
  selectedBusinessId: z.string().min(1, 'Please select a business'),
});
const adAccountStepSchema = metaAdsSetupSchema.pick({ adAccountIds: true });
const pageStepSchema = metaAdsSetupSchema.pick({ pageIds: true });
const chatbotStepSchema = z.object({});
const confirmStepSchema = z.object({});

const defaultValues: MetaAdsSetupFormData = {
  selectedBusinessId: undefined,
  adAccountIds: [],
  pageIds: [],
  enableChatbot: true,
};

export type MetaAdsSetupFormProps = {
  returnTo?: string;
};

export function MetaAdsSetupForm({ returnTo }: MetaAdsSetupFormProps) {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedBusinessId, setSelectedBusinessId] = useState<
    string | undefined
  >();
  const selectedBusinessIdRef = useRef(selectedBusinessId);

  const {
    integration,
    isLoading,
    isPendingConfiguration,
    availableBusinesses,
    availableAdAccounts,
    availablePages,
    refetch,
  } = useGetMetaIntegration();

  const { configureMetaAsync } = useConfigureMetaIntegration();

  const { initiateAuth } = useInitiateMetaAdsAuth({
    returnTo: returnTo
      ? `/connect/meta-ads?returnTo=${encodeURIComponent(returnTo)}`
      : '/connect/meta-ads',
  });

  // Gradual migration: when on, reconnect uses the Facebook Login for Business
  // popup (refetch surfaces the refreshed pending integration) instead of the
  // classic redirect. Undefined/false → old path.
  const metaFlfbEnabled = useFeatureFlagEnabled('meta-flfb-login');
  const { launch: launchMetaLogin } = useMetaLoginForBusiness({
    onSuccess: () => {
      void refetch();
    },
  });

  const handleReconnect = useCallback(() => {
    if (metaFlfbEnabled) {
      launchMetaLogin();
    } else {
      initiateAuth();
    }
  }, [metaFlfbEnabled, launchMetaLogin, initiateAuth]);

  const defaultRedirect = returnTo ?? ROUTES.integrations;
  const shouldRedirect =
    !isLoading && (!integration || !isPendingConfiguration);

  useEffect(() => {
    if (shouldRedirect) {
      void navigate({ to: defaultRedirect as never, replace: true });
    }
  }, [shouldRedirect, navigate, defaultRedirect]);

  // Auto-select if only one business
  const hasMultipleBusinesses = availableBusinesses.length > 1;
  const autoSelectedBusinessId =
    availableBusinesses.length === 1 ? availableBusinesses[0].id : undefined;

  const activeBusinessId = selectedBusinessId ?? autoSelectedBusinessId;

  // Filter ad accounts and pages by selected business
  const filteredAdAccounts = useMemo(
    () => filterAssetsByBusiness(availableAdAccounts, activeBusinessId),
    [availableAdAccounts, activeBusinessId]
  );

  const filteredPages = useMemo(
    () => filterAssetsByBusiness(availablePages, activeBusinessId),
    [availablePages, activeBusinessId]
  );

  const steps = useMemo(() => {
    const result: StepConfig<MetaAdsSetupFormData>[] = [];

    // Only show business step when there are multiple businesses
    if (hasMultipleBusinesses) {
      result.push({
        id: 'select-business',
        schema: businessStepSchema,
        component: (form) => (
          <Step0SelectBusiness
            form={form}
            businesses={availableBusinesses}
            onReconnect={handleReconnect}
            onRefresh={refetch}
          />
        ),
        onBeforeContinue: async (form) => {
          const bizId = form.getValues('selectedBusinessId');
          if (bizId && bizId !== selectedBusinessIdRef.current) {
            selectedBusinessIdRef.current = bizId;
            setSelectedBusinessId(bizId);
            // Clear downstream selections when business changes
            form.setValue('adAccountIds', []);
            form.setValue('pageIds', []);
          }
          return true;
        },
      });
    }

    result.push(
      {
        id: 'select-ad-account',
        schema: adAccountStepSchema,
        component: (form) => (
          <Step1SelectAdAccount
            form={form}
            adAccounts={filteredAdAccounts}
            onReconnect={handleReconnect}
            onRefresh={refetch}
          />
        ),
      },
      {
        id: 'select-page',
        schema: pageStepSchema,
        component: (form) => (
          <Step2SelectPage
            form={form}
            pages={filteredPages}
            onReconnect={handleReconnect}
            onRefresh={refetch}
          />
        ),
      },
      {
        id: 'enable-chatbot',
        schema: chatbotStepSchema,
        component: (form) => <Step3EnableChatbot form={form} />,
      },
      {
        id: 'confirm',
        schema: confirmStepSchema,
        component: (form) => (
          <Step4Confirm
            form={form}
            availableAdAccounts={filteredAdAccounts}
            availablePages={filteredPages}
            selectedBusiness={
              hasMultipleBusinesses
                ? availableBusinesses.find((b) => b.id === activeBusinessId)
                : undefined
            }
          />
        ),
      }
    );

    return result;
  }, [
    hasMultipleBusinesses,
    availableBusinesses,
    filteredAdAccounts,
    filteredPages,
    handleReconnect,
    refetch,
    activeBusinessId,
  ]);

  // Set auto-selected business as default value
  const resolvedDefaults = useMemo(
    () => ({
      ...defaultValues,
      selectedBusinessId: autoSelectedBusinessId,
    }),
    [autoSelectedBusinessId]
  );

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-20">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Loading your Meta integration...
        </p>
      </div>
    );
  }

  // Redirect if no pending integration
  if (shouldRedirect) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-20">
        <p className="text-sm text-muted-foreground">Redirecting...</p>
      </div>
    );
  }

  const handleSubmit = async (data: MetaAdsSetupFormData) => {
    if (isSubmitting || !integration?.id) return;
    setIsSubmitting(true);

    try {
      await configureMetaAsync({
        integrationId: integration.id,
        adAccountIds: data.adAccountIds,
        pageIds: data.pageIds,
      });

      void navigate({ to: defaultRedirect as never });
    } catch {
      // Error toast is handled by the hook
      setIsSubmitting(false);
    }
  };

  return (
    <MultiStepForm
      steps={steps}
      defaultValues={resolvedDefaults}
      fullSchema={metaAdsSetupSchema}
      onSubmit={handleSubmit}
      submitButtonText={isSubmitting ? 'Connecting...' : 'Connect Meta Ads'}
      continueButtonText="Continue"
      onClose={() => void navigate({ to: defaultRedirect as never })}
    />
  );
}
