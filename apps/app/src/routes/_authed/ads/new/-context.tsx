import type { Video } from '@/features/videos/api/types';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useState,
} from 'react';

/**
 * Minimal media type for the ad wizard - works for both videos and assets
 */
export interface SelectedMedia {
  id: string;
  title: string | null;
  thumbnailUrl: string | null;
  blobUrl: string | null;
  status?: string;
  durationMs?: string | null;
}

/**
 * Selected social post for the "use existing post" flow
 */
export interface SelectedPost {
  id: string;
  title: string;
  caption: string | null;
  mediaType: string;
  mediaUrl: string;
  thumbnailUrl: string | null;
  platforms: string[];
}

interface AdWizardContextValue {
  // Ad source: 'new' (create from scratch) or 'existing_post' (boost a post)
  adSource: 'new' | 'existing_post';
  setAdSource: (source: 'new' | 'existing_post') => void;

  // Selected media (video or asset) — for "new" flow
  selectedVideo: SelectedMedia | null;
  setSelectedVideo: (video: SelectedMedia | Video | null) => void;

  // Selected social post — for "existing_post" flow
  selectedPost: SelectedPost | null;
  setSelectedPost: (post: SelectedPost | null) => void;

  // Preview data (for live preview)
  previewData: {
    headline: string;
    primaryText: string;
    description: string;
    callToAction: string;
    videoThumbnail: string | null;
    videoTitle: string | null;
  };
  updatePreviewData: (
    data: Partial<AdWizardContextValue['previewData']>
  ) => void;

  // Whether AI content generation is in progress (blocks publish)
  isGeneratingContent: boolean;
  setIsGeneratingContent: (value: boolean) => void;

  // Selected campaign's follow-up type (from campaign config)
  selectedCampaignFollowUpType: string | undefined;
  setSelectedCampaignFollowUpType: (value: string | undefined) => void;

  // Selected campaign's config details
  selectedCampaignConfig: {
    conversionDestination?: string | null;
  } | null;
  setSelectedCampaignConfig: (
    config: {
      conversionDestination?: string | null;
    } | null
  ) => void;
}

const AdWizardContext = createContext<AdWizardContextValue | null>(null);

export function AdWizardProvider({ children }: { children: ReactNode }) {
  const [adSource, setAdSource] = useState<'new' | 'existing_post'>('new');
  const [selectedVideo, setSelectedVideo] = useState<SelectedMedia | null>(
    null
  );
  const [selectedPost, setSelectedPostState] = useState<SelectedPost | null>(
    null
  );
  const [isGeneratingContent, setIsGeneratingContent] = useState(false);
  const [selectedCampaignFollowUpType, setSelectedCampaignFollowUpType] =
    useState<string | undefined>(undefined);
  const [selectedCampaignConfig, setSelectedCampaignConfig] = useState<{
    conversionDestination?: string | null;
  } | null>(null);
  const [previewData, setPreviewData] = useState({
    headline: '',
    primaryText: '',
    description: '',
    callToAction: 'LEARN_MORE',
    videoThumbnail: null as string | null,
    videoTitle: null as string | null,
  });

  const updatePreviewData = useCallback((data: Partial<typeof previewData>) => {
    setPreviewData((prev) => ({ ...prev, ...data }));
  }, []);

  // Sync post selection to preview
  const handleSetSelectedPost = useCallback((post: SelectedPost | null) => {
    setSelectedPostState(post);
    if (post) {
      setPreviewData((prev) => ({
        ...prev,
        videoThumbnail: post.thumbnailUrl || post.mediaUrl || null,
        videoTitle: post.title,
        primaryText: post.caption || '',
      }));
    }
  }, []);

  // Sync video selection to preview
  const handleSetSelectedVideo = useCallback(
    (video: SelectedMedia | Video | null) => {
      if (video) {
        // Normalize to SelectedMedia format
        const rawDurationMs = 'durationMs' in video ? video.durationMs : null;
        const media: SelectedMedia = {
          id: video.id,
          title: video.title,
          thumbnailUrl: video.thumbnailUrl || null,
          blobUrl: video.blobUrl || null,
          status: 'status' in video ? video.status : 'ready',
          durationMs:
            rawDurationMs !== null && rawDurationMs !== undefined
              ? String(rawDurationMs)
              : null,
        };
        setSelectedVideo(media);
        setPreviewData((prev) => ({
          ...prev,
          videoThumbnail: media.thumbnailUrl || media.blobUrl || null,
          videoTitle: media.title,
        }));
      } else {
        setSelectedVideo(null);
      }
    },
    []
  );

  return (
    <AdWizardContext.Provider
      value={{
        adSource,
        setAdSource,
        selectedVideo,
        setSelectedVideo: handleSetSelectedVideo,
        selectedPost,
        setSelectedPost: handleSetSelectedPost,
        previewData,
        updatePreviewData,
        isGeneratingContent,
        setIsGeneratingContent,
        selectedCampaignFollowUpType,
        setSelectedCampaignFollowUpType,
        selectedCampaignConfig,
        setSelectedCampaignConfig,
      }}
    >
      {children}
    </AdWizardContext.Provider>
  );
}

export function useAdWizard() {
  const context = useContext(AdWizardContext);
  if (!context) {
    throw new Error('useAdWizard must be used within an AdWizardProvider');
  }
  return context;
}
