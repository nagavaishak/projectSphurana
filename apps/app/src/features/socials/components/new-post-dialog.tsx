import {
  type AiVoiceId,
  type AssetContentTypeTag,
  aiVoiceIdValues,
  assetContentTypeTagLabels,
} from '@borradh-workspace/api-client/types';
import {
  type TemplateClipGuidance,
  getTemplateById,
} from '@borradh-workspace/features/videos/templates';
import { useRuntimeConfig } from '@borradh-workspace/runtime-config/client';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  Check,
  CheckCircle2Icon,
  ChevronsUpDown,
  ImageIcon,
  Loader2,
  MonitorIcon,
  Play,
  Plus,
  SearchIcon,
  Sparkles,
  Trash2,
  UploadIcon,
  VideoIcon,
  XIcon,
} from 'lucide-react';
import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';

import { QRCode } from '@/components/kibo-ui/qr-code';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StepDots } from '@/components/ui/step-dots';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  type GeneratedOfferCopy,
  useGenerateOfferCopy,
} from '@/features/ai-content';
import {
  type Asset,
  useListAssets,
  useListAssetsByService,
} from '@/features/assets';
import {
  buildUploadedVideoLibrary,
  filterUploadedVideoLibrary,
} from '@/features/assets/lib/uploaded-video-library';
import {
  generateGraphicForm,
  pickRandomGraphicCategory,
  useGenerateGraphic,
} from '@/features/graphics/api/generate-graphic';
import { useListGraphicTemplates } from '@/features/graphics/api/list-graphic-templates';
import { useListOffers } from '@/features/offers';
import {
  useGetActiveOrganization,
  useGetOrganizationBrand,
} from '@/features/organization';
import { useListServices } from '@/features/organization-services';
import { useUploadVideo } from '@/features/upload/api';
import { useCreateVideo } from '@/features/videos/api/create-video';
import { useDeleteVideo } from '@/features/videos/api/delete-video';
import {
  type GeneratedOrganicCopy,
  type OrganicVariationId,
  useGenerateOrganicCopy,
} from '@/features/videos/api/generate-organic-copy';
import { useGenerateVideoScript } from '@/features/videos/api/generate-video-script';
import { useGetVideo } from '@/features/videos/api/get-video';
import { useQueueVideoExport } from '@/features/videos/api/queue-video-export';
import type { VideoDraftConfig } from '@/features/videos/api/types';
import { useUpdateVideo } from '@/features/videos/api/update-video';
import { useIsMobile } from '@/hooks/use-mobile';
import { graphicTemplateIcon } from '@/lib/graphic-template-icons';
import { useResolvedRoutes } from '@/lib/use-routes';
import { cn } from '@/lib/utils';
import { webAppUrl } from '@/lib/web-app-origin';
import { ProcessingModal } from '@/routes/_authed/create-video/$templateId/-components/shared/processing-modal';
import { VideoThumbnail } from '@/routes/_authed/create-video/$templateId/-components/shared/video-thumbnail';

import { GraphicProcessingModal } from './graphic-processing-modal';
import {
  VIDEO_TEMPLATE_FILTERS,
  VIDEO_TEMPLATE_FILTER_LABELS,
  type VideoTemplateFilter,
  type VideoTemplateItem,
  filterVideoTemplates,
} from './video-templates';

// ── Template catalogue ──────────────────────────────────────────────────
// Sourced from the shared catalogue (./video-templates) so the mobile
// create-content funnel and this dialog can never fall out of sync.

type PostType = 'video' | 'graphic';
type VideoFilter = VideoTemplateFilter;
/** UI choices on the voiceover step. */
type VoiceoverMode = 'ai_voiceover' | 'record' | 'text_only';

const FILTER_LABELS = VIDEO_TEMPLATE_FILTER_LABELS;
const FILTERS = VIDEO_TEMPLATE_FILTERS;

const DEFAULT_AI_VOICE: AiVoiceId = aiVoiceIdValues[0];

/** Templates that expose the voiceover step. Authority is talking-head, so it
 * offers Record; Educational is on-screen text, so it offers Text Only. */
const TEMPLATES_WITH_VOICEOVER = new Set(['authority', 'educational']);

interface SlotState {
  /** clipGuidance.order — also the key in clips.templateSlots */
  order: number;
  label: string;
  filterTag?: string;
  recommendedCount: number;
  maxCount: number;
}

const BASE_CAPTIONS = {
  enabled: true,
  position: 'bottom' as const,
  fontFamily: 'inter',
  fontSize: 64,
  textColor: '#FFFFFF',
  highlightColor: '#FFFFFF',
  backgroundColor: '#000000',
  showBackground: false,
};

// Everything the review modal needs to re-roll the just-generated video with a
// change request. Captured at generation time because the dialog state resets
// when it closes on success.
type VideoRegenContext = {
  videoId: string;
  serviceId: string;
  templateId: string;
  variationId?: string;
  isOrganic: boolean;
  isOffer: boolean;
  narrationMode?: VideoDraftConfig['narrationType'];
  draftConfig: VideoDraftConfig;
  priorOrganicCopy?: GeneratedOrganicCopy;
  priorScriptText?: string;
  offerId?: string;
  priorOfferCopy?: GeneratedOfferCopy;
  allowStockFootage: boolean;
};

/** The one declaration of the graphic form's fields — labels, defaults, controls. */
const GRAPHIC = generateGraphicForm.labels;
const GRAPHIC_DEFAULTS = generateGraphicForm.defaults;

// ── Step model ────────────────────────────────────────────────────────────

type StepId = 'type' | 'service' | 'offerCopy' | 'voiceover' | 'footage';

export interface NewPostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewPostDialog({ open, onOpenChange }: NewPostDialogProps) {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();
  const queryClient = useQueryClient();
  const { cdnUrl, apiUrl } = useRuntimeConfig();
  // On phones the wizard takes over the whole screen, one full-height step at a
  // time, instead of a centred modal — same flow, mobile-native presentation.
  const isMobile = useIsMobile();

  // ── Wizard state ──────────────────────────────────────────────────────
  const [stepIndex, setStepIndex] = useState(0);
  // Drives the slide direction of the step transition animation.
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [postType, setPostType] = useState<PostType | null>(null);
  const [filter, setFilter] = useState<VideoFilter>('all');
  const [templateId, setTemplateId] = useState<string | null>(null);

  const [serviceId, setServiceId] = useState<string | null>(null);
  const [offerId, setOfferId] = useState<string | null>(null);

  // Graphic-path choices (on the service step): organic post vs paid offer ad,
  // and whether AI may fill image gaps. Paid ads require an offer.
  const [graphicUsageType, setGraphicUsageType] = useState<'organic' | 'ad'>(
    GRAPHIC_DEFAULTS.usageType
  );
  // Curated graphic style pinned on the type step (null = "Surprise me").
  const [graphicTemplateSlug, setGraphicTemplateSlug] = useState<string | null>(
    null
  );
  // Organic graphics can be a single image or a multi-slide carousel; paid ads
  // are always a single image.
  const [graphicKind, setGraphicKind] = useState<'single' | 'carousel'>(
    GRAPHIC_DEFAULTS.kind
  );
  const [graphicAllowAi, setGraphicAllowAi] = useState(
    GRAPHIC_DEFAULTS.allowAiImages
  );
  // Opt into curated stock photos for graphic slots with no matching service
  // media (default on; behaviour unchanged unless turned off).
  const [allowStockImages, setAllowStockImages] = useState(
    GRAPHIC_DEFAULTS.allowStockImages
  );

  // Optional free-text instruction the user can give to steer the AI copy /
  // graphic before it's generated. Threaded into the generate call.
  const [instruction, setInstruction] = useState(
    GRAPHIC_DEFAULTS.refinementInstruction ?? ''
  );
  // Same idea for the spoken-script path: a prompt to re-roll the script with.
  const [scriptInstruction, setScriptInstruction] = useState('');
  // Organic posts ship with no outro by default; the user can toggle a
  // branded outro on the footage step.
  const [organicOutroEnabled, setOrganicOutroEnabled] = useState(false);
  // Opt into curated stock b-roll when the service has no uploaded footage
  // (default on; before/after videos are excluded server-side).
  const [allowStockFootage, setAllowStockFootage] = useState(true);

  const [voiceoverMode, setVoiceoverMode] =
    useState<VoiceoverMode>('ai_voiceover');
  const [script, setScript] = useState('');
  const [scriptTouched, setScriptTouched] = useState(false);

  // Record-voiceover sub-state
  const [draftVideoId, setDraftVideoId] = useState<string | null>(null);
  const [talkingHeadUrl, setTalkingHeadUrl] = useState<string | null>(null);
  const [isUploadingHead, setIsUploadingHead] = useState(false);
  const [headUploadProgress, setHeadUploadProgress] = useState(0);
  const creatingDraftRef = useRef(false);

  const [selectionsByOrder, setSelectionsByOrder] = useState<
    Record<number, string[]>
  >({});
  const [activeOrder, setActiveOrder] = useState<number | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [processingVideoId, setProcessingVideoId] = useState<string | null>(
    null
  );
  const [pollingGraphicId, setPollingGraphicId] = useState<string | null>(null);
  const [isRegeneratingVideo, setIsRegeneratingVideo] = useState(false);
  // Bumped after a video re-roll is queued so the processing modal resumes
  // polling the same video id.
  const [videoRegenTick, setVideoRegenTick] = useState(0);
  // Context for re-rolling the last video (survives the dialog state reset
  // that runs when the dialog closes on success).
  const lastVideoGenRef = useRef<VideoRegenContext | null>(null);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  // Once a video/graphic is queued we must NOT delete the draft on close.
  const finalizedRef = useRef(false);

  // Editable AI-generated offer copy. Populated (pre-filled) once generation
  // finishes on the 'offerCopy' step; the user can then tweak
  // headline/bullets/CTA/urgency/audience before submit — the edited values
  // (not the raw AI output) are what gets baked into draftConfig.offerCard.
  const [offerCopy, setOfferCopy] = useState<GeneratedOfferCopy | null>(null);
  const [offerCopyTouched, setOfferCopyTouched] = useState(false);
  const lastOfferIdRef = useRef<string | null>(null);

  // ── Derived template info ───────────────────────────────────────────────
  const template = useMemo(
    () => (templateId ? (getTemplateById(templateId) ?? null) : null),
    [templateId]
  );
  const variation = template?.variations[0] ?? null;
  const isOffer = templateId === 'offer';
  const isOrganic = template?.usageType === 'organic';
  const hasVoiceoverStep =
    postType === 'video' &&
    !!templateId &&
    TEMPLATES_WITH_VOICEOVER.has(templateId);
  const allowsRecord = templateId === 'authority';

  const slots = useMemo<SlotState[]>(() => {
    const guidance: TemplateClipGuidance[] = variation?.clipGuidance ?? [];
    return [...guidance]
      .sort((a, b) => a.order - b.order)
      .map((g) => ({
        order: g.order,
        label: g.label,
        filterTag: g.filterTag,
        recommendedCount: variation?.recommendedClipCount ?? 1,
        maxCount: variation?.maxBRollClips ?? 5,
      }));
  }, [variation]);

  // ── Data ────────────────────────────────────────────────────────────────
  const { data: activeOrg } = useGetActiveOrganization();
  const { brand } = useGetOrganizationBrand(activeOrg?.id ?? '');
  const organizationName = activeOrg?.name ?? null;

  const { services, isLoading: isServicesLoading } = useListServices({
    limit: 100,
  });
  const { offers, isLoading: isOffersLoading } = useListOffers({
    state: 'active',
  });

  // ── Mutations ─────────────────────────────────────────────────────────
  const { createVideoAsync } = useCreateVideo();
  const { updateVideoAsync } = useUpdateVideo({ silent: true });
  const { deleteVideoAsync } = useDeleteVideo();
  const { queueExportAsync } = useQueueVideoExport();
  const { generateOfferCopyAsync, isGenerating: isGeneratingOfferCopy } =
    useGenerateOfferCopy();
  const { generateScriptAsync, isGenerating: isGeneratingScript } =
    useGenerateVideoScript();
  const { generateCopyAsync } = useGenerateOrganicCopy();
  const { generateGraphicAsync } = useGenerateGraphic({
    onSuccess: (g) => {
      finalizedRef.current = true;
      // Don't close the parent here: the sidebar Quick Create mount renders
      // this dialog conditionally, so onOpenChange(false) would unmount the
      // whole component — including the GraphicProcessingModal that is about
      // to open. `formIsActive` already hides the form while polling.
      setPollingGraphicId(g.id);
    },
  });
  const { upload: uploadTalkingHead } = useUploadVideo({
    onProgress: setHeadUploadProgress,
    onSuccess: (result) => {
      setTalkingHeadUrl(result.url);
      setIsUploadingHead(false);
      setHeadUploadProgress(0);
    },
    onError: () => {
      setIsUploadingHead(false);
      setHeadUploadProgress(0);
    },
  });

  // ── Reset on close ──────────────────────────────────────────────────────
  const reset = () => {
    setStepIndex(0);
    setPostType(null);
    setFilter('all');
    setTemplateId(null);
    setServiceId(null);
    setOfferId(null);
    setGraphicUsageType(GRAPHIC_DEFAULTS.usageType);
    setGraphicKind(GRAPHIC_DEFAULTS.kind);
    setGraphicTemplateSlug(null);
    setGraphicAllowAi(GRAPHIC_DEFAULTS.allowAiImages);
    setAllowStockImages(GRAPHIC_DEFAULTS.allowStockImages);
    setAllowStockFootage(true);
    setInstruction(GRAPHIC_DEFAULTS.refinementInstruction ?? '');
    setScriptInstruction('');
    setVoiceoverMode('ai_voiceover');
    setScript('');
    setScriptTouched(false);
    setDraftVideoId(null);
    setTalkingHeadUrl(null);
    setIsUploadingHead(false);
    setHeadUploadProgress(0);
    creatingDraftRef.current = false;
    setSelectionsByOrder({});
    setActiveOrder(null);
    setIsSubmitting(false);
    setConfirmDiscardOpen(false);
    finalizedRef.current = false;
    setOfferCopy(null);
    setOfferCopyTouched(false);
    lastOfferIdRef.current = null;
  };

  // The user has begun the wizard — closing now should be confirmed and any
  // record-draft cleaned up.
  const hasProgress = postType !== null;

  // Actually tear down the wizard: delete an abandoned record-draft, reset, close.
  const performClose = () => {
    if (draftVideoId && !finalizedRef.current) {
      void deleteVideoAsync(draftVideoId).catch(() => {
        // Best-effort cleanup — the draft is unlisted anyway.
      });
    }
    reset();
    onOpenChange(false);
  };

  // Intercept every close attempt (X, Escape, outside click). Confirm first if
  // there's progress to lose; once a render is queued, close freely.
  const requestClose = () => {
    if (isSubmitting) return;
    if (hasProgress && !finalizedRef.current) {
      setConfirmDiscardOpen(true);
      return;
    }
    performClose();
  };

  const handleOpenChange = (next: boolean) => {
    if (next) {
      onOpenChange(true);
      return;
    }
    requestClose();
  };

  // Warn before a refresh / tab close while there's unsaved progress, and — if
  // they leave anyway — best-effort delete the abandoned record-draft with a
  // keepalive request that survives the unload (an awaited mutation would be
  // killed mid-flight).
  const formIsActive = open && !processingVideoId && !pollingGraphicId;
  useEffect(() => {
    if (!formIsActive || !hasProgress || finalizedRef.current) return;

    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const cleanup = () => {
      if (!draftVideoId || finalizedRef.current) return;
      const base = (apiUrl ?? '').replace(/\/$/, '');
      void fetch(`${base}/videos/${draftVideoId}`, {
        method: 'DELETE',
        credentials: 'include',
        keepalive: true,
      }).catch(() => {});
    };

    window.addEventListener('beforeunload', warn);
    window.addEventListener('pagehide', cleanup);
    return () => {
      window.removeEventListener('beforeunload', warn);
      window.removeEventListener('pagehide', cleanup);
    };
  }, [formIsActive, hasProgress, draftVideoId, apiUrl]);

  // Default the footage tab to the first slot once slots exist.
  useEffect(() => {
    if (slots.length > 0 && activeOrder === null)
      setActiveOrder(slots[0].order);
  }, [slots, activeOrder]);

  // Reset the voiceover default whenever the template changes. Also discard any
  // record-draft created for a previous template so we don't save a video under
  // the wrong templateId.
  // biome-ignore lint/correctness/useExhaustiveDependencies: templateId is the intended trigger
  useEffect(() => {
    setVoiceoverMode('ai_voiceover');
    setScriptTouched(false);
    setScript('');
    setScriptInstruction('');
    setDraftVideoId(null);
    setTalkingHeadUrl(null);
    creatingDraftRef.current = false;
  }, [templateId]);

  // ── Auto-generate the spoken script (AI voiceover OR record) ────────────
  useEffect(() => {
    if (!open || scriptTouched || !serviceId || !variation?.id) return;
    if (voiceoverMode === 'text_only') return;
    if (!hasVoiceoverStep) return;
    let cancelled = false;
    void generateScriptAsync({
      templateId: templateId as string,
      variationId: variation.id,
      serviceId,
      narrationMode: 'ai_voiceover',
    })
      .then((res) => {
        if (!cancelled) setScript(res.scriptText ?? '');
      })
      .catch((error: Error) => {
        if (!cancelled)
          toast.error(`Couldn't generate script: ${error.message}`);
      });
    return () => {
      cancelled = true;
    };
  }, [
    open,
    scriptTouched,
    serviceId,
    variation,
    voiceoverMode,
    hasVoiceoverStep,
    templateId,
    generateScriptAsync,
  ]);

  // ── Auto-generate offer copy when an offer is picked ────────────────────
  // Re-generates whenever the offer changes, unless the user has already
  // started editing the copy for that offer. `lastOfferIdRef` detects an
  // actual offer change (vs. a re-render) so we know when to drop the
  // touched-flag and fetch fresh copy for the new offer.
  useEffect(() => {
    if (!isOffer || !offerId) {
      setOfferCopy(null);
      setOfferCopyTouched(false);
      lastOfferIdRef.current = null;
      return;
    }
    const offerChanged = lastOfferIdRef.current !== offerId;
    lastOfferIdRef.current = offerId;
    if (offerChanged) setOfferCopyTouched(false);
    if (offerCopyTouched && !offerChanged) return;
    let cancelled = false;
    void generateOfferCopyAsync({ offerId })
      .then((copy) => {
        if (!cancelled) setOfferCopy(copy);
      })
      .catch(() => {
        // Backend always falls back; ignore.
      });
    return () => {
      cancelled = true;
    };
  }, [isOffer, offerId, offerCopyTouched, generateOfferCopyAsync]);

  // ── Record path: create a draft video to record into + poll for upload ──
  const ensureDraftVideo = async () => {
    if (draftVideoId || creatingDraftRef.current || !template || !serviceId) {
      return;
    }
    creatingDraftRef.current = true;
    try {
      const video = await createVideoAsync({
        title: template.title,
        templateId: templateId as string,
        variationId: variation?.id,
        serviceId,
        offerId: offerId ?? undefined,
        draftConfig: {
          narrationType: 'recorded',
          scriptText: script,
          talkingHeadUrl: null,
          bRollClips: [],
          captions: BASE_CAPTIONS,
          musicVolume: 0.05,
          orientation: 'portrait',
        },
        usageType: 'ad',
      });
      setDraftVideoId(video.id);
    } catch (error) {
      creatingDraftRef.current = false;
      const message = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Couldn't start the recording draft: ${message}`);
    }
  };

  const handleSelectVoiceoverMode = (mode: VoiceoverMode) => {
    setVoiceoverMode(mode);
    if (mode === 'record') void ensureDraftVideo();
  };

  // Poll the draft for a talkingHeadUrl set by the /record tab.
  const shouldPollHead =
    voiceoverMode === 'record' &&
    !!draftVideoId &&
    !talkingHeadUrl &&
    !isUploadingHead;
  const { video: draftVideo } = useGetVideo(draftVideoId ?? '', {
    enabled: shouldPollHead,
    refetchInterval: shouldPollHead ? 2000 : false,
  });
  useEffect(() => {
    if (!draftVideo?.draftConfig || talkingHeadUrl) return;
    const config = draftVideo.draftConfig as Record<string, unknown>;
    const url = config.talkingHeadUrl;
    if (typeof url === 'string' && url) setTalkingHeadUrl(url);
  }, [draftVideo, talkingHeadUrl]);

  // Keep the teleprompter script in sync with edits (debounced) while recording.
  useEffect(() => {
    if (voiceoverMode !== 'record' || !draftVideoId) return;
    const t = setTimeout(() => {
      void updateVideoAsync({
        id: draftVideoId,
        draftConfig: {
          narrationType: 'recorded',
          scriptText: script,
          talkingHeadUrl,
          bRollClips: [],
          captions: BASE_CAPTIONS,
          orientation: 'portrait',
        },
      }).catch(() => {
        // Silent — teleprompter sync is best-effort.
      });
    }, 800);
    return () => clearTimeout(t);
  }, [script, voiceoverMode, draftVideoId, talkingHeadUrl, updateVideoAsync]);

  const handleHeadFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingHead(true);
    uploadTalkingHead(file);
  };

  // ── Steps ─────────────────────────────────────────────────────────────
  const steps = useMemo<StepId[]>(() => {
    if (postType === 'graphic') return ['type', 'service'];
    if (postType === 'video') {
      const list: StepId[] = ['type', 'service'];
      // Offer videos get a dedicated step to review/edit the AI-generated
      // on-screen copy (headline, bullets, CTA, urgency, audience) before the
      // video renders — there's no other point in the flow where the user
      // ever sees this text.
      if (isOffer) list.push('offerCopy');
      if (hasVoiceoverStep) list.push('voiceover');
      list.push('footage');
      return list;
    }
    return ['type'];
  }, [postType, hasVoiceoverStep, isOffer]);

  const currentStep = steps[stepIndex] ?? 'type';
  const isLastStep = stepIndex === steps.length - 1;

  // ── Per-step validity ───────────────────────────────────────────────────
  const sortedOffers = useMemo(() => {
    if (!offers.length) return [];
    return [...offers].sort((a, b) => {
      const aLinked = serviceId ? a.serviceIds.includes(serviceId) : false;
      const bLinked = serviceId ? b.serviceIds.includes(serviceId) : false;
      if (aLinked && !bLinked) return -1;
      if (!aLinked && bLinked) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [offers, serviceId]);

  const totalSelectedClips = useMemo(
    () => Object.values(selectionsByOrder).reduce((n, a) => n + a.length, 0),
    [selectionsByOrder]
  );

  // Graphics use the service's own uploaded media unless AI images are on, so
  // with AI off only services that have media are selectable on the graphic
  // path; with AI on, any service can be used.
  // Show EVERY service in the picker — not just the ones with uploaded media.
  // A service without photos can still be turned into a graphic using AI, so
  // hiding those left orgs with many services seeing "only a couple". Media-less
  // services get an "AI" hint and auto-enable AI on selection (see below).
  const serviceItems = useMemo(
    () =>
      services.map((s) => ({
        id: s.id,
        name: s.name,
        code: postType === 'graphic' && !s.hasGraphicMedia ? 'AI' : undefined,
      })),
    [services, postType]
  );

  // A graphic for a service with no uploaded media can only be AI-generated, so
  // flip AI on automatically when such a service is picked — otherwise the user
  // selects a service and generation has nothing to work with.
  const handleServiceChange = (id: string) => {
    setServiceId(id);
    if (postType === 'graphic' && !graphicAllowAi) {
      const svc = services.find((s) => s.id === id);
      if (svc && !svc.hasGraphicMedia) {
        setGraphicAllowAi(true);
        toast.info(
          'No photos uploaded for this service yet — using AI images.'
        );
      }
    }
  };

  // Belt-and-suspenders: never send a graphic request that can't render. If the
  // chosen service has no media, AI is required regardless of the toggle state.
  const selectedServiceHasMedia = serviceId
    ? (services.find((s) => s.id === serviceId)?.hasGraphicMedia ?? true)
    : true;
  const effectiveAllowAiImages = graphicAllowAi || !selectedServiceHasMedia;

  const canContinue = (() => {
    if (isSubmitting) return false;
    switch (currentStep) {
      case 'type':
        return postType === 'graphic' || (postType === 'video' && !!templateId);
      case 'service': {
        if (!serviceId) return false;
        if (postType === 'graphic') {
          // Paid ad graphics require an offer; organic graphics don't.
          return graphicUsageType === 'organic' || !!offerId;
        }
        return !isOffer || !!offerId;
      }
      case 'offerCopy':
        // Headline, CTA, and every bullet point must be filled in — matches
        // the backend's generate-offer-copy validation (headline/ctaText
        // required, each bullet non-empty) so an edit that blanks a required
        // field can't produce a broken card.
        return (
          !!offerCopy &&
          offerCopy.headline.trim().length > 0 &&
          offerCopy.ctaText.trim().length > 0 &&
          offerCopy.bulletPoints.every((p) => p.trim().length > 0)
        );
      case 'voiceover': {
        if (voiceoverMode === 'text_only') return true;
        if (voiceoverMode === 'record') return !!talkingHeadUrl;
        return script.trim().length > 0;
      }
      case 'footage':
        // Slots auto-select recommended clips; only block if there are slots
        // but the user has cleared every selection and did not opt into stock.
        // Before/after videos still require uploaded before/after media.
        return (
          slots.length === 0 ||
          totalSelectedClips > 0 ||
          (templateId !== 'before-after' && allowStockFootage)
        );
      default:
        return false;
    }
  })();

  // Re-roll the spoken script applying the user's instruction to the current
  // script (refinement-aware), so they can prompt changes instead of only
  // editing the text by hand.
  const handleRegenerateScript = async () => {
    if (!serviceId || !variation?.id) return;
    try {
      const res = await generateScriptAsync({
        templateId: templateId as string,
        variationId: variation.id,
        serviceId,
        narrationMode: voiceoverMode === 'record' ? 'recorded' : 'ai_voiceover',
        refinementInstruction: scriptInstruction.trim() || undefined,
        priorScriptText: script || undefined,
      });
      setScript(res.scriptText ?? '');
      // Keep our result — block the auto-generate effect from overwriting it.
      setScriptTouched(true);
      setScriptInstruction('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Couldn't regenerate script: ${message}`);
    }
  };

  // ── Submit ──────────────────────────────────────────────────────────────
  const handleGenerateGraphic = async () => {
    if (!serviceId) return;
    const isAd = graphicUsageType === 'ad';
    if (isAd && !offerId) {
      toast.error('Pick an offer for the paid ad graphic.');
      return;
    }
    setIsSubmitting(true);
    try {
      if (isAd) {
        // Paid offer ad: single image, server composes copy from the offer.
        await generateGraphicAsync({
          serviceId,
          usageType: 'ad',
          offerId: offerId ?? undefined,
          allowAiImages: effectiveAllowAiImages,
          allowStockImages,
          refinementInstruction: instruction.trim() || undefined,
        });
      } else {
        const category = pickRandomGraphicCategory();
        if (!category) {
          toast.error('Could not pick a graphic category.');
          return;
        }
        await generateGraphicAsync({
          serviceId,
          usageType: 'organic',
          category,
          kind: graphicKind,
          allowAiImages: effectiveAllowAiImages,
          allowStockImages,
          refinementInstruction: instruction.trim() || undefined,
          // Curated style pinned on the type step (absent = server rotation).
          ...(graphicTemplateSlug ? { templateSlug: graphicTemplateSlug } : {}),
        });
      }
    } catch {
      // Toast surfaced by the hook.
    } finally {
      setIsSubmitting(false);
    }
  };

  // Re-roll the just-generated video from the review modal, applying the user's
  // change request to whichever copy drives it (organic on-screen copy / spoken
  // script / offer-card copy), then re-queue the export in place.
  const handleRegenerateVideoFromModal = async (changeRequest: string) => {
    const ctx = lastVideoGenRef.current;
    if (!ctx) return;
    const refinementInstruction = changeRequest.trim() || undefined;
    setIsRegeneratingVideo(true);
    try {
      let draftConfig = ctx.draftConfig;
      let title: string | undefined;

      if (ctx.isOrganic && ctx.variationId) {
        const copy = await generateCopyAsync({
          variationId: ctx.variationId as OrganicVariationId,
          serviceId: ctx.serviceId,
          refinementInstruction,
          priorCopy: ctx.priorOrganicCopy?.config as
            | Record<string, unknown>
            | undefined,
        });
        ctx.priorOrganicCopy = copy;
        title = deriveOrganicTitle(copy);
        draftConfig = {
          ...ctx.draftConfig,
          ...configBlockForOrganicCopy(copy),
        };
      } else if (ctx.isOffer && ctx.offerId) {
        const offerCopy = await generateOfferCopyAsync({
          offerId: ctx.offerId,
          refinementInstruction,
          priorCopy: ctx.priorOfferCopy as Record<string, unknown> | undefined,
        });
        ctx.priorOfferCopy = offerCopy;
        draftConfig = {
          ...ctx.draftConfig,
          offerCard: {
            serviceName: offerCopy.headline,
            headline: offerCopy.headline,
            bulletPoints: offerCopy.bulletPoints,
            ctaText: offerCopy.ctaText || 'Book now',
            urgencyText: offerCopy.urgencyText || undefined,
            audienceText: offerCopy.audienceText || undefined,
            businessName: organizationName ?? undefined,
            primaryColor: brand?.primaryColor ?? '#007AFF',
            secondaryColor: brand?.secondaryColor ?? '#FFFFFF',
          },
        };
      } else if (ctx.variationId && ctx.narrationMode !== 'text_only') {
        // Spoken-script video (recorded / AI voiceover).
        const res = await generateScriptAsync({
          templateId: ctx.templateId,
          variationId: ctx.variationId,
          serviceId: ctx.serviceId,
          narrationMode:
            ctx.narrationMode === 'recorded' ? 'recorded' : 'ai_voiceover',
          refinementInstruction,
          priorScriptText: ctx.priorScriptText,
        });
        ctx.priorScriptText = res.scriptText ?? '';
        draftConfig = { ...ctx.draftConfig, scriptText: res.scriptText ?? '' };
      } else {
        toast.error("This video doesn't support prompt-based changes.");
        return;
      }

      ctx.draftConfig = draftConfig;
      await updateVideoAsync({
        id: ctx.videoId,
        serviceId: ctx.serviceId,
        offerId: ctx.offerId,
        draftConfig,
        ...(title ? { title } : {}),
      });
      await queueExportAsync({
        videoId: ctx.videoId,
        allowStockFootage: ctx.allowStockFootage,
      });
      // Restart the modal's polling on the same (now re-rendering) video.
      setVideoRegenTick((t) => t + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Failed to regenerate video: ${message}`);
    } finally {
      setIsRegeneratingVideo(false);
    }
  };

  const handleGenerateVideo = async () => {
    if (!template || !serviceId) return;
    setIsSubmitting(true);
    try {
      const bRollClips = slots.flatMap((slot, slotIndex) => {
        const ids = selectionsByOrder[slot.order] ?? [];
        return ids.map((assetId, i) => ({
          assetId,
          order: slotIndex * 100 + i,
          clipType: 'bRoll' as const,
        }));
      });

      const musicTrack = template.musicTracks?.[0];
      const musicUrl = musicTrack
        ? `${cdnUrl ?? ''}${musicTrack.path}`
        : undefined;

      let draftConfig: VideoDraftConfig;
      let title = template.title;
      let usageType: 'ad' | 'organic' = 'ad';
      // Lifted out of the branches so we can capture them for the review-modal
      // re-roll after the videoId is known.
      let priorOrganicCopy: GeneratedOrganicCopy | undefined;
      let priorOfferCopy: GeneratedOfferCopy | undefined;
      let narrationModeUsed: VideoDraftConfig['narrationType'] | undefined;

      if (isOrganic) {
        if (!variation?.id) throw new Error('Template has no variation');
        const copy = await generateCopyAsync({
          variationId: variation.id as OrganicVariationId,
          serviceId,
          refinementInstruction: instruction.trim() || undefined,
        });
        priorOrganicCopy = copy;
        title = deriveOrganicTitle(copy);
        usageType = 'organic';
        draftConfig = {
          narrationType: 'text_only',
          bRollClips,
          captions: { ...BASE_CAPTIONS, enabled: false },
          musicTrackId: musicTrack?.id,
          musicUrl,
          musicVolume: 0.18,
          orientation: 'portrait',
          // Organic posts have no outro by default; the user can toggle on a
          // branded outro, which the worker appends after the text.
          ...(organicOutroEnabled
            ? {
                outro: {
                  businessName: organizationName ?? 'Your Business',
                  ctaText: 'Book Now',
                  backgroundColor: brand?.primaryColor ?? '#000000',
                  backgroundOpacity: 0.7,
                  textColor: '#FFFFFF',
                  durationSec: 3,
                },
              }
            : {}),
          ...configBlockForOrganicCopy(copy),
        };
      } else {
        // Offer videos have no narration — the offerCard is the content. Force
        // text_only so we don't demand a (never-generated) voiceover script;
        // mirrors the server-side synth reshape for the 'offer' template.
        const narrationType: VideoDraftConfig['narrationType'] = isOffer
          ? 'text_only'
          : voiceoverMode === 'record'
            ? 'recorded'
            : voiceoverMode === 'ai_voiceover'
              ? 'ai_voiceover'
              : 'text_only';
        narrationModeUsed = narrationType;
        // `offerCopy` is the outer-scope state — populated by the auto-generate
        // effect and edited by the user on the 'offerCopy' step. Whatever's
        // here at submit time (edited or not) is what ships in the card.
        priorOfferCopy = offerCopy ?? undefined;
        draftConfig = {
          narrationType,
          aiVoiceId: narrationType === 'ai_voiceover' ? DEFAULT_AI_VOICE : null,
          scriptText: narrationType === 'text_only' ? '' : script,
          talkingHeadUrl: narrationType === 'recorded' ? talkingHeadUrl : null,
          bRollClips,
          // Offer cards carry their own copy, so captions add nothing.
          captions: isOffer
            ? { ...BASE_CAPTIONS, enabled: false }
            : BASE_CAPTIONS,
          musicTrackId: musicTrack?.id,
          musicUrl,
          musicVolume: 0.05,
          outro: {
            businessName: organizationName ?? 'Your Business',
            ctaText: 'Book Now',
            backgroundColor: brand?.primaryColor ?? '#000000',
            backgroundOpacity: 0.7,
            textColor: '#FFFFFF',
            durationSec: 3,
          },
          orientation: isOffer ? 'square' : 'portrait',
          offerCard:
            isOffer && offerCopy
              ? {
                  serviceName: offerCopy.headline,
                  headline: offerCopy.headline,
                  bulletPoints: offerCopy.bulletPoints,
                  ctaText: offerCopy.ctaText || 'Book now',
                  urgencyText: offerCopy.urgencyText || undefined,
                  audienceText: offerCopy.audienceText || undefined,
                  businessName: organizationName ?? undefined,
                  primaryColor: brand?.primaryColor ?? '#007AFF',
                  secondaryColor: brand?.secondaryColor ?? '#FFFFFF',
                }
              : undefined,
        };
      }

      // Reuse the record-path draft (if any) so we don't orphan it; otherwise
      // create a fresh video.
      let videoId: string;
      if (draftVideoId) {
        const updated = await updateVideoAsync({
          id: draftVideoId,
          title,
          serviceId,
          offerId: offerId ?? undefined,
          draftConfig,
        });
        videoId = updated.id;
      } else {
        const created = await createVideoAsync({
          title,
          templateId: templateId as string,
          variationId: variation?.id,
          serviceId,
          offerId: offerId ?? undefined,
          draftConfig,
          usageType,
        });
        videoId = created.id;
      }

      await queueExportAsync({ videoId, allowStockFootage });
      // Snapshot everything the review modal needs to re-roll this video.
      lastVideoGenRef.current = {
        videoId,
        serviceId,
        templateId: templateId as string,
        variationId: variation?.id,
        isOrganic,
        isOffer,
        narrationMode: narrationModeUsed,
        draftConfig,
        priorOrganicCopy,
        priorScriptText:
          !isOrganic && !isOffer && narrationModeUsed !== 'text_only'
            ? script
            : undefined,
        offerId: offerId ?? undefined,
        priorOfferCopy,
        allowStockFootage,
      };
      setVideoRegenTick(0);
      finalizedRef.current = true;
      queryClient.invalidateQueries({ queryKey: ['videos'] });
      setProcessingVideoId(videoId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Failed to queue video: ${message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNext = (e?: FormEvent) => {
    e?.preventDefault();
    if (!canContinue) return;
    if (!isLastStep) {
      setDirection('forward');
      setStepIndex((i) => i + 1);
      return;
    }
    if (postType === 'graphic') void handleGenerateGraphic();
    else void handleGenerateVideo();
  };

  const handleBack = () => {
    setDirection('back');
    setStepIndex((i) => Math.max(0, i - 1));
  };

  // ── Processing hand-off ──────────────────────────────────────────────────
  const handleProcessingClose = () => {
    setProcessingVideoId(null);
    handleOpenChange(false);
  };
  const handleVideoReady = () => {
    setProcessingVideoId(null);
    onOpenChange(false);
    reset();
    void navigate({ to: routes.content });
  };

  const formOpen = formIsActive;
  const { templates: graphicStyles } = useListGraphicTemplates('organic');

  // Pinning a style also fixes the format (a carousel style renders a
  // carousel), so the service step's format toggle hides while pinned.
  const handleChooseGraphicStyle = (slug: string | null) => {
    setGraphicTemplateSlug(slug);
    if (slug) {
      const style = graphicStyles.find((s) => s.slug === slug);
      if (style) setGraphicKind(style.kind);
    }
  };

  const filteredTemplates = filterVideoTemplates(filter);

  const stepMeta = STEP_META[currentStep];
  const generateLabel =
    postType === 'graphic' ? 'Generate graphic' : 'Generate';

  return (
    <>
      <ProcessingModal
        open={!!processingVideoId}
        videoId={processingVideoId}
        onClose={handleProcessingClose}
        onVideoReady={handleVideoReady}
        readyActionLabel="View in Library"
        onRegenerate={
          lastVideoGenRef.current ? handleRegenerateVideoFromModal : undefined
        }
        isRegenerating={isRegeneratingVideo}
        regenTick={videoRegenTick}
      />
      <GraphicProcessingModal
        open={!!pollingGraphicId}
        graphicId={pollingGraphicId}
        onClose={() => {
          setPollingGraphicId(null);
          // finalizedRef is set before polling starts, so this flows through
          // performClose — which resets the form and closes the parent (the
          // parent stays open now that onSuccess no longer closes it).
          handleOpenChange(false);
        }}
        onRegenerated={(newId) => setPollingGraphicId(newId)}
      />

      <Dialog open={formOpen} onOpenChange={handleOpenChange}>
        <DialogContent
          fullScreen={isMobile}
          className={cn(!isMobile && 'sm:max-w-3xl')}
          showCloseButton={!isSubmitting}
          // Don't let Radix auto-close on Escape / outside click — route every
          // dismissal through requestClose so we can confirm + clean up.
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            requestClose();
          }}
          onPointerDownOutside={(e) => {
            e.preventDefault();
            requestClose();
          }}
          onInteractOutside={(e) => {
            e.preventDefault();
            requestClose();
          }}
        >
          <DialogHeader className={cn(isMobile && 'shrink-0')}>
            <DialogTitle>{stepMeta.title}</DialogTitle>
            <DialogDescription>{stepMeta.description}</DialogDescription>
          </DialogHeader>

          <form
            onSubmit={handleNext}
            className={cn(
              'flex flex-col gap-5 px-1',
              isMobile ? 'min-h-0 flex-1' : 'max-h-[70vh] overflow-y-auto'
            )}
          >
            {/* Re-mount on step change so the slide/fade animation re-runs. The
                direction flips the slide side for forward vs back. On mobile the
                step body scrolls and the footer stays pinned to the bottom. */}
            <div
              key={`${currentStep}-${stepIndex}`}
              className={cn(
                'flex flex-col gap-5 duration-300 animate-in fade-in',
                isMobile && 'min-h-0 flex-1 overflow-y-auto',
                direction === 'forward'
                  ? 'slide-in-from-right-8'
                  : 'slide-in-from-left-8'
              )}
            >
              {currentStep === 'type' && (
                <TypeAndTemplateStep
                  postType={postType}
                  onChoosePostType={(t) => {
                    setPostType(t);
                    if (t === 'graphic') setTemplateId(null);
                  }}
                  templateId={templateId}
                  onChooseTemplate={setTemplateId}
                  filter={filter}
                  onFilterChange={setFilter}
                  templates={filteredTemplates}
                  graphicStyles={graphicStyles}
                  graphicTemplateSlug={graphicTemplateSlug}
                  onChooseGraphicStyle={handleChooseGraphicStyle}
                />
              )}

              {currentStep === 'service' && (
                <ServiceStep
                  postType={postType}
                  services={serviceItems}
                  isServicesLoading={isServicesLoading}
                  serviceId={serviceId}
                  onServiceChange={handleServiceChange}
                  showOffer={postType === 'video'}
                  offerRequired={isOffer}
                  offers={sortedOffers.map((o) => ({
                    id: o.id,
                    name: o.name,
                    code: o.code ?? null,
                  }))}
                  isOffersLoading={isOffersLoading}
                  offerId={offerId}
                  onOfferChange={setOfferId}
                  isGeneratingOfferCopy={isGeneratingOfferCopy}
                  graphicUsageType={graphicUsageType}
                  onGraphicUsageTypeChange={(next) => {
                    setGraphicUsageType(next);
                    // Clear any offer when switching back to organic.
                    if (next === 'organic') setOfferId(null);
                  }}
                  graphicAllowAi={graphicAllowAi}
                  onGraphicAllowAiChange={setGraphicAllowAi}
                  allowStockImages={allowStockImages}
                  onAllowStockImagesChange={setAllowStockImages}
                  graphicKind={graphicKind}
                  onGraphicKindChange={setGraphicKind}
                  graphicKindLocked={graphicTemplateSlug !== null}
                />
              )}

              {currentStep === 'offerCopy' && offerCopy && (
                <OfferCopyStep
                  copy={offerCopy}
                  isGenerating={isGeneratingOfferCopy}
                  onChange={(next) => {
                    setOfferCopy(next);
                    setOfferCopyTouched(true);
                  }}
                />
              )}

              {currentStep === 'voiceover' && (
                <VoiceoverStep
                  allowsRecord={allowsRecord}
                  mode={voiceoverMode}
                  onModeChange={handleSelectVoiceoverMode}
                  script={script}
                  onScriptChange={(v) => {
                    setScript(v);
                    setScriptTouched(true);
                  }}
                  isGeneratingScript={isGeneratingScript}
                  scriptInstruction={scriptInstruction}
                  onScriptInstructionChange={setScriptInstruction}
                  onRegenerateScript={handleRegenerateScript}
                  draftVideoId={draftVideoId}
                  talkingHeadUrl={talkingHeadUrl}
                  isUploadingHead={isUploadingHead}
                  headUploadProgress={headUploadProgress}
                  onHeadFileChange={handleHeadFileChange}
                  onRemoveHead={() => setTalkingHeadUrl(null)}
                />
              )}

              {currentStep === 'footage' &&
                serviceId &&
                activeOrder !== null && (
                  <FootageStep
                    slots={slots}
                    serviceId={serviceId}
                    services={services.map((service) => ({
                      id: service.id,
                      name: service.name,
                    }))}
                    activeOrder={activeOrder}
                    onActiveOrderChange={setActiveOrder}
                    selectionsByOrder={selectionsByOrder}
                    onSelectionChange={(order, ids) =>
                      setSelectionsByOrder((prev) => ({
                        ...prev,
                        [order]: ids,
                      }))
                    }
                  />
                )}

              {currentStep === 'footage' &&
                postType === 'video' &&
                templateId !== 'before-after' && (
                  <div className="mt-4 flex items-center justify-between rounded-xl border border-[#E5E5EA] px-4 py-3">
                    <div className="pr-4">
                      <Label htmlFor="stock-footage-toggle">
                        Use curated stock footage
                      </Label>
                      <p className="mt-0.5 text-[13px] leading-snug text-[#8E8E93]">
                        When this service has no uploaded footage, fill the
                        video with relevant licensed stock clips.
                      </p>
                    </div>
                    <Switch
                      id="stock-footage-toggle"
                      checked={allowStockFootage}
                      onCheckedChange={setAllowStockFootage}
                    />
                  </div>
                )}

              {currentStep === 'footage' && isOrganic && (
                <div className="mt-4 flex items-center justify-between rounded-xl border border-[#E5E5EA] px-4 py-3">
                  <div className="pr-4">
                    <Label htmlFor="organic-outro">Add an outro</Label>
                    <p className="mt-0.5 text-[13px] leading-snug text-[#8E8E93]">
                      End with your branded logo & call-to-action.
                    </p>
                  </div>
                  <Switch
                    id="organic-outro"
                    checked={organicOutroEnabled}
                    onCheckedChange={setOrganicOutroEnabled}
                  />
                </div>
              )}

              {/* Optional steer for the AI copy/graphic. Shown on the final
                  step for graphics and organic videos (where the copy is
                  AI-written, not directly editable here). */}
              {isLastStep &&
                (postType === 'graphic' ||
                  (postType === 'video' && isOrganic)) && (
                  <div className="mt-4 space-y-1.5">
                    <Label htmlFor="post-instruction">
                      {GRAPHIC.refinementInstruction}
                    </Label>
                    <Textarea
                      id="post-instruction"
                      value={instruction}
                      onChange={(e) => setInstruction(e.target.value)}
                      rows={2}
                      maxLength={500}
                      placeholder={
                        postType === 'graphic'
                          ? 'e.g. minimal style, lead with the price, bright colours…'
                          : 'e.g. punchier hook, mention our free consultation…'
                      }
                    />
                    <p className="text-[13px] leading-snug text-[#8E8E93]">
                      We&apos;ll factor this into what we generate.
                    </p>
                  </div>
                )}
            </div>

            <div
              className={cn(
                'flex items-center justify-between border-t pt-4',
                isMobile && 'shrink-0'
              )}
            >
              {stepIndex > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleBack}
                  disabled={isSubmitting}
                >
                  Back
                </Button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-4">
                {steps.length > 1 && (
                  <StepDots totalSteps={steps.length} currentStep={stepIndex} />
                )}
                <Button type="submit" disabled={!canContinue}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Generating…
                    </>
                  ) : isLastStep ? (
                    <>
                      <Sparkles className="size-4" />
                      {generateLabel}
                    </>
                  ) : (
                    'Continue'
                  )}
                </Button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmDiscardOpen}
        onOpenChange={setConfirmDiscardOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this post?</AlertDialogTitle>
            <AlertDialogDescription>
              Your progress will be lost
              {draftVideoId
                ? ', and any recording you started will be deleted'
                : ''}
              . This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmDiscardOpen(false);
                performClose();
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

const STEP_META: Record<StepId, { title: string; description: string }> = {
  type: {
    title: 'Create a new post',
    description: 'Choose what to make, then pick a format.',
  },
  service: {
    title: 'Which service is this for?',
    description: 'Pick the service this post promotes.',
  },
  offerCopy: {
    title: 'Review your offer text',
    description:
      'AI-generated from your offer — edit anything before we make the video.',
  },
  voiceover: {
    title: 'Voiceover',
    description: 'Choose how the narration is produced.',
  },
  footage: {
    title: 'Choose your footage',
    description: 'Pick clips for each part of the video.',
  },
};

// ── Step 1: type + template ────────────────────────────────────────────────

function TypeAndTemplateStep({
  postType,
  onChoosePostType,
  templateId,
  onChooseTemplate,
  filter,
  onFilterChange,
  templates,
  graphicStyles,
  graphicTemplateSlug,
  onChooseGraphicStyle,
}: {
  postType: PostType | null;
  onChoosePostType: (t: PostType) => void;
  templateId: string | null;
  onChooseTemplate: (id: string) => void;
  filter: VideoFilter;
  onFilterChange: (f: VideoFilter) => void;
  templates: VideoTemplateItem[];
  graphicStyles: {
    slug: string;
    label: string;
    description: string;
    kind: 'single' | 'carousel';
  }[];
  graphicTemplateSlug: string | null;
  onChooseGraphicStyle: (slug: string | null) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <RadioGroup
        value={postType ?? ''}
        onValueChange={(v) => onChoosePostType(v as PostType)}
        className="grid gap-3 sm:grid-cols-2"
      >
        <FieldLabel htmlFor="post-type-video">
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>
                <VideoIcon className="mr-2 inline size-4 text-muted-foreground" />
                Video
              </FieldTitle>
              <FieldDescription>
                Organic or paid video templates.
              </FieldDescription>
            </FieldContent>
            <RadioGroupItem value="video" id="post-type-video" />
          </Field>
        </FieldLabel>
        <FieldLabel htmlFor="post-type-graphic">
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>
                <ImageIcon className="mr-2 inline size-4 text-muted-foreground" />
                Graphic
              </FieldTitle>
              <FieldDescription>
                A designed post — single image or carousel.
              </FieldDescription>
            </FieldContent>
            <RadioGroupItem value="graphic" id="post-type-graphic" />
          </Field>
        </FieldLabel>
      </RadioGroup>

      {postType === 'video' && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((key) => (
              <Button
                key={key}
                type="button"
                size="sm"
                variant={key === filter ? 'secondary' : 'ghost'}
                onClick={() => onFilterChange(key)}
              >
                {FILTER_LABELS[key]}
              </Button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((t) => {
              const Icon = t.icon;
              const selected = t.id === templateId;
              return (
                <Card
                  key={t.id}
                  onClick={() => onChooseTemplate(t.id)}
                  className={cn(
                    'cursor-pointer transition-all hover:shadow-md',
                    selected && 'border-primary ring-2 ring-primary/40'
                  )}
                >
                  <CardContent className="flex flex-col gap-3 p-4">
                    <div className="flex size-10 items-center justify-center rounded-md bg-accent">
                      <Icon className="size-5 text-muted-foreground" />
                    </div>
                    <div>
                      <h4 className="text-sm font-medium">{t.title}</h4>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {t.description}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {postType === 'graphic' && (
        <div className="flex flex-col gap-3">
          <Label>Style</Label>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Card
              onClick={() => onChooseGraphicStyle(null)}
              className={cn(
                'cursor-pointer transition-all hover:shadow-md',
                graphicTemplateSlug === null &&
                  'border-primary ring-2 ring-primary/40'
              )}
            >
              <CardContent className="flex flex-col gap-3 p-4">
                <div className="flex size-10 items-center justify-center rounded-md bg-accent">
                  <Sparkles className="size-5 text-muted-foreground" />
                </div>
                <div>
                  <h4 className="text-sm font-medium">Surprise me</h4>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    We pick the style. Different every time.
                  </p>
                </div>
              </CardContent>
            </Card>
            {graphicStyles.map((s) => {
              const Icon = graphicTemplateIcon(s.slug, s.kind);
              const selected = s.slug === graphicTemplateSlug;
              return (
                <Card
                  key={s.slug}
                  onClick={() => onChooseGraphicStyle(s.slug)}
                  className={cn(
                    'cursor-pointer transition-all hover:shadow-md',
                    selected && 'border-primary ring-2 ring-primary/40'
                  )}
                >
                  <CardContent className="flex flex-col gap-3 p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex size-10 items-center justify-center rounded-md bg-accent">
                        <Icon className="size-5 text-muted-foreground" />
                      </div>
                      <Badge
                        variant="outline"
                        className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                      >
                        {s.kind === 'carousel' ? 'Carousel' : 'Single'}
                      </Badge>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium">{s.label}</h4>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {s.description}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step 2: service (+ offer) ────────────────────────────────────────────────

function ServiceStep({
  postType,
  services,
  isServicesLoading,
  serviceId,
  onServiceChange,
  showOffer,
  offerRequired,
  offers,
  isOffersLoading,
  offerId,
  onOfferChange,
  isGeneratingOfferCopy,
  graphicUsageType,
  onGraphicUsageTypeChange,
  graphicAllowAi,
  onGraphicAllowAiChange,
  allowStockImages,
  onAllowStockImagesChange,
  graphicKind,
  onGraphicKindChange,
  graphicKindLocked,
}: {
  postType: PostType | null;
  services: { id: string; name: string }[];
  isServicesLoading: boolean;
  serviceId: string | null;
  onServiceChange: (id: string) => void;
  showOffer: boolean;
  offerRequired: boolean;
  offers: { id: string; name: string; code: string | null }[];
  isOffersLoading: boolean;
  offerId: string | null;
  onOfferChange: (id: string | null) => void;
  isGeneratingOfferCopy: boolean;
  graphicUsageType: 'organic' | 'ad';
  onGraphicUsageTypeChange: (next: 'organic' | 'ad') => void;
  graphicAllowAi: boolean;
  onGraphicAllowAiChange: (next: boolean) => void;
  allowStockImages: boolean;
  onAllowStockImagesChange: (next: boolean) => void;
  graphicKind: 'single' | 'carousel';
  onGraphicKindChange: (next: 'single' | 'carousel') => void;
  /** True when a curated style is pinned — the style fixes the format. */
  graphicKindLocked: boolean;
}) {
  const isGraphic = postType === 'graphic';
  const isAdGraphic = isGraphic && graphicUsageType === 'ad';

  return (
    <div className="flex flex-col gap-5">
      {/* Graphic: organic vs paid offer ad — on the same screen as the
          service input and the AI toggle. */}
      {isGraphic && (
        <div className="grid gap-2">
          <Label>{GRAPHIC.usageType}</Label>
          <RadioGroup
            aria-label={GRAPHIC.usageType}
            value={graphicUsageType}
            onValueChange={(v) =>
              onGraphicUsageTypeChange(v as 'organic' | 'ad')
            }
            className="grid gap-3 sm:grid-cols-2"
          >
            <FieldLabel htmlFor="graphic-organic">
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>Organic post</FieldTitle>
                  <FieldDescription>
                    A normal social post for your feed.
                  </FieldDescription>
                </FieldContent>
                <RadioGroupItem value="organic" id="graphic-organic" />
              </Field>
            </FieldLabel>
            <FieldLabel htmlFor="graphic-ad">
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>Paid ad</FieldTitle>
                  <FieldDescription>
                    An offer ad with a price/discount, to run as an
                    advertisement.
                  </FieldDescription>
                </FieldContent>
                <RadioGroupItem value="ad" id="graphic-ad" />
              </Field>
            </FieldLabel>
          </RadioGroup>
        </div>
      )}

      {/* Organic graphics: single image vs multi-slide carousel. Paid ads are
          always a single image, so the choice only shows for organic. Hidden
          when a curated style is pinned — the style fixes the format. */}
      {isGraphic && graphicUsageType === 'organic' && !graphicKindLocked && (
        <div className="grid gap-2">
          <Label>{GRAPHIC.kind}</Label>
          <RadioGroup
            aria-label={GRAPHIC.kind}
            value={graphicKind}
            onValueChange={(v) =>
              onGraphicKindChange(v as 'single' | 'carousel')
            }
            className="grid gap-3 sm:grid-cols-2"
          >
            <FieldLabel htmlFor="graphic-single">
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>Single image</FieldTitle>
                  <FieldDescription>One image for your feed.</FieldDescription>
                </FieldContent>
                <RadioGroupItem value="single" id="graphic-single" />
              </Field>
            </FieldLabel>
            <FieldLabel htmlFor="graphic-carousel">
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>Carousel</FieldTitle>
                  <FieldDescription>
                    A multi-slide swipeable post.
                  </FieldDescription>
                </FieldContent>
                <RadioGroupItem value="carousel" id="graphic-carousel" />
              </Field>
            </FieldLabel>
          </RadioGroup>
        </div>
      )}

      <div className="grid gap-2">
        <Label>{GRAPHIC.serviceId}</Label>
        <SearchCombobox
          items={services}
          value={serviceId}
          isLoading={isServicesLoading}
          onChange={onServiceChange}
          placeholder="Search and select a service"
          loadingText="Loading services…"
          emptyText="No services found."
        />
        {isGraphic && !isAdGraphic && (
          <p className="text-xs text-muted-foreground">
            We’ll pick a template and format for you, then generate the graphic
            from this service’s media.
          </p>
        )}
        {isAdGraphic && (
          <p className="text-xs text-muted-foreground">
            We’ll design the offer ad — badge, treatment name, benefits and CTA
            — from the offer below and this service’s media.
          </p>
        )}
      </div>

      {/* Graphic: paid ads need an offer (its discount/price drives the ad). */}
      {isAdGraphic && (
        <div className="grid gap-2">
          <Label>Offer</Label>
          {!isOffersLoading && offers.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              You don’t have any active offers yet. Create one under Promotions,
              then come back to make the ad.
            </div>
          ) : (
            <SearchCombobox
              items={offers}
              value={offerId}
              isLoading={isOffersLoading}
              onChange={(id) => onOfferChange(id)}
              placeholder="Search and select an offer"
              loadingText="Loading offers…"
              emptyText="No offers found."
            />
          )}
        </div>
      )}

      {/* Graphic: AI image toggle (shared by organic + paid). */}
      {isGraphic && (
        <div className="flex items-start justify-between gap-4 rounded-md border p-3">
          <div className="grid gap-0.5">
            <Label htmlFor="graphic-allow-ai">{GRAPHIC.allowAiImages}</Label>
            <p className="text-xs text-muted-foreground">
              Off: we use the photos and clips you’ve uploaded for the service.
              On: gaps are filled with AI images.
            </p>
          </div>
          <Switch
            id="graphic-allow-ai"
            checked={graphicAllowAi}
            onCheckedChange={onGraphicAllowAiChange}
          />
        </div>
      )}

      {/* Graphic: curated stock photos fill service slots that have no matching
          uploaded media (shared by organic + paid). */}
      {isGraphic && (
        <div className="flex items-start justify-between gap-4 rounded-md border p-3">
          <div className="grid gap-0.5">
            <Label htmlFor="graphic-allow-stock">
              {GRAPHIC.allowStockImages}
            </Label>
            <p className="text-xs text-muted-foreground">
              When this service has no matching photo, fill the slot with a
              relevant licensed stock image.
            </p>
          </div>
          <Switch
            id="graphic-allow-stock"
            checked={allowStockImages}
            onCheckedChange={onAllowStockImagesChange}
          />
        </div>
      )}

      {showOffer && (offerRequired || offers.length > 0) && (
        <div className="grid gap-2">
          <Label>
            {offerRequired ? 'Offer' : 'Link to an offer (optional)'}
          </Label>
          <SearchCombobox
            items={offers}
            value={offerId}
            isLoading={isOffersLoading}
            onChange={(id) => onOfferChange(id)}
            placeholder={
              offerRequired ? 'Search and select an offer' : 'No offer'
            }
            loadingText="Loading offers…"
            emptyText="No offers found."
            allowClear={!offerRequired}
            onClear={() => onOfferChange(null)}
          />
          {isGeneratingOfferCopy && (
            <p className="text-xs text-muted-foreground">
              Generating offer copy…
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Step 2b: offer copy (offer videos only) ─────────────────────────────────
// Renders the AI-generated offerCard copy (headline, bullet points, CTA,
// urgency, audience) as editable fields, so the user can fix a wrong price
// mention, awkward headline, or bad CTA before the video renders. Values
// submit exactly as edited — see the offerCard assignment in
// handleGenerateVideo above.

const MIN_BULLET_POINTS = 2;
const MAX_BULLET_POINTS = 4;

function OfferCopyStep({
  copy,
  isGenerating,
  onChange,
}: {
  copy: GeneratedOfferCopy;
  isGenerating: boolean;
  onChange: (next: GeneratedOfferCopy) => void;
}) {
  const updateBulletPoint = (index: number, value: string) => {
    const next = [...copy.bulletPoints];
    next[index] = value;
    onChange({ ...copy, bulletPoints: next });
  };

  const addBulletPoint = () => {
    if (copy.bulletPoints.length >= MAX_BULLET_POINTS) return;
    onChange({ ...copy, bulletPoints: [...copy.bulletPoints, ''] });
  };

  const removeBulletPoint = (index: number) => {
    if (copy.bulletPoints.length <= MIN_BULLET_POINTS) return;
    onChange({
      ...copy,
      bulletPoints: copy.bulletPoints.filter((_, i) => i !== index),
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {isGenerating && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Refreshing offer copy…
        </p>
      )}

      <Field>
        <FieldLabel htmlFor="offer-copy-headline">Headline</FieldLabel>
        <Input
          id="offer-copy-headline"
          value={copy.headline}
          maxLength={80}
          onChange={(e) => onChange({ ...copy, headline: e.target.value })}
          placeholder="e.g. Summer Skin Refresh"
        />
      </Field>

      <Field>
        <FieldLabel>Bullet points</FieldLabel>
        <div className="grid gap-2">
          {copy.bulletPoints.map((point, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                value={point}
                maxLength={60}
                onChange={(e) => updateBulletPoint(index, e.target.value)}
                placeholder={`Bullet point ${index + 1}`}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0"
                disabled={copy.bulletPoints.length <= MIN_BULLET_POINTS}
                onClick={() => removeBulletPoint(index)}
                aria-label="Remove bullet point"
              >
                <Trash2 className="size-4 text-muted-foreground" />
              </Button>
            </div>
          ))}
        </div>
        {copy.bulletPoints.length < MAX_BULLET_POINTS && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={addBulletPoint}
          >
            <Plus className="size-4" />
            Add bullet point
          </Button>
        )}
      </Field>

      <Field>
        <FieldLabel htmlFor="offer-copy-cta">Call to action</FieldLabel>
        <Input
          id="offer-copy-cta"
          value={copy.ctaText}
          maxLength={40}
          onChange={(e) => onChange({ ...copy, ctaText: e.target.value })}
          placeholder="e.g. Book now"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="offer-copy-urgency">
            Urgency text{' '}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </FieldLabel>
          <Input
            id="offer-copy-urgency"
            value={copy.urgencyText}
            maxLength={80}
            onChange={(e) => onChange({ ...copy, urgencyText: e.target.value })}
            placeholder="e.g. Ends this Friday"
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="offer-copy-audience">
            Audience text{' '}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </FieldLabel>
          <Input
            id="offer-copy-audience"
            value={copy.audienceText}
            maxLength={80}
            onChange={(e) =>
              onChange({ ...copy, audienceText: e.target.value })
            }
            placeholder="e.g. New clients only"
          />
        </Field>
      </div>
    </div>
  );
}

// ── Step 3: voiceover ──────────────────────────────────────────────────────

function VoiceoverStep({
  allowsRecord,
  mode,
  onModeChange,
  script,
  onScriptChange,
  isGeneratingScript,
  scriptInstruction,
  onScriptInstructionChange,
  onRegenerateScript,
  draftVideoId,
  talkingHeadUrl,
  isUploadingHead,
  headUploadProgress,
  onHeadFileChange,
  onRemoveHead,
}: {
  allowsRecord: boolean;
  mode: VoiceoverMode;
  onModeChange: (m: VoiceoverMode) => void;
  script: string;
  onScriptChange: (v: string) => void;
  isGeneratingScript: boolean;
  scriptInstruction: string;
  onScriptInstructionChange: (v: string) => void;
  onRegenerateScript: () => void;
  draftVideoId: string | null;
  talkingHeadUrl: string | null;
  isUploadingHead: boolean;
  headUploadProgress: number;
  onHeadFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onRemoveHead: () => void;
}) {
  const secondOption: {
    value: VoiceoverMode;
    title: string;
    description: string;
  } = allowsRecord
    ? {
        value: 'record',
        title: 'Record Voiceover',
        description: 'Film yourself as a talking head on your phone.',
      }
    : {
        value: 'text_only',
        title: 'Text Only',
        description: 'Show the script as on-screen text — no narration.',
      };

  const showScript = mode === 'ai_voiceover' || mode === 'record';

  return (
    <div className="flex flex-col gap-5">
      <RadioGroup
        value={mode}
        onValueChange={(v) => onModeChange(v as VoiceoverMode)}
        className="grid gap-3 sm:grid-cols-2"
      >
        <FieldLabel htmlFor="vo-ai">
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>AI Voiceover</FieldTitle>
              <FieldDescription>
                Generate a script and narrate it with an AI voice.
              </FieldDescription>
            </FieldContent>
            <RadioGroupItem value="ai_voiceover" id="vo-ai" />
          </Field>
        </FieldLabel>
        <FieldLabel htmlFor="vo-second">
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>{secondOption.title}</FieldTitle>
              <FieldDescription>{secondOption.description}</FieldDescription>
            </FieldContent>
            <RadioGroupItem value={secondOption.value} id="vo-second" />
          </Field>
        </FieldLabel>
      </RadioGroup>

      {showScript && (
        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="vo-script">
              {mode === 'record'
                ? 'Teleprompter script'
                : 'AI voiceover script'}
            </Label>
            {isGeneratingScript && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                Generating…
              </span>
            )}
          </div>
          <Textarea
            id="vo-script"
            value={script}
            onChange={(e) => onScriptChange(e.target.value)}
            placeholder="Script will populate once generated. Edit freely."
            rows={6}
          />
          {/* Prompt-based script changes — edit the text above directly, or
              describe a change and let us re-roll it. */}
          <div className="flex items-end gap-2">
            <div className="grid flex-1 gap-1.5">
              <Label htmlFor="vo-script-instruction" className="text-xs">
                Want changes? Describe them (optional)
              </Label>
              <Textarea
                id="vo-script-instruction"
                value={scriptInstruction}
                onChange={(e) => onScriptInstructionChange(e.target.value)}
                placeholder="e.g. shorter, friendlier, mention our free consultation…"
                rows={2}
                maxLength={500}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={onRegenerateScript}
              disabled={isGeneratingScript}
              className="gap-2"
            >
              {isGeneratingScript ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              Regenerate
            </Button>
          </div>
        </div>
      )}

      {/* Record panel slides in when the Record card is active. */}
      {mode === 'record' && (
        <div
          key="record-panel"
          className="animate-in fade-in slide-in-from-right-6 duration-300"
        >
          <RecordVoiceoverPanel
            draftVideoId={draftVideoId}
            talkingHeadUrl={talkingHeadUrl}
            isUploading={isUploadingHead}
            uploadProgress={headUploadProgress}
            onFileChange={onHeadFileChange}
            onRemove={onRemoveHead}
          />
        </div>
      )}
    </div>
  );
}

function RecordVoiceoverPanel({
  draftVideoId,
  talkingHeadUrl,
  isUploading,
  uploadProgress,
  onFileChange,
  onRemove,
}: {
  draftVideoId: string | null;
  talkingHeadUrl: string | null;
  isUploading: boolean;
  uploadProgress: number;
  onFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}) {
  const recordUrl = draftVideoId ? webAppUrl(`/record/${draftVideoId}`) : null;

  if (!draftVideoId) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        Preparing your recording link…
      </div>
    );
  }

  if (talkingHeadUrl) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950">
        <div className="flex items-center gap-2">
          <CheckCircle2Icon className="size-5 text-green-600" />
          <span className="text-sm font-medium text-green-700 dark:text-green-300">
            Recording uploaded
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
        >
          <XIcon className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-[auto_1fr]">
      <div className="flex flex-col items-center gap-2">
        <QRCode className="size-36" data={recordUrl ?? ''} />
        <p className="text-center text-xs text-muted-foreground">
          Scan to record on your phone
        </p>
      </div>
      <div className="flex flex-col justify-center gap-3">
        <div className="flex flex-col gap-1.5 text-sm">
          <span className="inline-flex items-center gap-2 text-foreground">
            <CheckCircle2Icon className="size-4 text-green-600" />
            Built-in teleprompter
          </span>
          <span className="inline-flex items-center gap-2 text-foreground">
            <CheckCircle2Icon className="size-4 text-green-600" />
            Uploads back here automatically
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => recordUrl && window.open(recordUrl, '_blank')}
        >
          <MonitorIcon className="mr-2 size-4" />
          Record on this device
        </Button>
        {isUploading ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <UploadIcon className="size-4 animate-pulse" />
              Uploading… {uploadProgress}%
            </div>
            <Progress value={uploadProgress} className="h-2" />
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">
              Or upload a recording
            </Label>
            <Input
              type="file"
              accept="video/*"
              onChange={onFileChange}
              className="cursor-pointer text-muted-foreground"
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Step 4: footage ──────────────────────────────────────────────────────

function FootageStep({
  slots,
  serviceId,
  services,
  activeOrder,
  onActiveOrderChange,
  selectionsByOrder,
  onSelectionChange,
}: {
  slots: SlotState[];
  serviceId: string;
  services: { id: string; name: string }[];
  activeOrder: number;
  onActiveOrderChange: (order: number) => void;
  selectionsByOrder: Record<number, string[]>;
  onSelectionChange: (order: number, ids: string[]) => void;
}) {
  if (slots.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This template doesn’t need any footage.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      <Tabs
        value={String(activeOrder)}
        onValueChange={(v) => onActiveOrderChange(Number(v))}
      >
        <TabsList className="flex flex-wrap">
          {slots.map((slot) => {
            const count = selectionsByOrder[slot.order]?.length ?? 0;
            return (
              <TabsTrigger key={slot.order} value={String(slot.order)}>
                {slot.label}
                {count > 0 && (
                  <Badge
                    variant="secondary"
                    className="ml-2 h-4 px-1 text-[10px]"
                  >
                    {count}
                  </Badge>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>
      {slots.map((slot) => (
        <div
          key={slot.order}
          className={cn(slot.order !== activeOrder && 'hidden')}
        >
          <SlotAssetGrid
            slot={slot}
            serviceId={serviceId}
            services={services}
            selectedIds={selectionsByOrder[slot.order] ?? []}
            onChange={(ids) => onSelectionChange(slot.order, ids)}
          />
        </div>
      ))}
    </div>
  );
}

type TagFilterKey = 'all' | AssetContentTypeTag;

// Mirrors the Claire clip picker: "All" at the head, then the content-type
// tags in label declaration order.
const TAG_FILTERS: { key: TagFilterKey; label: string }[] = [
  { key: 'all', label: 'All types' },
  ...(
    Object.entries(assetContentTypeTagLabels) as [AssetContentTypeTag, string][]
  ).map(([key, label]) => ({ key: key as TagFilterKey, label })),
];

function SlotAssetGrid({
  slot,
  serviceId,
  services,
  selectedIds,
  onChange,
}: {
  slot: SlotState;
  serviceId: string | null;
  services: { id: string; name: string }[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState('');
  const [serviceFilter, setServiceFilter] = useState('all');
  // Default the category to the slot's own tag, but keep it switchable. An
  // org whose clips are untagged (or tagged for another slot) would otherwise
  // hit an empty grid with no way to widen the selection.
  const [activeTag, setActiveTag] = useState<TagFilterKey>(
    (slot.filterTag as TagFilterKey | undefined) ?? 'all'
  );
  useEffect(() => {
    setActiveTag((slot.filterTag as TagFilterKey | undefined) ?? 'all');
  }, [slot.filterTag]);

  // The endpoint has no text search, so the grid filters this fetched page
  // client-side. Cap generously and surface truncation below rather than
  // silently hiding clips past the limit.
  const RAW_VIDEO_FETCH_LIMIT = 200;
  const {
    assets: allAssets,
    total: allAssetsTotal,
    isLoading: isAllLoading,
  } = useListAssets({
    type: 'video',
    source: 'raw',
    limit: RAW_VIDEO_FETCH_LIMIT,
  });
  const isTruncated = allAssetsTotal > allAssets.length;
  const { assets: serviceAssets, isLoading: isServiceLoading } =
    useListAssetsByService(serviceId ?? '');

  const { ordered, serviceLinked } = useMemo(
    () => buildUploadedVideoLibrary(allAssets, serviceAssets),
    [allAssets, serviceAssets]
  );
  // Auto-selection stays anchored to the slot's own tag so the recommended
  // picks keep matching the template, regardless of the browsing filter.
  const eligible = useMemo(
    () => filterUploadedVideoLibrary(ordered, slot.filterTag ?? 'all', ''),
    [ordered, slot.filterTag]
  );
  const visible = useMemo(() => {
    return filterUploadedVideoLibrary(
      ordered,
      activeTag,
      search,
      serviceFilter === 'all'
        ? undefined
        : {
            serviceId: serviceFilter,
            promotedServiceId: serviceId,
            promotedServiceAssetIds: serviceLinked,
          }
    );
  }, [ordered, activeTag, search, serviceFilter, serviceId, serviceLinked]);

  const hasAutoSelected = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset gate when slot/service changes
  useEffect(() => {
    hasAutoSelected.current = false;
  }, [slot.order, serviceId]);
  useEffect(() => {
    if (hasAutoSelected.current) return;
    if (isAllLoading || isServiceLoading) return;
    if (eligible.length === 0) return;
    if (selectedIds.length > 0) {
      hasAutoSelected.current = true;
      return;
    }
    const pick = eligible
      .slice(0, Math.min(slot.recommendedCount, slot.maxCount))
      .map((a) => a.id);
    onChange(pick);
    hasAutoSelected.current = true;
  }, [
    eligible,
    isAllLoading,
    isServiceLoading,
    selectedIds.length,
    slot.recommendedCount,
    slot.maxCount,
    onChange,
  ]);

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
      return;
    }
    if (selectedIds.length >= slot.maxCount) {
      onChange([...selectedIds.slice(1), id]);
      return;
    }
    onChange([...selectedIds, id]);
  };

  if (isAllLoading || isServiceLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="aspect-video rounded-lg" />
        ))}
      </div>
    );
  }

  // Only a genuinely empty library is a dead end. When the org has uploads but
  // none carry this slot's tag, fall through to the grid so the category
  // filter can widen the selection instead of stranding the user.
  if (ordered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-md border border-dashed py-8 text-center">
        <ImageIcon className="size-6 text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">
          No uploaded clips yet. Upload videos in Content to build your library.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search clips…"
            className="pl-8"
          />
        </div>
        <Select
          value={activeTag}
          onValueChange={(value) => setActiveTag(value as TagFilterKey)}
        >
          <SelectTrigger
            className="w-full sm:w-[170px]"
            aria-label="Filter clips by type"
          >
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            {TAG_FILTERS.map((filter) => (
              <SelectItem key={filter.key} value={filter.key}>
                {filter.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={serviceFilter} onValueChange={setServiceFilter}>
          <SelectTrigger
            className="w-full sm:w-[210px]"
            aria-label="Filter clips by service"
          >
            <SelectValue placeholder="All services" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All services</SelectItem>
            {services.map((service) => (
              <SelectItem key={service.id} value={service.id}>
                {service.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="text-xs text-muted-foreground">
        {selectedIds.length} of {slot.maxCount} selected
      </p>
      {isTruncated && (
        <p className="text-xs text-muted-foreground">
          Showing your {allAssets.length} most recent clips of {allAssetsTotal}.
          Use the type or service filters to narrow down older uploads.
        </p>
      )}
      {visible.length === 0 ? (
        <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
          <p>No uploaded clips match these filters.</p>
          {search ? (
            <p className="mt-1 text-xs">Try clearing the search.</p>
          ) : activeTag !== 'all' ? (
            <p className="mt-1 text-xs">
              Nothing tagged{' '}
              <code className="rounded bg-muted px-1 py-0.5">{activeTag}</code>{' '}
              yet — switch to All types to use another clip.
            </p>
          ) : serviceFilter !== 'all' ? (
            <p className="mt-1 text-xs">Try All services.</p>
          ) : null}
        </div>
      ) : (
        <div className="grid max-h-80 grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3">
          {visible.map((asset) => (
            <AssetTile
              key={asset.id}
              asset={asset}
              selected={selectedIds.includes(asset.id)}
              serviceMatch={serviceLinked.has(asset.id)}
              onClick={() => toggle(asset.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AssetTile({
  asset,
  selected,
  serviceMatch,
  onClick,
}: {
  asset: Asset;
  selected: boolean;
  serviceMatch: boolean;
  onClick: () => void;
}) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const thumb =
    !thumbnailFailed && asset.thumbnailUrl
      ? asset.thumbnailUrl
      : asset.type === 'image'
        ? asset.blobUrl
        : null;
  // Older uploads and imported clips can have no generated poster. Fall back
  // to the first frame of the source video so those clips remain selectable
  // by sight instead of rendering as an empty play-icon tile. Seeking a
  // preloaded video never paints a frame in Safari, so this defers to the
  // shared VideoThumbnail (autoplay + muted, paused on the first frame) that
  // the Claire clip picker already uses.
  const videoPreviewUrl =
    !thumb && asset.type === 'video' && asset.blobUrl ? asset.blobUrl : null;
  return (
    <button
      type="button"
      onClick={onClick}
      title={asset.name}
      aria-pressed={selected}
      className={cn(
        'group overflow-hidden rounded-lg border-2 bg-muted text-left transition-all',
        selected
          ? 'border-primary bg-primary/5'
          : 'border-transparent hover:border-border'
      )}
    >
      <div className="relative aspect-video overflow-hidden">
        {thumb ? (
          <img
            src={thumb}
            alt={asset.name}
            className="size-full object-cover"
            onError={() => setThumbnailFailed(true)}
          />
        ) : videoPreviewUrl ? (
          <VideoThumbnail src={videoPreviewUrl} className="size-full" />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            <Play className="size-5" />
          </div>
        )}
        {selected && (
          <div className="absolute left-1.5 top-1.5 grid size-5 place-items-center rounded border border-primary bg-primary text-primary-foreground shadow-sm">
            <Check className="size-3.5" />
          </div>
        )}
        {serviceMatch && (
          <span className="absolute right-1.5 top-1.5 rounded bg-primary/90 px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
            Service match
          </span>
        )}
        {asset.duration && (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
            {formatClipDuration(asset.duration)}
          </span>
        )}
      </div>
      <p className="truncate bg-background p-2 text-xs font-medium">
        {asset.name}
      </p>
    </button>
  );
}

function formatClipDuration(value: number | string): string {
  const seconds = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(seconds) || seconds <= 0) return '--:--';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;
}

// ── Shared combobox ──────────────────────────────────────────────────────

function SearchCombobox({
  items,
  value,
  isLoading,
  onChange,
  placeholder,
  loadingText,
  emptyText,
  allowClear,
  onClear,
}: {
  items: { id: string; name: string; code?: string | null }[];
  value: string | null;
  isLoading: boolean;
  onChange: (id: string) => void;
  placeholder: string;
  loadingText: string;
  emptyText: string;
  allowClear?: boolean;
  onClear?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = items.find((s) => s.id === value) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
        >
          <span className={cn(!selected && 'text-muted-foreground')}>
            {selected ? selected.name : isLoading ? loadingText : placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput placeholder="Search…" />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {allowClear && (
                <CommandItem
                  value="__none__"
                  onSelect={() => {
                    onClear?.();
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 size-4',
                      !value ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  None
                </CommandItem>
              )}
              {items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.name}
                  onSelect={() => {
                    onChange(item.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 size-4',
                      value === item.id ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span className="flex-1">{item.name}</span>
                  {item.code && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {item.code}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── Organic copy helpers (ported from generate-video-dialog) ────────────────

function configBlockForOrganicCopy(
  copy: GeneratedOrganicCopy
): Partial<VideoDraftConfig> {
  switch (copy.kind) {
    case 'caption-tease':
      return { captionTease: copy.config };
    case 'fade-benefits':
      return { fadeBenefits: copy.config };
    case 'highlight-caption':
      // Reuses the fade-benefits render path; `highlight` switches the layer to
      // the solid brand-colour block treatment.
      return { fadeBenefits: { lines: copy.config.lines, highlight: true } };
    case 'aesthetic-line':
      return { aestheticLine: copy.config };
    case 'numbered-list':
      return { numberedList: copy.config };
    case 'ins-outs':
      return { insOuts: copy.config };
    case 'question-cta':
      return { questionCta: copy.config };
    case 'curiosity-hook':
      // Reuses the question-cta render path (top claim + bottom CTA line).
      return { questionCta: copy.config };
    case 'improves':
      return { improves: copy.config };
    case 'step-timer':
      return { stepTimer: copy.config };
    case 'time-progress':
      return { timeProgress: copy.config };
    case 'poll':
      return { poll: copy.config };
    case 'myth-fact':
      return { mythFact: copy.config };
    case 'versus':
      return { versus: copy.config };
    case 'price-reveal':
      return { priceReveal: copy.config };
    case 'client-question':
      return { clientQuestion: copy.config };
    case 'come-with-me':
      return { comeWithMe: copy.config };
  }
}

function deriveOrganicTitle(copy: GeneratedOrganicCopy): string {
  const truncate = (s: string, max = 80) => {
    const t = s.trim();
    return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
  };
  switch (copy.kind) {
    case 'caption-tease':
      return truncate(copy.config.headline) || 'Caption tease';
    case 'fade-benefits':
      return truncate(copy.config.lines[0]) || 'Fade-in benefits';
    case 'highlight-caption':
      return truncate(copy.config.lines[0]) || 'Highlight caption';
    case 'aesthetic-line':
      return truncate(copy.config.text) || 'Aesthetic line';
    case 'numbered-list':
      return truncate(copy.config.title) || 'Numbered list';
    case 'ins-outs':
      return truncate(copy.config.title) || 'INS + OUTS';
    case 'question-cta':
      return truncate(copy.config.question) || 'Question + Read caption';
    case 'curiosity-hook':
      return truncate(copy.config.question) || 'Curiosity hook';
    case 'improves':
      return `${copy.config.serviceName} improves`;
    case 'step-timer':
      return truncate(copy.config.title) || 'Step + Timer';
    case 'time-progress':
      return truncate(copy.config.caption) || 'Time-lapse progress';
    case 'poll':
      return truncate(copy.config.question) || 'Poll';
    case 'myth-fact':
      return truncate(copy.config.pairs[0]?.myth ?? '') || 'Myth → Fact';
    case 'versus':
      return `${copy.config.treatmentA} vs ${copy.config.treatmentB}`;
    case 'price-reveal':
      return truncate(copy.config.hook) || 'Price reveal';
    case 'client-question':
      return truncate(copy.config.question) || 'Client question';
    case 'come-with-me':
      return truncate(copy.config.title) || 'Come with me';
  }
}
