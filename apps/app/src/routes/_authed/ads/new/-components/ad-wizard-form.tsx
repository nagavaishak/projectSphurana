import { Button } from '@/components/ui/button';
import { StepDots } from '@/components/ui/step-dots';
import { useGetSession } from '@/features/auth/api/get-session';
import {
  buildCreateAdPayload,
  buildLaunchAdPayload,
  useCreateAd,
  useLaunchAd,
  // useLaunchAdFromPost, // TODO: Re-enable when "Use Existing Post" is reimplemented
} from '@/features/meta-ads';
import { useHealthCheck } from '@/features/meta-ads/api/health-check';
import {
  HealthCheckDialog,
  MetaErrorDialog,
  NoBudgetDialog,
  campaignHasBudget,
  useListCampaigns,
} from '@/features/meta-campaigns';
import { useGetOrganization } from '@/features/organization/api/get-organization';
import { logError } from '@/lib/log-error';
import { useResolvedRoutes } from '@/lib/use-routes';
import type { MetaErrorDetail } from '@borradh-workspace/api-client';
import { useNavigate } from '@tanstack/react-router';
import { ChevronLeft, Loader2, Save, Send, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { useAdWizard } from '../-context';
import {
  type AdWizardFormData,
  adWizardSchema,
  defaultAdWizardValues,
} from '../-schema';
import { getActiveSteps } from '../config/-steps';
import { PublishConfirmModal } from './publish-confirm-modal';
import {
  // AdSourceStep, // TODO: Re-enable when "Use Existing Post" is reimplemented
  CampaignStep,
  CustomizeStep,
  DetailsStep,
  // SelectPostStep, // TODO: Re-enable when "Use Existing Post" is reimplemented
  SelectVideoStep,
} from './steps';

/**
 * Extract MetaErrorDetail from a ky HTTPError by reading the response body.
 */
async function extractMetaErrorFromResponse(
  error: unknown
): Promise<MetaErrorDetail | undefined> {
  if (
    !error ||
    typeof error !== 'object' ||
    !('response' in error) ||
    !(error as Record<string, unknown>).response
  )
    return undefined;

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

const formVariants = {
  hidden: { opacity: 0, y: 8, filter: 'blur(4px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.35, ease: [0.25, 0.1, 0.25, 1] as const },
  },
  exit: {
    opacity: 0,
    y: -8,
    filter: 'blur(4px)',
    transition: { duration: 0.2, ease: [0.25, 0.1, 0.25, 1] as const },
  },
};

interface AdWizardFormProps {
  onStepChange?: (stepIndex: number, stepId: string) => void;
  onClose?: () => void;
  preselectedCampaignId?: string;
  /**
   * Called after a successful publish or draft-save. When provided it replaces
   * the default navigate-to-advertising behaviour — used by the desktop dialog
   * to close itself and stay on the current page (e.g. the campaign detail).
   */
  onComplete?: () => void;
}

const STEP_COMPONENTS: Record<string, React.ComponentType> = {
  campaign: CampaignStep,
  // 'ad-source': AdSourceStep, // TODO: Re-enable when "Use Existing Post" is reimplemented
  details: DetailsStep,
  'select-media': SelectVideoStep,
  // 'select-post': SelectPostStep, // TODO: Re-enable when "Use Existing Post" is reimplemented
  customize: CustomizeStep,
};

export function AdWizardForm({
  onStepChange,
  onClose,
  preselectedCampaignId,
  onComplete,
}: AdWizardFormProps) {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
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
    // adSource, // TODO: Re-enable when "Use Existing Post" is reimplemented
    selectedVideo,
    // selectedPost, // TODO: Re-enable when "Use Existing Post" is reimplemented
    selectedCampaignFollowUpType,
    selectedCampaignConfig,
    setSelectedCampaignFollowUpType,
    setSelectedCampaignConfig,
    isGeneratingContent,
  } = useAdWizard();
  const { campaigns } = useListCampaigns();
  const { executeAsync: launchAdAsync, isExecuting: isLaunching } = useLaunchAd(
    false,
    false
  );
  const { executeAsync: createAdAsync, isExecuting: isCreatingAd } =
    useCreateAd(false, false);
  // TODO: Re-enable when "Use Existing Post" is reimplemented
  // const {
  //   executeAsync: launchAdFromPostAsync,
  //   isExecuting: isLaunchingFromPost,
  // } = useLaunchAdFromPost(false, false);

  const form = useForm<AdWizardFormData>({
    mode: 'onBlur',
    defaultValues: {
      ...defaultAdWizardValues,
      campaignId: preselectedCampaignId || '',
    } as AdWizardFormData,
  });

  // Pre-populate destination URL from org website when available
  useEffect(() => {
    if (organization?.websiteUrl && !form.getValues('destinationUrl')) {
      form.setValue('destinationUrl', organization.websiteUrl);
    }
  }, [organization?.websiteUrl, form]);

  // When the campaign is preselected (dialog / launched-from-campaign), the
  // in-wizard campaign step is skipped, so sync the follow-up config here.
  // Without this the customize step can't tell it's a lead_form/chatbot
  // campaign and wrongly shows the website CTA + destination URL fields.
  useEffect(() => {
    if (!preselectedCampaignId) return;
    const campaign = campaigns.find((c) => c.id === preselectedCampaignId);
    if (!campaign) return;
    setSelectedCampaignFollowUpType(campaign.followUpType);
    setSelectedCampaignConfig({
      conversionDestination: campaign.conversionDestination,
    });
  }, [
    preselectedCampaignId,
    campaigns,
    setSelectedCampaignFollowUpType,
    setSelectedCampaignConfig,
  ]);

  const campaignId = form.watch('campaignId');
  const watchedAdSource = form.watch('adSource');
  const skipCampaign = Boolean(preselectedCampaignId);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only recompute when campaignId, adSource, or followUpType changes
  const activeSteps = useMemo(
    () =>
      getActiveSteps(form.getValues(), {
        selectedCampaignFollowUpType,
        skipCampaign,
      }),
    [campaignId, watchedAdSource, selectedCampaignFollowUpType, skipCampaign]
  );

  const currentStep = activeSteps[currentStepIndex];
  const isLastStep = currentStepIndex === activeSteps.length - 1;

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

  const handleBack = () => {
    if (currentStepIndex > 0) {
      const newIndex = currentStepIndex - 1;
      setCurrentStepIndex(newIndex);
      onStepChange?.(newIndex, activeSteps[newIndex]?.id ?? '');
    }
  };

  const handleContinue = async () => {
    const isValid = await validateCurrentStep();
    if (!isValid) return;

    if (!isLastStep) {
      const newIndex = currentStepIndex + 1;
      setCurrentStepIndex(newIndex);
      onStepChange?.(newIndex, activeSteps[newIndex]?.id ?? '');
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
      if (!data.campaignId) {
        toast.error('Please select a campaign');
        return;
      }

      await createAdAsync(
        buildCreateAdPayload(data, {
          followUpType: selectedCampaignFollowUpType,
          conversionDestination: selectedCampaignConfig?.conversionDestination,
        })
      );

      toast.success('Ad saved as draft');
      if (onComplete) {
        onComplete();
      } else {
        void navigate({ to: routes.advertising });
      }
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

    if (data.campaignId) {
      const selectedCampaign = campaigns.find((c) => c.id === data.campaignId);
      if (selectedCampaign && !campaignHasBudget(selectedCampaign)) {
        setNoBudgetCampaignName(selectedCampaign.name);
        setShowNoBudgetDialog(true);
        return;
      }
    }

    // Run health check silently — only show dialog if there are problems
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
      // stop a healthy account from launching. Same gate as the mobile funnel.
      if (health.overall === 'fail') {
        setShowHealthCheckDialog(true);
      } else {
        setShowPublishModal(true);
      }
    } catch {
      // Health check request failed — show dialog with error state
      setShowHealthCheckDialog(true);
    }
  };

  const handleHealthCheckProceed = () => {
    setShowHealthCheckDialog(false);
    setShowPublishModal(true);
  };

  const handleHealthCheckRecheck = async () => {
    const data = pendingPublishData ?? form.getValues();
    const requireInstagram =
      data.adPlacement === 'instagram' || data.adPlacement === 'both';

    try {
      await runHealthCheck({
        metaAdsPageId: data.metaAdsPageId || undefined,
        requireInstagram,
      });
    } catch {
      // Still show dialog with error state
    }
  };

  const handlePublish = async (data: AdWizardFormData) => {
    setIsSubmitting(true);

    try {
      // Standard flow — create new ad from video
      await launchAdAsync(
        buildLaunchAdPayload(data, {
          followUpType: selectedCampaignFollowUpType,
          conversionDestination: selectedCampaignConfig?.conversionDestination,
        })
      );
      toast.success('Ad is being published! It may take a minute to go live.');
      if (onComplete) {
        onComplete();
      } else {
        void navigate({ to: routes.advertising });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logError('ads.publish', error);

      // Check for structured Meta error details from the API response body
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

  const handlePublishConfirm = async () => {
    if (pendingPublishData) {
      await handlePublish(pendingPublishData);
    }
  };

  const handlePublishCancel = () => {
    setShowPublishModal(false);
    setPendingPublishData(null);
  };

  const handleSaveFromModal = async () => {
    setShowPublishModal(false);
    setPendingPublishData(null);
    await handleSaveAsDraft();
  };

  const isLoading =
    isSubmitting || isLaunching || /* isLaunchingFromPost || */ isCreatingAd;
  const isPublishBlocked = isLoading || isGeneratingContent || isHealthChecking;
  // TODO: Re-enable when "Use Existing Post" is reimplemented
  // const isExistingPostFlow = adSource === 'existing_post';
  const isExistingPostFlow = false;

  const canContinue =
    currentStep?.id === 'select-media'
      ? !!selectedVideo
      : // TODO: Re-enable when "Use Existing Post" is reimplemented
        // : currentStep?.id === 'select-post'
        //   ? !!selectedPost
        true;

  const pendingCampaign = pendingPublishData?.campaignId
    ? campaigns.find((c) => c.id === pendingPublishData.campaignId)
    : null;
  const isPendingCampaignPaused = pendingCampaign
    ? pendingCampaign.effectiveStatus === 'PAUSED' ||
      pendingCampaign.effectiveStatus === 'CAMPAIGN_PAUSED' ||
      pendingCampaign.status === 'PAUSED'
    : false;

  const StepComponent = currentStep ? STEP_COMPONENTS[currentStep.id] : null;

  return (
    <FormProvider {...form}>
      <div className="flex flex-col gap-6">
        {/* Header: back · step dots · close (container provides outer chrome) */}
        <div className="flex items-center justify-between gap-2">
          <Button
            aria-label="Go back"
            className={currentStepIndex === 0 ? 'invisible' : ''}
            variant="ghost"
            size="icon"
            type="button"
            onClick={handleBack}
            disabled={isLoading}
          >
            <ChevronLeft className="size-5" />
          </Button>
          <StepDots
            totalSteps={activeSteps.length}
            currentStep={currentStepIndex}
          />
          {onClose ? (
            <Button
              aria-label="Close"
              variant="ghost"
              size="icon"
              type="button"
              onClick={onClose}
            >
              <X className="size-5" />
            </Button>
          ) : (
            <div className="size-9 shrink-0" />
          )}
        </div>

        <form
          className="flex flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (!isLastStep) {
              handleContinue();
            }
          }}
        >
          <AnimatePresence mode="wait">
            <motion.div
              animate="visible"
              exit="exit"
              initial="hidden"
              key={currentStep?.id}
              variants={formVariants}
            >
              {StepComponent && <StepComponent />}
            </motion.div>
          </AnimatePresence>

          {/* Navigation Buttons */}
          <div className="mt-8 flex gap-3">
            {!isLastStep ? (
              <Button
                disabled={isLoading || !canContinue}
                className="w-full"
                size="lg"
                type="submit"
              >
                Continue
              </Button>
            ) : (
              <>
                {!isExistingPostFlow && (
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    size="lg"
                    disabled={isPublishBlocked}
                    onClick={handleSaveAsDraft}
                  >
                    {isCreatingAd ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Save as Draft
                  </Button>
                )}
                <Button
                  type="button"
                  className="flex-1"
                  size="lg"
                  disabled={isPublishBlocked}
                  onClick={handlePublishClick}
                >
                  {isLaunching /* || isLaunchingFromPost */ ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : isGeneratingContent || isHealthChecking ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-4 w-4" />
                  )}
                  {isGeneratingContent
                    ? 'Generating...'
                    : isHealthChecking
                      ? 'Checking...'
                      : 'Publish'}
                </Button>
              </>
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
        onRecheck={handleHealthCheckRecheck}
        onProceed={handleHealthCheckProceed}
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
        onConfirm={handlePublishConfirm}
        onSaveAsDraft={handleSaveFromModal}
        onCancel={handlePublishCancel}
        isLoading={isLoading}
        isNewCampaign={false}
        campaignName={pendingCampaign?.name ?? ''}
        isCampaignPaused={isPendingCampaignPaused}
      />
    </FormProvider>
  );
}
