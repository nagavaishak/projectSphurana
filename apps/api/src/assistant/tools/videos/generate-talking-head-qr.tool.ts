import {
  createMobileUploadTokenResponseSchema,
  getVideoResponseSchema,
} from '@borradh-workspace/contracts';
import { logError } from '@borradh-workspace/observability';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

interface GenerateTalkingHeadQROutput {
  recordingUrl: string;
  videoId: string;
  instructions: string;
}

/**
 * `videos_generateTalkingHeadQR` — generate a QR-code URL for mobile
 * talking-head recording.
 *
 * Ported verbatim from the legacy `generateTalkingHeadQR` tool. The frontend
 * `QRCodeCard` renderer keys off the bare action name (resolved via the
 * controller's W-C02-E alias map) and turns the URL into a scannable QR.
 */
export const generateTalkingHeadQRTool = defineTool<
  { videoId: string },
  GenerateTalkingHeadQROutput
>({
  feature: 'videos',
  action: 'generateTalkingHeadQR',
  description:
    'Generate a QR code URL that the user can scan on their phone to ' +
    'record a talking head video. The QR links to the mobile recording page.',
  inputSchema: z.object({
    videoId: z.string().min(1).describe('The draft video ID'),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Generating QR code' },
  // Needed to mint the scoped upload token below.
  additionalAllowedPaths: [/^upload\/mobile-token$/],
  execute: async ({ videoId }, ctx) => {
    const appUrl = ctx.appUrl ?? '';

    // Mint a scoped upload token so a phone that ISN'T signed in can still
    // record from this QR (auth-free fallback, same as the create-video
    // wizard). The token carries the teleprompter script so the record screen
    // renders it without an authed video fetch. Signed-in phones ignore the
    // token and use their session. If any step fails we fall back to a
    // token-less link — a logged-in phone still works.
    let uploadToken: string | undefined;
    try {
      const video = await ctx.apiFetch(`videos/${videoId}`, {
        schema: getVideoResponseSchema,
      });
      const scriptText =
        video?.draftConfig && typeof video.draftConfig === 'object'
          ? (video.draftConfig.scriptText as string | undefined)
          : undefined;
      const minted = await ctx.apiFetch('upload/mobile-token', {
        method: 'POST',
        body: { videoId, scriptText },
        schema: createMobileUploadTokenResponseSchema,
      });
      uploadToken = minted.token;
    } catch (error) {
      logError('videos.generateTalkingHeadQR', error, { feature: 'videos' });
    }

    const recordingUrl = uploadToken
      ? `${appUrl}/record/${videoId}?uploadToken=${uploadToken}`
      : `${appUrl}/record/${videoId}`;

    const instructions =
      'Scan the QR code with your phone to open the recording page. ' +
      'Read the script from the teleprompter and record — no sign-in needed.';
    return {
      presentation: {
        type: 'qr_code' as const,
        recordingUrl,
        instructions,
      },
      data: {
        recordingUrl,
        videoId,
        instructions:
          'Scan the QR code with your phone to open the recording page. ' +
          'Read the script from the teleprompter and record — no sign-in needed.',
      },
    };
  },
});
