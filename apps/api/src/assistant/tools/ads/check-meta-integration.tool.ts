import { getMetaIntegrationResponseSchema } from '@borradh-workspace/contracts';
import { z } from 'zod';
import { ApiFetchError, defineTool } from '../../tool-factory/index.js';

interface CheckMetaIntegrationOutput {
  connected: boolean;
  configured: boolean;
  tokenStatus: string | null;
  /** `meta_ads_integration.ad_account_name` is a nullable column. */
  adAccountName?: string | null;
  /** `meta_ads_page.page_name` / `.page_username` are nullable columns. */
  defaultPage?: { name: string | null; platform: string } | null;
  pages?: Array<{
    name: string | null;
    platform: string;
    username: string | null;
  }>;
  /**
   * True when the integration lookup itself failed (network/5xx/timeout) so
   * `connected: false` is "couldn't verify", NOT a confirmed disconnection.
   * The model must not tell the user Meta is disconnected when this is set.
   */
  checkFailed?: boolean;
  message?: string;
}

/**
 * `meta_ads_checkMetaIntegration` — connection + configuration health.
 *
 * Ported from the legacy `checkMetaIntegration` tool (`ad-tools.ts`).
 * Read-only.
 *
 * A genuine "not connected" is a 200 response with `integration: null`. A
 * thrown error (network/5xx/timeout, or an auth 4xx) is a FAILED LOOKUP, not a
 * disconnection — reporting it as `connected: false` made Claire tell users
 * with Meta connected that they aren't. Those now return `checkFailed: true`
 * so the model asks the user to retry instead of claiming disconnection.
 */
export const checkMetaIntegrationTool = defineTool<
  Record<string, never>,
  CheckMetaIntegrationOutput
>({
  feature: 'meta-ads',
  action: 'checkMetaIntegration',
  description:
    'Check if the organization has Meta Ads connected and configured. ' +
    'Returns connection status, configuration status, token health, and ad account info. ' +
    'If not connected, tells the user to go to Settings → Integrations.',
  inputSchema: z.object({}),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Checking Meta connection' },
  execute: async (_input, ctx) => {
    try {
      const data = await ctx.apiFetch('integrations/meta-ads/integration', {
        schema: getMetaIntegrationResponseSchema,
      });

      const integration = data.integration;

      if (!integration) {
        return {
          data: {
            connected: false,
            configured: false,
            tokenStatus: null,
            message:
              'Meta Ads is not connected. The user needs to go to Settings → Integrations to connect their Meta Ads account.',
          },
        };
      }

      if (integration.tokenStatus === 'needs_reconnect') {
        return {
          data: {
            connected: true,
            configured: integration.configurationStatus === 'configured',
            tokenStatus: 'needs_reconnect',
            message:
              'Meta Ads token has expired and needs to be reconnected. The user should go to Settings → Integrations to re-authorize.',
          },
        };
      }

      if (integration.configurationStatus !== 'configured') {
        return {
          data: {
            connected: true,
            configured: false,
            tokenStatus: integration.tokenStatus,
            message:
              'Meta Ads is connected but not fully configured. The user needs to select an ad account and page in Settings → Integrations.',
          },
        };
      }

      return {
        data: {
          connected: true,
          configured: true,
          tokenStatus: integration.tokenStatus,
          adAccountName: integration.adAccountName,
          defaultPage: integration.defaultPage
            ? {
                name: integration.defaultPage.pageName,
                platform: integration.defaultPage.platform,
              }
            : null,
          pages: integration.pages
            .filter((p) => p.isActive)
            .map((p) => ({
              name: p.pageName,
              platform: p.platform,
              username: p.pageUsername,
            })),
        },
      };
    } catch (error) {
      // A thrown error means the lookup FAILED — we do not know the connection
      // state. Reporting `connected: false` here is what made Claire tell
      // connected users that Meta isn't linked. Return `checkFailed: true` so
      // the model retries rather than claiming a disconnection. Non-4xx
      // failures (5xx/network) are also surfaced to Sentry.
      const isExpectedClientError =
        error instanceof ApiFetchError &&
        error.status >= 400 &&
        error.status < 500;
      if (!isExpectedClientError) {
        ctx.reportIssue('Meta integration lookup failed', { error });
      }
      return {
        data: {
          connected: false,
          configured: false,
          checkFailed: true,
          tokenStatus: null,
          message:
            'Could not check the Meta connection right now — this is a ' +
            'temporary error, NOT a sign that Meta is disconnected. Do not ' +
            'tell the user Meta is disconnected; ask them to try again in a moment.',
        },
      };
    }
  },
});
