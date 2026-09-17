import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useGetSession } from '@/features/auth/api/get-session';
import {
  buildCreateAdPayload,
  buildLaunchAdPayload,
  useCreateAd,
  useLaunchAd,
} from '@/features/meta-ads';
import { useHealthCheck } from '@/features/meta-ads/api/health-check';
import {
  HealthCheckDialog,
  MetaErrorDialog,
  NoBudgetDialog,
  campaignHasBudget,
  useListCampaigns,
} from '@/features/meta-campaigns';
import {
  MobileDashboardHeader,
  MobileDashboardHeaderProvider,
  useMobileDashboardHeaderContent,
} from '@/features/mobile-dashboard-header';
import { MOBILE_DASHBOARD_HEADER_CLEARANCE_CLASS } from '@/features/mobile-dashboard-header/mobile-dashboard-header-layout';
import { useGetOrganization } from '@/features/organization/api/get-organization';
import { logError } from '@/lib/log-error';
import { useResolvedRoutes } from '@/lib/use-routes';
import type { MetaErrorDetail } from '@borradh-workspace/api-client';
import { useNavigate } from '@tanstack/react-router';
import { ChevronDown, Loader2, Save, Send } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { useAdWizard } from '../../-context';
import { useNewAdSearch } from '../../-hooks/use-new-ad-search';
import {
  type AdWizardFormData,
  adWizardSchema,
  defaultAdWizardValues,
} from '../../-schema';
import { getMobileActiveSteps } from '../../config/-mobile-steps';
import { AdPreview } from '../preview-panes';
import { PublishConfirmModal } from '../publish-confirm-modal';
import { CustomizeStep, DetailsStep } from '../steps';
import { AdMobileCampaign } from './ad-mobile-campaign';
import { AdMobileSelectVideo } from './ad-mobile-select-video';
import { useAdSyncCampaign } from './use-ad-sync-campaign';

async function extractMetaErrorFromResponse(
  error: unknown
): Promise<MetaErrorDetail | undefined> {
  if (
    !error ||
    typeof error !== 'object' ||
    !('response' in error) ||
    !(error as Record<string, unknown>).response
  ) {
    return undefined;
  }

  try {
    const response = (error as { response: Response }).response;
    const body = (await response.clone().json()) as Record<string, unknown>;
    const details = body.details as Record<string, unknown> | undefined;
    if (details?.metaError && typeof details.metaError === 'object') {
      return details.metaError as MetaErrorDetail;
    }
  } catch {
    // Response not JSON or already consumed
  }

  return undefined;
}

const MOBILE_STEP_COMPONENTS: Record<string, React.ComponentType> = {
  details: DetailsStep,
  customize: CustomizeStep,
};

interface AdMobileWizardProps {
  /**
   * Optional preselected campaign (from the URL `?campaignId`). When present
   * the in-wizard campaign step is skipped and this campaign is pre-filled.
   */
  campaignId?: string;
}

function AdMobileWizardInner({ campaignId }: AdMobileWizardProps) {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();
  const { videoId: preselectedVideoId } = useNewAdSearch();
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const hasJumpedToMediaStepRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [showNoBudgetDialog, setShowNoBudgetDialog] = useState(false);
  const [noBudgetCampaignName, setNoBudgetCampaignName] = useState('');
  const [metaError, setMetaError] = useState<MetaErrorDetail | null>(null);
  const [showMetaErrorDialog, setShowMetaErrorDialog] = useState(false);
  const [pendingPublishData, setPendingPublishData] =
    useState<AdWizardFormData | null>(null);
  const [showHealthCheckDialog, setShowHealthCheckDialog] = useState(false);

  const {
    runHealthCheck,
    healthCheckResult,
    isChecking: isHealthChecking,
    reset: resetHealthCheck,
  } = useHealthCheck();

  const { session } = useGetSession();
  const { organization } = useGetOrganization(
    session?.activeOrganizationId ?? ''
  );

  const {
    selectedVideo,
    selectedCampaignFollowUpType,
    selectedCampaignConfig,
    isGeneratingContent,
  } = useAdWizard();
  const { campaigns } = useListCampaigns();
  const { executeAsync: launchAdAsync, isExecuting: isLaunching } = useLaunchAd(
    false,
    false
  );
  const { executeAsync: createAdAsync, isExecuting: isCreatingAd } =
    useCreateAd(false, false);

  const form = useForm<AdWizardFormData>({
    mode: 'onBlur',
    defaultValues: {
      ...defaultAdWizardValues,
      campaignId: campaignId ?? '',
    } as AdWizardFormData,
  });

  // Seed the form + follow-up config from the URL-preselected campaign (if any).
  // In-wizard campaign selection handles its own config sync via AdMobileCampaign.
  useAdSyncCampaign(campaignId, form.setValue);

  useEffect(() => {
    if (organization?.websiteUrl && !form.getValues('destinationUrl')) {
      form.setValue('destinationUrl', organization.websiteUrl);
    }
  }, [organization?.websiteUrl, form]);

  const watchedCampaignId = form.watch('campaignId');
  const watchedAdSource = form.watch('adSource');
  const skipCampaign = Boolean(campaignId);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only recompute when campaignId, adSource, or followUpType changes
  const activeSteps = useMemo(
    () =>
      getMobileActiveSteps(form.getValues(), {
        selectedCampaignFollowUpType,
        skipCampaign,
      }),
    [
      watchedCampaignId,
      watchedAdSource,
      selectedCampaignFollowUpType,
      skipCampaign,
    ]
  );

  const currentStep = activeSteps[currentStepIndex];
  const isLastStep = currentStepIndex === activeSteps.length - 1;
  const StepComponent = currentStep
    ? MOBILE_STEP_COMPONENTS[currentStep.id]
    : null;

  useEffect(() => {
    if (!preselectedVideoId || hasJumpedToMediaStepRef.current) return;
    // Only auto-advance to the media step when a campaign is already chosen
    // (URL preselected it). Otherwise the campaign step must be completed first.
    if (!skipCampaign) return;
    const mediaStepIndex = activeSteps.findIndex(
      (s) => s.id === 'select-media'
    );
    if (mediaStepIndex < 0) return;
    hasJumpedToMediaStepRef.current = true;
    setCurrentStepIndex(mediaStepIndex);
  }, [preselectedVideoId, activeSteps, skipCampaign]);

  const handleBack = useCallback(() => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((i) => i - 1);
      return;
    }
    // First step: if launched from a campaign detail (URL had campaignId),
    // go back to that campaign. Otherwise return to the advertising list.
    if (campaignId) {
      void navigate({
        to: routes.advertisingCampaign(campaignId),
      });
      return;
    }
    void navigate({ to: routes.advertising });
  }, [
    currentStepIndex,
    navigate,
    campaignId,
    routes.advertising,
    routes.advertisingCampaign,
  ]);

  useMobileDashboardHeaderContent({
    heading: 'Create Ad',
    showBack: true,
    centerTitle: true,
    compactTitle: true,
    hideNotifications: true,
    hideTrailing: true,
    onBack: handleBack,
  });

  const validateCurrentStep = async (): Promise<boolean> => {
    const values = form.getValues();
    const schema = currentStep?.schema;
    if (!schema) return false;

    const result = await schema.safeParseAsync(values);
    if (result.success) return true;

    for (const err of result.error.issues) {
      const field = err.path[0] as keyof AdWizardFormData;
      if (field) {
        form.setError(field, { message: err.message });
      }
    }
    return false;
  };

  const handleContinue = async () => {
    const isValid = await validateCurrentStep();
    if (!isValid) return;

    if (!isLastStep) {
      setCurrentStepIndex((i) => i + 1);
    }
  };

  const handleSaveAsDraft = async () => {
    const data = form.getValues();
    const result = adWizardSchema.safeParse(data);

    if (!result.success) {
      for (const err of result.error.issues) {
        const field = err.path[0] as keyof AdWizardFormData;
        if (field) {
          form.setError(field, { message: err.message });
        }
      }
      return;
    }

    setIsSubmitting(true);

    try {
      await createAdAsync(
        buildCreateAdPayload(data, {
          followUpType: selectedCampaignFollowUpType,
          conversionDestination: selectedCampaignConfig?.conversionDestination,
        })
      );

      toast.success('Ad saved as draft');
      void navigate({ to: routes.advertising });
    } catch (error) {
      logError('ads.saveDraft', error);
      toast.error('Failed to save ad. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePublishClick = async () => {
    const data = form.getValues();
    const result = adWizardSchema.safeParse(data);

    if (!result.success) {
      for (const err of result.error.issues) {
        const field = err.path[0] as keyof AdWizardFormData;
        if (field) {
          form.setError(field, { message: err.message });
        }
      }
      return;
    }

    const selectedCampaign = campaigns.find((c) => c.id === data.campaignId);
    if (selectedCampaign && !campaignHasBudget(selectedCampaign)) {
      setNoBudgetCampaignName(selectedCampaign.name);
      setShowNoBudgetDialog(true);
      return;
    }

    setPendingPublishData(data);
    resetHealthCheck();

    const requireInstagram =
      data.adPlacement === 'instagram' || data.adPlacement === 'both';

    try {
      const health = await runHealthCheck({
        metaAdsPageId: data.metaAdsPageId || undefined,
        requireInstagram,
      });

      // Block launch only on hard fails (auth expired, account disabled, no
      // page access). 'warn' covers soft/unreliable signals (e.g. Meta
      // withholding billing data, stale spending-limit detection) and must not
      // stop a healthy account from launching.
      if (health.overall === 'fail') {
        setShowHealthCheckDialog(true);
      } else {
        setShowPublishModal(true);
      }
    } catch {
      setShowHealthCheckDialog(true);
    }
  };

  const handlePublish = async (data: AdWizardFormData) => {
    setIsSubmitting(true);

    try {
      await launchAdAsync(
        buildLaunchAdPayload(data, {
          followUpType: selectedCampaignFollowUpType,
          conversionDestination: selectedCampaignConfig?.conversionDestination,
        })
      );
      toast.success('Ad is being published! It may take a minute to go live.');
      void navigate({ to: routes.advertising });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logError('ads.publish', error);
      const metaErrorDetail = await extractMetaErrorFromResponse(error);
      if (metaErrorDetail) {
        setMetaError(metaErrorDetail);
        setShowMetaErrorDialog(true);
      } else {
        toast.error(message || 'Failed to publish ad. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
      setShowPublishModal(false);
      setPendingPublishData(null);
    }
  };

  const isLoading = isSubmitting || isLaunching || isCreatingAd;
  const isPublishBlocked = isLoading || isGeneratingContent || isHealthChecking;

  const canContinue =
    currentStep?.id === 'campaign'
      ? !!watchedCampaignId
      : currentStep?.id === 'select-media'
        ? !!selectedVideo
        : true;

  const pendingCampaign = pendingPublishData?.campaignId
    ? campaigns.find((c) => c.id === pendingPublishData.campaignId)
    : null;
  const isPendingCampaignPaused = pendingCampaign
    ? pendingCampaign.effectiveStatus === 'PAUSED' ||
      pendingCampaign.effectiveStatus === 'CAMPAIGN_PAUSED' ||
      pendingCampaign.status === 'PAUSED'
    : false;

  return (
    <FormProvider {...form}>
      <div
        className={`flex min-h-dvh flex-col bg-white ${MOBILE_DASHBOARD_HEADER_CLEARANCE_CLASS}`}
      >
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (!isLastStep) {
              void handleContinue();
            }
          }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            {currentStep?.id === 'campaign' ? (
              <div className="pt-2">
                <AdMobileCampaign />
              </div>
            ) : currentStep?.id === 'select-media' ? (
              <AdMobileSelectVideo />
            ) : StepComponent ? (
              <div className="px-4 pb-28 pt-2">
                <StepComponent />
                {/* Desktop shows AdPreview in the right pane on the customize
                    step. A phone has no right pane, so the same preview lives
                    in a collapsible section at the bottom of the step. */}
                {currentStep?.id === 'customize' ? (
                  <Collapsible defaultOpen className="mt-6">
                    <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-xl border border-[#E5E5EA] px-4 py-3 text-[15px] font-medium text-black">
                      Preview
                      <ChevronDown className="size-4 text-[#8E8E93] transition-transform group-data-[state=open]:rotate-180" />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="flex justify-center rounded-xl bg-[#F2F2F7] px-4 py-6">
                        <AdPreview />
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#E5E5EA] bg-white px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
            {!isLastStep ? (
              <Button
                type="submit"
                size="lg"
                className="h-12 w-full rounded-xl text-[17px] font-semibold"
                disabled={isLoading || !canContinue}
              >
                Continue
              </Button>
            ) : (
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="h-12 flex-1 rounded-xl"
                  disabled={isPublishBlocked}
                  onClick={() => void handleSaveAsDraft()}
                >
                  {isCreatingAd ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 size-4" />
                  )}
                  Draft
                </Button>
                <Button
                  type="button"
                  size="lg"
                  className="h-12 flex-1 rounded-xl"
                  disabled={isPublishBlocked}
                  onClick={() => void handlePublishClick()}
                >
                  {isLaunching ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : isGeneratingContent || isHealthChecking ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 size-4" />
                  )}
                  {isGeneratingContent
                    ? 'Generating…'
                    : isHealthChecking
                      ? 'Checking…'
                      : 'Publish'}
                </Button>
              </div>
            )}
          </div>
        </form>
      </div>

      <HealthCheckDialog
        open={showHealthCheckDialog}
        onOpenChange={(isOpen) => {
          setShowHealthCheckDialog(isOpen);
          if (!isOpen) setPendingPublishData(null);
        }}
        result={healthCheckResult}
        isChecking={isHealthChecking}
        onRecheck={async () => {
          const data = pendingPublishData ?? form.getValues();
          const requireInstagram =
            data.adPlacement === 'instagram' || data.adPlacement === 'both';
          try {
            await runHealthCheck({
              metaAdsPageId: data.metaAdsPageId || undefined,
              requireInstagram,
            });
          } catch {
            // show dialog with error state
          }
        }}
        onProceed={() => {
          setShowHealthCheckDialog(false);
          setShowPublishModal(true);
        }}
      />

      <NoBudgetDialog
        open={showNoBudgetDialog}
        onOpenChange={setShowNoBudgetDialog}
        campaignName={noBudgetCampaignName}
      />

      <MetaErrorDialog
        open={showMetaErrorDialog}
        onOpenChange={setShowMetaErrorDialog}
        error={metaError}
      />

      <PublishConfirmModal
        open={showPublishModal}
        onOpenChange={setShowPublishModal}
        onConfirm={async () => {
          if (pendingPublishData) {
            await handlePublish(pendingPublishData);
          }
        }}
        onSaveAsDraft={async () => {
          setShowPublishModal(false);
          setPendingPublishData(null);
          await handleSaveAsDraft();
        }}
        onCancel={() => {
          setShowPublishModal(false);
          setPendingPublishData(null);
        }}
        isLoading={isLoading}
        isNewCampaign={false}
        campaignName={pendingCampaign?.name ?? ''}
        isCampaignPaused={isPendingCampaignPaused}
      />
    </FormProvider>
  );
}

export function AdMobileWizard({ campaignId }: AdMobileWizardProps) {
  return (
    <MobileDashboardHeaderProvider>
      <AdMobileWizardInner campaignId={campaignId} />
      <MobileDashboardHeader />
    </MobileDashboardHeaderProvider>
  );
}
