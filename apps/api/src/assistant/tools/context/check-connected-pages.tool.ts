import { getMetaIntegrationResponseSchema } from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

interface CheckConnectedPagesOutput {
  connected: boolean;
  availablePlatforms: string[];
  message?: string;
  /**
   * `pageName` / `pageUsername` are nullable columns on `meta_ads_page`. The
   * hand-written response type this replaces declared both non-null; nothing
   * dereferenced them (they are passed straight through), so that was a type
   * lie rather than a defect — but the honest shape is nullable.
   */
  pages?: Array<{
    name: string | null;
    platform: string;
    username: string | null;
  }>;
}

/**
 * `context_checkConnectedPages` — verify Meta page connectivity.
 *
 * Ported from the legacy `checkConnectedPages` tool in `context-tools.ts`.
 */
export const checkConnectedPagesTool = defineTool<
  Record<string, never>,
  CheckConnectedPagesOutput
>({
  feature: 'context',
  action: 'checkConnectedPages',
  description:
    'Check if the organization has connected Facebook and/or Instagram pages. ' +
    'Returns which platforms are available for posting. Call this before creating ' +
    'a social post so you can warn the user if pages are missing.',
  inputSchema: z.object({}),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Checking connected pages' },
  execute: async (_input, ctx) => {
    const data = await ctx.apiFetch('integrations/meta-ads/integration', {
      schema: getMetaIntegrationResponseSchema,
    });

    if (!data.integration) {
      return {
        data: {
          connected: false,
          availablePlatforms: [],
          message:
            'Meta integration is not set up. The user needs to go to Settings → Integrations to connect their Facebook/Instagram pages.',
        },
      };
    }

    const integration = data.integration;

    if (integration.tokenStatus === 'needs_reconnect') {
      return {
        data: {
          connected: false,
          availablePlatforms: [],
          message:
            'Meta integration needs to be reconnected. The user should go to Settings → Integrations to re-authorize.',
        },
      };
    }

    const activePages = integration.pages.filter((p) => p.isActive);
    const hasFacebook = activePages.some((p) => p.platform === 'facebook');
    const hasInstagram = activePages.some((p) => p.platform === 'instagram');
    const availablePlatforms: string[] = [];
    if (hasFacebook) availablePlatforms.push('facebook');
    if (hasInstagram) availablePlatforms.push('instagram');

    if (availablePlatforms.length === 0) {
      return {
        data: {
          connected: true,
          availablePlatforms: [],
          message:
            'Meta is connected but no active pages found. The user should add pages in Settings → Integrations.',
        },
      };
    }

    return {
      data: {
        connected: true,
        availablePlatforms,
        pages: activePages.map((p) => ({
          name: p.pageName,
          platform: p.platform,
          username: p.pageUsername,
        })),
      },
    };
  },
});
