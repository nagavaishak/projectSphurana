import { z } from 'zod';
import { ApiFetchError, defineTool } from '../../tool-factory/index.js';

const safeExternalId = z.string().regex(/^[\w-]+$/, 'Invalid ID format');

const GENERATE_SCRIPT_HARD_BLOCKS = ['noFabricatedResultClaims'] as const;

interface GenerateVideoScriptOutput {
  scriptText?: string;
  videoId?: string;
  hardBlock?: { code: string; message: string };
  error?: string;
}

/**
 * `videos_generateVideoScript` — AI-generate a script for a draft video.
 *
 * Ported verbatim from the legacy `generateVideoScript` tool. The legacy
 * implementation calls the existing `videos/generate-script` endpoint, which
 * uses whatever LLM provider the video service was wired with (OpenAI in
 * v2). Per track-c10 — "don't migrate" — we keep that.
 *
 * Non-destructive at the factory level. We DO run
 * `noFabricatedResultClaims` manually on the returned script before persisting
 * it — the validator's purpose is to catch fabricated outcome claims, and a
 * generated script is exactly the kind of content that can drift into them.
 * Mirrors C-05's `confirmLaunchAd` pattern of calling `ctx.runHardBlocks`
 * directly inside a non-destructive tool.
 */
export const generateVideoScriptTool = defineTool<
  {
    videoId: string;
    templateId: string;
    variationId: string;
    serviceId?: string;
  },
  GenerateVideoScriptOutput
>({
  feature: 'videos',
  action: 'generateVideoScript',
  description:
    'AI-generate a video script for the given template and service. ' +
    'Returns the generated script text.',
  inputSchema: z.object({
    videoId: z
      .string()
      .min(1)
      .describe('The draft video ID to generate a script for'),
    templateId: safeExternalId.describe('The template ID'),
    variationId: safeExternalId.describe('The variation ID'),
    serviceId: z
      .string()
      .min(1)
      .optional()
      .describe('Service ID for context (cuid2 — pass verbatim)'),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Generating script' },
  execute: async ({ videoId, templateId, variationId, serviceId }, ctx) => {
    try {
      const scriptResult = await ctx.apiFetch<{ scriptText: string }>(
        'videos/generate-script',
        {
          method: 'POST',
          body: { templateId, variationId, serviceId },
        }
      );

      // Backstop: catch fabricated result claims in the generated script
      // before we persist it onto the draft. The skill prompt also tells the
      // model to decline fabricated content; this is defense-in-depth.
      const hbResult = await ctx.runHardBlocks(
        GENERATE_SCRIPT_HARD_BLOCKS,
        { scriptText: scriptResult.scriptText },
        ctx
      );
      if (!hbResult.pass) {
        return {
          data: {
            videoId,
            hardBlock: { code: hbResult.code, message: hbResult.message },
          },
          presentation: {
            type: 'hard_block_violation',
            code: hbResult.code,
            message: hbResult.message,
          },
        };
      }

      await ctx.apiFetch(`videos/${videoId}`, {
        method: 'PUT',
        body: { draftConfig: { scriptText: scriptResult.scriptText } },
      });

      return {
        data: {
          scriptText: scriptResult.scriptText,
          videoId,
        },
      };
    } catch (error) {
      const isExpectedClientError =
        error instanceof ApiFetchError &&
        error.status >= 400 &&
        error.status < 500;
      if (!isExpectedClientError) {
        ctx.reportIssue('Failed to generate video script', { error });
      }
      return {
        data: {
          error:
            error instanceof Error
              ? error.message
              : 'Failed to generate video script',
        },
      };
    }
  },
});
