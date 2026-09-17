import {
  MultiStepForm,
  type StepConfig,
} from '@/components/ui/multi-step-form';
import { mintStockClips } from '@/features/socials/api/stock-clips';
import {
  useCreateVideo,
  useQueueVideoExport,
  useUpdateVideo,
} from '@/features/videos';
import { logError } from '@/lib/log-error';
import { ROUTES } from '@/lib/route-paths';
import { useResolvedRoutes } from '@/lib/use-routes';
import type { VideoDraftConfig } from '@borradh-workspace/api-client/types';
import { getTemplateById } from '@borradh-workspace/features/videos/templates';
import { useRuntimeConfig } from '@borradh-workspace/runtime-config/client';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { z } from 'zod';
import { useVideoCreation } from '../-context';
import {
  type ClipSlots,
  type VideoFormData,
  captionReviewStepSchema,
  createBrandedVideoFormDefaults,
  createMediaStepSchema,
  customizationOnlyStepSchema,
  mapFontFamilyToCaptionFont,
  offerStepSchema,
  scriptStepSchema,
  serviceStepSchema,
  videoFormSchema,
} from '../-schema';
import type { SlotConfig } from '../data/-slot-config';
import { ProcessingModal } from './shared/processing-modal';
import {
  CaptionReviewStep,
  CustomiseStep,
  MediaSelectionStep,
  OfferStep,
  ScriptStep,
  ServiceStep,
} from './steps';

/**
 * Transform clip slots to bRollClips array with clipType.
 *
 * For templates with ordered slots (templateSlots), each slot is emitted
 * in its order with the slot's clipType from the slot config.
 *
 * For legacy/default templates, falls back to before → bRoll → after ordering.
 */
function buildBRollClips(
  clips: ClipSlots,
  slotConfigs: SlotConfig[]
): Array<{
  assetId: string;
  url: string;
  order: number;
  clipType: 'before' | 'after' | 'bRoll';
}> {
  const result: Array<{
    assetId: string;
    url: string;
    order: number;
    clipType: 'before' | 'after' | 'bRoll';
  }> = [];

  const hasOrdered = slotConfigs.some((s) => s.order !== undefined);

  if (hasOrdered && clips.templateSlots) {
    // Ordered template slots — emit in order (each slot may hold multiple clips)
    const sortedSlots = [...slotConfigs]
      .filter((s) => s.order !== undefined)
      .sort((a, b) => (a.order as number) - (b.order as number));

    for (const slot of sortedSlots) {
      const slotValue = clips.templateSlots[String(slot.order as number)];
      // Support both array (new) and single string (legacy) formats
      const assetIds = Array.isArray(slotValue)
        ? slotValue
        : slotValue
          ? [slotValue]
          : [];
      for (const assetId of assetIds) {
        result.push({
          assetId,
          url: '', // Populated by the video-worker from asset table
          order: result.length,
          clipType: slot.type,
        });
      }
    }
  } else {
    // Legacy fallback: before → bRoll → after
    if (clips.before) {
      result.push({
        assetId: clips.before,
        url: '',
        order: result.length,
        clipType: 'before',
      });
    }

    for (const assetId of clips.bRoll || []) {
      result.push({
        assetId,
        url: '',
        order: result.length,
        clipType: 'bRoll',
      });
    }

    if (clips.after) {
      result.push({
        assetId: clips.after,
        url: '',
        order: result.length,
        clipType: 'after',
      });
    }
  }

  return result;
}

/**
 * Parse a newline-separated script into styled text frames for educational templates.
 *
 * Convention (matches the educational scriptTemplate format):
 * - First line → 'question' (the hook/question)
 * - Last line matching "book" / "link" / "consultation" → 'cta'
 * - Lines matching "results vary" / "consultation required" → 'disclaimer'
 * - Everything else → 'answer' (the benefit items)
 *
 * Duration is set to a nominal value; the video worker uses beat-synced
 * timing via educationalConfig, so the exact seconds don't matter.
 */
function parseScriptToTextFrames(scriptText: string): Array<{
  id: string;
  text: string;
  durationSec: number;
  style: 'question' | 'answer' | 'disclaimer' | 'cta';
}> {
  const lines = scriptText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const frames: Array<{
    id: string;
    text: string;
    durationSec: number;
    style: 'question' | 'answer' | 'disclaimer' | 'cta';
  }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();
    let style: 'question' | 'answer' | 'disclaimer' | 'cta';

    if (i === 0) {
      style = 'question';
    } else if (
      /\b(book|link in bio|consultation$|book now|dm us|dm me|send a dm|learn more|get started|sign up|contact us|call us|message us)\b/i.test(
        lower
      ) &&
      !/results vary|consultation required/i.test(lower)
    ) {
      style = 'cta';
    } else if (/results vary|consultation required/i.test(lower)) {
      style = 'disclaimer';
    } else {
      style = 'answer';
    }

    frames.push({
      id: `tf-${i}`,
      text: line,
      durationSec: 3, // Nominal — beat-synced timing is used by the video worker
      style,
    });
  }

  return frames;
}

/** Non-configurable caption defaults (not exposed in the form) */
const CAPTION_DEFAULTS = {
  fontSize: 64,
  highlightColor: '#FFFFFF',
  showBackground: false,
} as const;

/** Non-configurable outro defaults */
const OUTRO_DEFAULTS = {
  ctaText: 'Book Now',
  backgroundOpacity: 0.7,
  textColor: '#FFFFFF',
  durationSec: 3,
} as const;

interface VideoCreationFormProps {
  onStepChange?: (stepIndex: number, stepId: string) => void;
  adsReturnContext?: { campaignId: string };
  initialAllowStockFootage?: boolean;
  layout?: 'default' | 'mobile';
  onMobileStepIndexChange?: (stepIndex: number) => void;
  registerGoBack?: (goBack: (() => void) | null) => void;
}

export function VideoCreationForm({
  onStepChange,
  adsReturnContext,
  initialAllowStockFootage = false,
  layout = 'default',
  onMobileStepIndexChange,
  registerGoBack,
}: VideoCreationFormProps) {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();
  const queryClient = useQueryClient();

  const [isProcessing, setIsProcessing] = useState(false);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  const {
    talkingHeadUrl,
    isUploading,
    brand,
    videoDefaults,
    organizationName,
    selectedVariation,
    draftVideoId,
    setDraftVideoId,
    narrationMode,
    slotConfigs,
    startScriptGeneration,
    generatedScript,
    hasMobileUpload,
    templateId,
  } = useVideoCreation();
  const { createVideoAsync, isCreating } = useCreateVideo();
  const { updateVideoAsync } = useUpdateVideo({ silent: true });
  const { queueExportAsync } = useQueueVideoExport();
  const { cdnUrl } = useRuntimeConfig();

  const isOffer = templateId === 'offer';
  const isEducational = templateId === 'educational';
  const isBeforeAfter = templateId === 'before-after';

  // Create branded default values based on organization's content style
  const brandedDefaults = useMemo(() => {
    const defaults = createBrandedVideoFormDefaults(brand, videoDefaults);
    // Educational, before-after, and offer templates use text_only narration — set it as default
    // so schema refinements that check narrationType pass correctly
    if (isOffer || isEducational || isBeforeAfter) {
      defaults.narrationType = 'text_only';
    }
    if (!isBeforeAfter) {
      defaults.allowStockFootage = initialAllowStockFootage;
    }
    // Select a random music track by default
    const cdnBaseUrl = cdnUrl ?? '';
    const musicTracks = getTemplateById(templateId)?.musicTracks ?? [];
    if (musicTracks.length > 0) {
      const randomTrack =
        musicTracks[Math.floor(Math.random() * musicTracks.length)];
      defaults.musicTrackId = randomTrack.id;
      defaults.musicUrl = `${cdnBaseUrl}${randomTrack.path}`;
    }

    return defaults;
  }, [
    brand,
    videoDefaults,
    isOffer,
    isEducational,
    isBeforeAfter,
    initialAllowStockFootage,
    templateId,
    cdnUrl,
  ]);

  // Warn user before leaving with unsaved progress
  useEffect(() => {
    const hasProgress = !!draftVideoId || !!talkingHeadUrl || hasMobileUpload;

    if (!hasProgress || isProcessing) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [draftVideoId, talkingHeadUrl, hasMobileUpload, isProcessing]);

  /**
   * Called when the user clicks "Continue" on the service step.
   * Creates the draft video early so the QR code is available
   * on the script step for mobile recording.
   */
  const handleServiceBeforeContinue = useCallback(
    async (
      form: import('react-hook-form').UseFormReturn<VideoFormData>
    ): Promise<boolean> => {
      const serviceId = form.getValues('serviceId') || undefined;
      const offerId = form.getValues('offerId') || undefined;

      if (draftVideoId) {
        // Draft already exists (user went back) — update serviceId + offerId
        try {
          await updateVideoAsync({
            id: draftVideoId,
            serviceId: serviceId || null,
            offerId: offerId || null,
          });
        } catch {
          // Non-critical
        }
        // Re-trigger script generation with the (possibly changed) service
        startScriptGeneration(serviceId);
        return true;
      }

      try {
        const videoTitle = `Video ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

        const minimalDraftConfig: VideoDraftConfig = {
          scriptText: '',
          narrationType: narrationMode,
          bRollClips: [],
          captions: {
            enabled: true,
            position: videoDefaults?.captionPosition ?? 'bottom',
            fontFamily: videoDefaults?.captionFont
              ? mapFontFamilyToCaptionFont(videoDefaults.captionFont)
              : 'inter',
            textColor: videoDefaults?.captionColor ?? '#FFFFFF',
            backgroundColor: '#000000',
            ...CAPTION_DEFAULTS,
          },
          musicVolume: videoDefaults?.musicVolume ?? 0.05,
          outro: {
            businessName: organizationName || 'Business',
            backgroundColor: '#000000',
            ...OUTRO_DEFAULTS,
          },
          orientation: isOffer ? 'square' : 'portrait',
        };

        const video = await createVideoAsync({
          title: videoTitle,
          templateId,
          variationId: selectedVariation?.id,
          serviceId,
          offerId,
          draftConfig: minimalDraftConfig,
        });

        setDraftVideoId(video.id);
        // Start script generation with the selected service
        startScriptGeneration(serviceId);
        return true;
      } catch (error) {
        logError('video.createDraft', error, { extra: { templateId } });
        toast.error('Failed to save. Please try again.');
        return false;
      }
    },
    [
      draftVideoId,
      updateVideoAsync,
      createVideoAsync,
      organizationName,
      templateId,
      selectedVariation?.id,
      setDraftVideoId,
      narrationMode,
      startScriptGeneration,
      isOffer,
      videoDefaults,
    ]
  );

  /**
   * Called when the user clicks "Continue" on the script step.
   * Saves the script and narration settings to the existing draft.
   */
  const handleScriptBeforeContinue = useCallback(
    async (
      form: import('react-hook-form').UseFormReturn<VideoFormData>
    ): Promise<boolean> => {
      if (draftVideoId) {
        const currentNarrationType = form.getValues('narrationType');
        const isAi = currentNarrationType === 'ai_voiceover';
        const isTextOnly = currentNarrationType === 'text_only';
        try {
          await updateVideoAsync({
            id: draftVideoId,
            draftConfig: {
              scriptText: form.getValues('scriptText'),
              narrationType: currentNarrationType,
              // Send null for fields that should be cleared when switching narration type
              aiVoiceId: isAi ? form.getValues('aiVoiceId') : null,
              talkingHeadUrl:
                isAi || isTextOnly ? null : talkingHeadUrl || undefined,
              // Save text frames for text_only mode
              textFrames: isTextOnly ? form.getValues('textFrames') : undefined,
            },
          });
        } catch {
          // Non-critical — auto-save will catch up
        }
      }
      return true;
    },
    [draftVideoId, updateVideoAsync, talkingHeadUrl]
  );

  /**
   * Called when the user clicks "Continue" on the caption review step.
   * Saves the edited caption text to the draft config.
   */
  const handleCaptionReviewBeforeContinue = useCallback(
    async (
      form: import('react-hook-form').UseFormReturn<VideoFormData>
    ): Promise<boolean> => {
      if (draftVideoId) {
        try {
          await updateVideoAsync({
            id: draftVideoId,
            draftConfig: {
              editedCaptionText: form.getValues('editedCaptionText') || null,
            },
          });
        } catch {
          // Non-critical — auto-save will catch up
        }
      }
      return true;
    },
    [draftVideoId, updateVideoAsync]
  );

  // Steps definition — offer and educational templates skip script step
  const steps: StepConfig<VideoFormData>[] = useMemo(() => {
    const baseSteps: StepConfig<VideoFormData>[] = [
      {
        id: 'service',
        schema: serviceStepSchema,
        component: (
          form: import('react-hook-form').UseFormReturn<VideoFormData>
        ) => <ServiceStep form={form} />,
        onBeforeContinue: handleServiceBeforeContinue,
        processingButtonText: 'Saving...',
      },
    ];

    if (isOffer) {
      baseSteps.push({
        id: 'offer',
        schema: offerStepSchema,
        component: (
          form: import('react-hook-form').UseFormReturn<VideoFormData>
        ) => <OfferStep form={form} />,
      });
    } else if (!isEducational && !isBeforeAfter) {
      // Educational and before-after templates skip the script step — they use text_only with
      // AI-generated text frames and music, so no script editing or narration mode needed
      baseSteps.push({
        id: 'script',
        schema: scriptStepSchema,
        component: (
          form: import('react-hook-form').UseFormReturn<VideoFormData>
        ) => <ScriptStep form={form} />,
        onBeforeContinue: handleScriptBeforeContinue,
        processingButtonText: 'Saving...',
      });
    }

    // Only show caption review for recorded narration with a talking head
    if (
      !isOffer &&
      !isEducational &&
      !isBeforeAfter &&
      narrationMode === 'recorded' &&
      talkingHeadUrl
    ) {
      baseSteps.push({
        id: 'caption-review',
        schema: captionReviewStepSchema,
        component: (
          form: import('react-hook-form').UseFormReturn<VideoFormData>
        ) => <CaptionReviewStep form={form} />,
        onBeforeContinue: handleCaptionReviewBeforeContinue,
        processingButtonText: 'Saving...',
      });
    }

    // Dynamic media selection steps (one per slot)
    for (const slot of slotConfigs) {
      baseSteps.push({
        id: `media-${slot.order ?? slot.type}`,
        schema: createMediaStepSchema(slot, {
          allowStockFootageBypassesRequired: !isBeforeAfter,
        }),
        component: (
          form: import('react-hook-form').UseFormReturn<VideoFormData>
        ) => <MediaSelectionStep form={form} slot={slot} />,
      });
    }

    // Final customization step (music + captions only)
    baseSteps.push({
      id: 'customization',
      schema: customizationOnlyStepSchema,
      component: (
        form: import('react-hook-form').UseFormReturn<VideoFormData>
      ) => <CustomiseStep form={form} />,
    });

    return baseSteps;
  }, [
    handleServiceBeforeContinue,
    handleScriptBeforeContinue,
    handleCaptionReviewBeforeContinue,
    isOffer,
    isEducational,
    isBeforeAfter,
    narrationMode,
    talkingHeadUrl,
    slotConfigs,
  ]);

  // Determine if user can continue based on current step
  const canContinue = (() => {
    const currentStep = steps[currentStepIndex];
    // On the script step with recorded narration, require video upload
    // AI voiceover and text_only modes don't need a talking head
    if (currentStep?.id === 'script' && narrationMode === 'recorded') {
      return !!talkingHeadUrl && !isUploading;
    }
    return true;
  })();

  const handleSubmit = async (data: VideoFormData) => {
    try {
      setIsProcessing(true);

      // Auto-generate title if not provided
      const videoTitle =
        data.title?.trim() ||
        `Video ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

      const effectiveNarrationType =
        isOffer || isEducational || isBeforeAfter
          ? 'text_only'
          : data.narrationType;
      const isAiVoiceover = effectiveNarrationType === 'ai_voiceover';
      const isTextOnly = effectiveNarrationType === 'text_only';

      // For educational and before-after templates, use the AI-generated script (the script step was skipped)
      const effectiveScriptText =
        isEducational || isBeforeAfter
          ? generatedScript || ''
          : data.scriptText;

      // Mint explicitly picked stock clips into org assets and append them
      // after uploaded b-roll. Hand-picking remains opt-in via the toggle.
      const uploadedBRollClips = buildBRollClips(data.clips, slotConfigs);
      let stockBRollClips: typeof uploadedBRollClips = [];
      if (data.allowStockFootage && data.stockClipIds.length > 0) {
        const minted = await mintStockClips(data.stockClipIds);
        stockBRollClips = data.stockClipIds
          .map((id) => minted[id])
          .filter((assetId): assetId is string => !!assetId)
          .map((assetId, i) => ({
            assetId,
            url: '',
            order: 10_000 + i,
            clipType: 'bRoll' as const,
          }));
      }
      const finalBRollClips = [...uploadedBRollClips, ...stockBRollClips];

      // Build the full VideoDraftConfig from form data + brand settings
      // Use null (not undefined) to explicitly clear fields during deep merge
      const draftConfig: VideoDraftConfig = {
        // Narration settings
        narrationType: effectiveNarrationType,
        aiVoiceId: isAiVoiceover ? data.aiVoiceId : null,

        // User-edited script (or AI-generated for educational)
        scriptText: effectiveScriptText,

        // Talking head source (null clears stale value when switching to AI voiceover or text_only)
        talkingHeadUrl:
          isAiVoiceover || isTextOnly || !data.talkingHeadUrl
            ? null
            : data.talkingHeadUrl,

        // Text frames for text_only narration mode
        // Educational/before-after: auto-parse scriptText into styled text frames
        // Other text_only: use user-provided frames from form
        textFrames:
          isEducational || isBeforeAfter
            ? parseScriptToTextFrames(effectiveScriptText)
            : isTextOnly && !isOffer
              ? data.textFrames
              : undefined,

        // Offer card overlay for offer templates
        offerCard: isOffer
          ? {
              serviceName: data.offerHeadline || '',
              headline: data.offerHeadline || '',
              bulletPoints: data.bulletPoints?.filter(Boolean),
              ctaText: data.ctaText || 'Book now',
              urgencyText: data.urgencyText || undefined,
              audienceText: data.audienceText || undefined,
              logoUrl: brand?.logoUrl || undefined,
              businessName: organizationName || undefined,
              primaryColor: brand?.primaryColor || '#007AFF',
              secondaryColor: brand?.secondaryColor || '#FFFFFF',
            }
          : undefined,

        // B-roll clips from slot-based selection + any minted stock clips
        // (with clipType for ordering)
        bRollClips: finalBRollClips,

        // Caption settings from form + brand
        captions: {
          enabled: data.captionsEnabled,
          position: data.position,
          fontFamily: data.fontFamily,
          textColor: data.textColor,
          backgroundColor: data.backgroundColor,
          ...CAPTION_DEFAULTS,
        },

        // Music settings
        musicTrackId: data.musicTrackId,
        musicUrl: data.musicUrl,
        musicVolume: data.musicVolume,

        // Outro overlay from brand settings
        outro: {
          logoUrl: brand?.logoUrl || undefined,
          businessName: organizationName || 'Your Business',
          backgroundColor: brand?.primaryColor || '#000000',
          outroStyle: data.outroStyle || undefined,
          ...OUTRO_DEFAULTS,
        },

        // User-edited caption text (overrides Whisper during render)
        editedCaptionText: data.editedCaptionText || null,

        // Square for offer templates, portrait for everything else
        orientation: isOffer ? 'square' : 'portrait',
      };

      // Safety net: auto-fill from stock at render time whenever the final
      // b-roll list is empty. The toggle only controls whether users browse
      // and hand-pick specific stock clips in the form.
      const allowStockFootage =
        data.allowStockFootage || finalBRollClips.length === 0;

      if (draftVideoId) {
        // Draft already exists — update it with the full config
        await updateVideoAsync({
          id: draftVideoId,
          title: videoTitle,
          serviceId: data.serviceId || null,
          offerId: data.offerId || null,
          draftConfig,
        });
        setVideoId(draftVideoId);
        await queueExportAsync({ videoId: draftVideoId, allowStockFootage });
      } else {
        // Fallback: create + export (shouldn't happen in normal flow)
        const video = await createVideoAsync({
          title: videoTitle,
          templateId,
          variationId: selectedVariation?.id,
          serviceId: data.serviceId || undefined,
          offerId: data.offerId || undefined,
          draftConfig,
        });
        setVideoId(video.id);
        await queueExportAsync({ videoId: video.id, allowStockFootage });
      }
    } catch (error) {
      logError('video.create', error, { extra: { templateId } });
      toast.error('Failed to create video. Please try again.');
      setIsProcessing(false);
    }
  };

  const handleProcessingClose = () => {
    setIsProcessing(false);
    setVideoId(null);
  };

  const handleVideoReady = async () => {
    toast.success('Video created successfully!');
    if (adsReturnContext?.campaignId && videoId) {
      await queryClient.invalidateQueries({ queryKey: ['videos'] });
      await queryClient.invalidateQueries({ queryKey: ['video', videoId] });
      void navigate({
        to: ROUTES.adsNew,
        search: { campaignId: adsReturnContext.campaignId, videoId },
        replace: true,
      });
      return;
    }
    void navigate({ to: routes.contentGallery });
  };

  const handleStepChange = (stepIndex: number, stepId: string) => {
    setCurrentStepIndex(stepIndex);
    onStepChange?.(stepIndex, stepId);
    onMobileStepIndexChange?.(stepIndex);
  };

  return (
    <>
      <MultiStepForm
        steps={steps}
        defaultValues={brandedDefaults}
        fullSchema={videoFormSchema as z.ZodSchema<VideoFormData>}
        onSubmit={handleSubmit}
        onStepChange={handleStepChange}
        submitButtonText={isCreating ? 'Creating...' : 'Create Video'}
        continueButtonText="Continue"
        canContinue={canContinue}
        layout={layout}
        registerGoBack={
          layout === 'mobile' && !isProcessing ? registerGoBack : undefined
        }
      />

      <ProcessingModal
        open={isProcessing}
        onClose={handleProcessingClose}
        videoId={videoId}
        onVideoReady={() => void handleVideoReady()}
        autoContinueOnReady={Boolean(adsReturnContext?.campaignId)}
        readyActionLabel={
          adsReturnContext ? 'Continue to ad' : 'View in Library'
        }
      />
    </>
  );
}
