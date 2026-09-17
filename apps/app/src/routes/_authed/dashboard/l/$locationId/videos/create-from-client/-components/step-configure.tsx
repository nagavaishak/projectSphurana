import { useBranchRoutes } from '@/lib/use-routes';
import type {
  CreateVideoInput,
  VideoDraftConfig,
} from '@borradh-workspace/api-client/types';
import {
  aiVoiceIdLabels,
  aiVoiceIdValues,
} from '@borradh-workspace/api-client/types';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Sparkles, Video } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useGetFaceGroupAssets } from '@/features/face-groups';
import { useGetActiveOrganization } from '@/features/organization';
import {
  useCreateVideo,
  useGenerateVideoScript,
  useQueueVideoExport,
} from '@/features/videos';
import { createVideoForm } from '@/features/videos/api/create-video';
import { generateVideoScriptForm } from '@/features/videos/api/generate-video-script';

import { useWizard } from './wizard-context';

/**
 * Labels come from the form declarations: every field on this screen feeds
 * `POST videos` ({@link createVideoForm}), and the variation ALSO steers
 * `POST videos/generate-script` ({@link generateVideoScriptForm}) — both
 * declare the same label for that one control, so neither can drift from it.
 */
const L = createVideoForm.labels;
const SCRIPT_L = generateVideoScriptForm.labels;

const TEMPLATE_VARIATIONS = [
  {
    id: 'before-after-1',
    name: 'Classic Transformation',
    description: 'Dramatic before, process, and after sequence',
  },
  {
    id: 'before-after-2',
    name: 'The Reveal',
    description: 'Build suspense before showing the transformation',
  },
  {
    id: 'before-after-3',
    name: 'Process & Results',
    description: 'Walk through the transformation step by step',
  },
];

export function StepConfigure() {
  const navigate = useNavigate();
  const routes = useBranchRoutes();
  const { faceGroupId, goBack } = useWizard();
  const { faceGroup, assets, isLoading } = useGetFaceGroupAssets(
    faceGroupId ?? ''
  );
  /**
   * The outro card is stamped with the business name. It used to be hardcoded
   * to `''`, which `outroOverlayConfigSchema` rejects (`businessName` is
   * `.min(1)`) — so every create-from-client video 400'd at the API. Read the
   * active org, with the same fallback the create-video wizard uses.
   */
  const { data: activeOrganization } = useGetActiveOrganization();

  const [title, setTitle] = useState('');
  const [variationId, setVariationId] = useState('before-after-1');
  const [narrationType, setNarrationType] = useState<
    'ai_voiceover' | 'recorded'
  >('ai_voiceover');
  const [aiVoiceId, setAiVoiceId] = useState<string>(aiVoiceIdValues[0] ?? '');
  const [scriptText, setScriptText] = useState('');

  const { generateScript, isGenerating } = useGenerateVideoScript({
    onSuccess: (data) => {
      setScriptText(data.scriptText);
      toast.success('Script generated');
    },
    onError: () => toast.error('Failed to generate script'),
  });

  const { createVideoAsync, isCreating } = useCreateVideo();
  const { queueExport, isQueuing } = useQueueVideoExport({
    onSuccess: () => {
      toast.success('Video queued for rendering');
      navigate({ to: routes.videos });
    },
  });

  const handleGenerateScript = () => {
    generateScript({ templateId: 'before-after', variationId });
  };

  const beforeAssets = assets.filter((a) => a.role === 'before');
  const afterAssets = assets.filter((a) => a.role === 'after');

  const handleCreateAndRender = async () => {
    if (!title.trim()) {
      toast.error('Please enter a title');
      return;
    }

    const bRollClips = [
      ...beforeAssets.map((a, idx) => ({
        assetId: a.assetId,
        order: idx,
        clipType: 'before' as const,
      })),
      ...afterAssets.map((a, idx) => ({
        assetId: a.assetId,
        order: beforeAssets.length + idx,
        clipType: 'after' as const,
      })),
    ];

    const pipOverlays: VideoDraftConfig['pipOverlays'] = [];
    const firstBeforeImage = beforeAssets.find((a) => a.asset.type === 'image');
    const firstAfterImage = afterAssets.find((a) => a.asset.type === 'image');

    if (firstBeforeImage) {
      pipOverlays.push({
        imageUrl: firstBeforeImage.asset.blobUrl,
        label: 'BEFORE',
        position: 'top-left',
        startSec: 1,
        durationSec: 4,
        sizePercent: 20,
      });
    }
    if (firstAfterImage) {
      pipOverlays.push({
        imageUrl: firstAfterImage.asset.blobUrl,
        label: 'AFTER',
        position: 'top-left',
        startSec: -5,
        durationSec: 4,
        sizePercent: 20,
      });
    }

    const draftConfig: VideoDraftConfig = {
      scriptText: scriptText || undefined,
      narrationType,
      aiVoiceId: narrationType === 'ai_voiceover' ? aiVoiceId : null,
      talkingHeadAssetId: null,
      talkingHeadUrl: null,
      bRollClips,
      captions: {
        enabled: true,
        position: 'bottom',
        fontFamily: 'Inter',
        fontSize: 42,
        textColor: '#ffffff',
        highlightColor: '#facc15',
        backgroundColor: '#000000',
        showBackground: true,
      },
      musicTrackId: 'tea-pop',
      musicVolume: 0.15,
      outro: {
        businessName: activeOrganization?.name || 'Your Business',
        ctaText: 'Book Now',
        backgroundOpacity: 0.85,
        backgroundColor: '#000000',
        textColor: '#ffffff',
        durationSec: 3,
      },
      orientation: 'portrait',
      pipOverlays: pipOverlays.length > 0 ? pipOverlays : undefined,
    };

    const input: CreateVideoInput = {
      title,
      templateId: 'before-after',
      variationId,
      serviceId: faceGroup?.serviceId ?? undefined,
      draftConfig,
    };

    try {
      const video = await createVideoAsync(input);
      queueExport({ videoId: video.id });
    } catch {
      toast.error('Failed to create video');
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[200px] w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="icon" onClick={goBack} className="mt-1">
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h2 className="text-2xl font-semibold">Configure Video</h2>
          <p className="mt-1 text-muted-foreground">
            Set up your before &amp; after video for{' '}
            {faceGroup?.clientName ?? 'this client'}.
          </p>
        </div>
      </div>

      <div className="flex gap-3">
        <Badge variant="secondary">
          {beforeAssets.length} before asset
          {beforeAssets.length !== 1 ? 's' : ''}
        </Badge>
        <Badge variant="secondary">
          {afterAssets.length} after asset{afterAssets.length !== 1 ? 's' : ''}
        </Badge>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="video-title" className="text-sm font-medium">
          {L.title}
        </label>
        <Input
          id="video-title"
          placeholder={`${faceGroup?.clientName ?? 'Client'}'s Transformation`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{SCRIPT_L.variationId}</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={variationId} onValueChange={setVariationId}>
            <SelectTrigger aria-label={SCRIPT_L.variationId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TEMPLATE_VARIATIONS.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name} &mdash; {v.description}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{L.narrationType}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select
            value={narrationType}
            onValueChange={(v) =>
              setNarrationType(v as 'ai_voiceover' | 'recorded')
            }
          >
            <SelectTrigger aria-label={L.narrationType}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ai_voiceover">AI Voiceover</SelectItem>
              <SelectItem value="recorded">Recorded Talking Head</SelectItem>
            </SelectContent>
          </Select>

          {narrationType === 'ai_voiceover' && (
            <Select value={aiVoiceId} onValueChange={setAiVoiceId}>
              <SelectTrigger aria-label={L.aiVoiceId}>
                <SelectValue placeholder="Select voice" />
              </SelectTrigger>
              <SelectContent>
                {aiVoiceIdValues.map((v) => (
                  <SelectItem key={v} value={v}>
                    {aiVoiceIdLabels[v as keyof typeof aiVoiceIdLabels]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label htmlFor="script" className="text-sm font-medium">
                {L.scriptText}
              </label>
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerateScript}
                disabled={isGenerating}
              >
                {isGenerating ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Sparkles className="size-3" />
                )}
                {isGenerating ? 'Generating...' : 'AI Generate'}
              </Button>
            </div>
            <Textarea
              id="script"
              placeholder="Write your script or use AI to generate one..."
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
              rows={4}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3 pt-2">
        <Button
          size="lg"
          onClick={handleCreateAndRender}
          disabled={isCreating || isQueuing || !title.trim()}
        >
          {isCreating || isQueuing ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {isCreating ? 'Creating...' : 'Queuing...'}
            </>
          ) : (
            <>
              <Video className="size-4" />
              Create &amp; Render Video
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
