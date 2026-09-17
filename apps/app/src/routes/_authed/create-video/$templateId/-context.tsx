import {
  type OrganizationBrandResponse,
  useGetActiveOrganization,
  useGetOrganization,
  useGetOrganizationBrand,
} from '@/features/organization';
import { useGenerateVideoScript } from '@/features/videos';
import {
  type TemplateVariation,
  getTemplateById,
} from '@borradh-workspace/features/videos/templates';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { OrgVideoDefaults } from './-schema';
import {
  type SlotConfig,
  buildSlotsFromClipGuidance,
  getDefaultSlots,
} from './data/-slot-config';

interface VideoCreationContextValue {
  templateId: string;

  // Upload state (for web upload)
  talkingHeadUrl: string;
  setTalkingHeadUrl: (url: string) => void;
  isUploading: boolean;
  setIsUploading: (uploading: boolean) => void;
  uploadProgress: number;
  setUploadProgress: (progress: number) => void;

  // Mobile upload detection
  hasMobileUpload: boolean;
  setHasMobileUpload: (hasMobile: boolean) => void;

  // Draft video ID (created early at the service step)
  draftVideoId: string | null;
  setDraftVideoId: (id: string | null) => void;

  // Narration mode (tracked here so page.tsx can swap preview panes)
  narrationMode: 'recorded' | 'ai_voiceover' | 'text_only';
  setNarrationMode: (mode: 'recorded' | 'ai_voiceover' | 'text_only') => void;

  // Organization data
  organizationId: string | null;
  organizationName: string | null;
  brand: OrganizationBrandResponse | null;
  isBrandLoading: boolean;
  /** Org-level video defaults new videos inherit (caption + music settings) */
  videoDefaults: OrgVideoDefaults | null;

  // Randomly selected variation for this session
  selectedVariation: TemplateVariation | null;

  // Whether this template supports AI voiceover (false for testimonial)
  supportsAiVoiceover: boolean;

  // Slot configs derived from the selected variation
  slotConfigs: SlotConfig[];

  // AI script generation (started when user advances past the service step)
  generatedScript: string | null;
  isGeneratingScript: boolean;
  hasGeneratedScript: boolean;
  startScriptGeneration: (serviceId?: string) => void;
  regenerateScript: (
    modeOverride?: 'recorded' | 'ai_voiceover' | 'text_only'
  ) => void;
}

const VideoCreationContext = createContext<VideoCreationContextValue | null>(
  null
);

export function VideoCreationProvider({
  children,
  templateId,
}: {
  children: ReactNode;
  templateId: string;
}) {
  const [talkingHeadUrl, setTalkingHeadUrl] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [hasMobileUpload, setHasMobileUpload] = useState(false);

  // Draft video ID (created early at the service step)
  const [draftVideoId, setDraftVideoId] = useState<string | null>(null);

  // Select the first variation for this template (stable across re-renders and strict mode)
  const variationRef = useRef<TemplateVariation | null | undefined>(undefined);
  if (variationRef.current === undefined) {
    const template = getTemplateById(templateId);
    if (!template || template.variations.length === 0) {
      variationRef.current = null;
    } else {
      variationRef.current = template.variations[0];
    }
  }
  const selectedVariation = variationRef.current;

  // Narration mode (synced from form so page.tsx can swap preview panes)
  // Auto-set from variation's default narrationMode if specified
  const [narrationMode, setNarrationMode] = useState<
    'recorded' | 'ai_voiceover' | 'text_only'
  >(selectedVariation?.narrationMode ?? 'recorded');

  // Organization data
  const { data: activeOrg } = useGetActiveOrganization();
  const { brand, isLoading: isBrandLoading } = useGetOrganizationBrand(
    activeOrg?.id ?? ''
  );
  // Full org record carries the explicit video defaults (caption + music).
  const { organization: fullOrg } = useGetOrganization(activeOrg?.id ?? '');
  const videoDefaults: OrgVideoDefaults | null = useMemo(
    () =>
      fullOrg
        ? {
            captionColor: fullOrg.videoCaptionColor,
            captionFont: fullOrg.videoCaptionFont,
            // The DB column is plain `text` (the TS `$type<'top'|'center'|'bottom'>`
            // assertion is compile-time only). Any unexpected legacy value would
            // slip into the create-video payload and trip the strict zod enum
            // on the server, surfacing as "Failed to save". Coerce anything
            // unrecognised to null so the form's `?? 'bottom'` fallback wins.
            captionPosition:
              fullOrg.videoCaptionPosition === 'top' ||
              fullOrg.videoCaptionPosition === 'center' ||
              fullOrg.videoCaptionPosition === 'bottom'
                ? fullOrg.videoCaptionPosition
                : null,
            // Legacy orgs from migration 0016 still carry an integer 50 here
            // (pre-0017 the column was a 0-100 percentage); treat any out-of-range
            // value as unset so the per-video default of 0.05 kicks in.
            musicVolume:
              fullOrg.videoMusicVolume != null &&
              fullOrg.videoMusicVolume >= 0 &&
              fullOrg.videoMusicVolume <= 1
                ? fullOrg.videoMusicVolume
                : null,
          }
        : null,
    [fullOrg]
  );

  // Determine if this template supports AI voiceover
  const supportsAiVoiceover = useMemo(() => {
    const template = getTemplateById(templateId);
    return template?.supportsAiVoiceover !== false;
  }, [templateId]);

  // Build slot configs from the selected variation's clipGuidance
  const slotConfigs = useMemo(
    () =>
      selectedVariation?.clipGuidance
        ? buildSlotsFromClipGuidance(
            templateId,
            selectedVariation.clipGuidance,
            narrationMode
          )
        : getDefaultSlots(),
    [templateId, selectedVariation, narrationMode]
  );

  // AI script generation — deferred until user advances past the service step
  const [generatedScript, setGeneratedScript] = useState<string | null>(null);
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [hasGeneratedScript, setHasGeneratedScript] = useState(false);
  const selectedServiceIdRef = useRef<string | undefined>(undefined);

  const { generateScriptAsync } = useGenerateVideoScript();

  const fireGeneration = useCallback(
    async (
      tId: string,
      vId: string,
      sId?: string,
      mode?: 'recorded' | 'ai_voiceover' | 'text_only'
    ) => {
      setIsGeneratingScript(true);
      setHasGeneratedScript(false);
      setGeneratedScript(null);
      try {
        const data = await generateScriptAsync({
          templateId: tId,
          variationId: vId,
          serviceId: sId,
          narrationMode: mode,
        });
        setGeneratedScript(data.scriptText);
        setHasGeneratedScript(true);
      } catch {
        // Fallback to raw template handled in ScriptStep
      } finally {
        setIsGeneratingScript(false);
      }
    },
    [generateScriptAsync]
  );

  // Called when user advances past the service step — triggers generation with the selected service
  const startScriptGeneration = useCallback(
    (serviceId?: string) => {
      if (!selectedVariation?.id || !templateId) return;
      selectedServiceIdRef.current = serviceId;
      fireGeneration(
        templateId,
        selectedVariation.id,
        serviceId,
        narrationMode
      );
    },
    [selectedVariation, templateId, fireGeneration, narrationMode]
  );

  const regenerateScript = useCallback(
    (modeOverride?: 'recorded' | 'ai_voiceover' | 'text_only') => {
      if (!selectedVariation?.id || !templateId) return;
      fireGeneration(
        templateId,
        selectedVariation.id,
        selectedServiceIdRef.current,
        modeOverride ?? narrationMode
      );
    },
    [selectedVariation, templateId, fireGeneration, narrationMode]
  );

  return (
    <VideoCreationContext.Provider
      value={{
        templateId,
        talkingHeadUrl,
        setTalkingHeadUrl,
        isUploading,
        setIsUploading,
        uploadProgress,
        setUploadProgress,
        hasMobileUpload,
        setHasMobileUpload,
        draftVideoId,
        setDraftVideoId,
        narrationMode,
        setNarrationMode,
        organizationId: activeOrg?.id ?? null,
        organizationName: activeOrg?.name ?? null,
        brand,
        isBrandLoading,
        videoDefaults,
        selectedVariation,
        supportsAiVoiceover,
        slotConfigs,
        generatedScript,
        isGeneratingScript,
        hasGeneratedScript,
        startScriptGeneration,
        regenerateScript,
      }}
    >
      {children}
    </VideoCreationContext.Provider>
  );
}

export function useVideoCreation() {
  const context = useContext(VideoCreationContext);
  if (!context) {
    throw new Error(
      'useVideoCreation must be used within a VideoCreationProvider'
    );
  }
  return context;
}
