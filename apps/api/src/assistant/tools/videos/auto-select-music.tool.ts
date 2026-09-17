import { getTemplateById } from '@borradh-workspace/features/videos/templates';
import { z } from 'zod';
import { ApiFetchError, defineTool } from '../../tool-factory/index.js';

const safeExternalId = z.string().regex(/^[\w-]+$/, 'Invalid ID format');

/**
 * Mood-to-BPM mapping for auto-selecting music tracks. Lifted verbatim from
 * the legacy `video-tools.ts`. Template type determines the mood, which maps
 * to a BPM range.
 */
const TEMPLATE_MOOD_MAP: Record<
  string,
  { mood: string; bpmRange: [number, number] }
> = {
  authority: { mood: 'calm, professional', bpmRange: [80, 105] },
  testimonial: { mood: 'warm, emotional', bpmRange: [80, 100] },
  'before-after': { mood: 'upbeat, transformative', bpmRange: [100, 125] },
  educational: { mood: 'light, informative', bpmRange: [90, 110] },
  offer: { mood: 'energetic, urgent', bpmRange: [105, 130] },
  // Organic (social-first) templates — trend-friendly, upbeat moods.
  'caption-tease': { mood: 'trendy, upbeat', bpmRange: [100, 125] },
  'ins-outs': { mood: 'playful, punchy', bpmRange: [100, 128] },
  'question-cta': { mood: 'curious, light', bpmRange: [95, 120] },
  improves: { mood: 'uplifting, modern', bpmRange: [100, 122] },
};

interface AutoSelectMusicOutput {
  trackId?: string;
  trackName?: string;
  mood?: string;
  bpm?: number;
  videoId?: string;
  error?: string;
}

/**
 * `videos_autoSelectMusic` — pick a music track matching the template mood.
 *
 * Ported verbatim from the legacy `autoSelectMusic` tool.
 */
export const autoSelectMusicTool = defineTool<
  { videoId: string; templateId: string },
  AutoSelectMusicOutput
>({
  feature: 'videos',
  action: 'autoSelectMusic',
  description:
    'Automatically select a music track that matches the template mood. ' +
    'Returns the selected track ID and name.',
  inputSchema: z.object({
    videoId: z.string().min(1).describe('The draft video ID'),
    templateId: safeExternalId.describe('Template type for mood matching'),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Selecting music' },
  execute: async ({ videoId, templateId }, ctx) => {
    const template = getTemplateById(templateId);
    if (!template) {
      return { data: { error: `Template "${templateId}" not found` } };
    }

    const tracks = template.musicTracks ?? [];
    if (tracks.length === 0) {
      return { data: { error: 'No music tracks available' } };
    }

    const moodConfig = TEMPLATE_MOOD_MAP[templateId];
    let selectedTrack = tracks[0];

    if (moodConfig) {
      const [minBpm, maxBpm] = moodConfig.bpmRange;
      const matching = tracks.filter(
        (t) => t.bpm && t.bpm >= minBpm && t.bpm <= maxBpm
      );
      if (matching.length > 0) {
        const pick = matching[Math.floor(Math.random() * matching.length)];
        if (pick) selectedTrack = pick;
      }
    }

    if (!selectedTrack) {
      return { data: { error: 'No music tracks available' } };
    }

    const cdnBase = ctx.cdnUrl ?? '';
    const musicUrl = cdnBase
      ? `${cdnBase}${selectedTrack.path}`
      : selectedTrack.path;

    try {
      await ctx.apiFetch(`videos/${videoId}`, {
        method: 'PUT',
        body: {
          draftConfig: {
            musicTrackId: selectedTrack.id,
            musicUrl,
            musicVolume: 0.15,
          },
        },
      });

      return {
        data: {
          trackId: selectedTrack.id,
          trackName: selectedTrack.name,
          mood: moodConfig?.mood ?? 'default',
          bpm: selectedTrack.bpm,
          videoId,
        },
      };
    } catch (error) {
      const isExpectedClientError =
        error instanceof ApiFetchError &&
        error.status >= 400 &&
        error.status < 500;
      if (!isExpectedClientError) {
        ctx.reportIssue('Failed to save selected music track', { error });
      }
      return {
        data: {
          error:
            error instanceof Error ? error.message : 'Failed to select music',
        },
      };
    }
  },
});
