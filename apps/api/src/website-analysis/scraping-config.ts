import { apiEnv } from '@borradh-workspace/env/api';
import type { MergedStrategyConfig } from '@borradh-workspace/features/website-analysis';

/**
 * Credentials for the website-scraping strategy ladder (Firecrawl →
 * Browserbase → browser-use). Read at call time rather than module load so a
 * test that stubs `apiEnv` still sees its stub.
 *
 * Was `WebsiteAnalysisController.getScrapingConfig`. It reads process
 * configuration and touches nothing on the request, so it is not a controller
 * concern at all (Gate 5).
 */
export function getScrapingConfig(): MergedStrategyConfig {
  return {
    firecrawlApiKey: apiEnv.FIRECRAWL_API_KEY,
    browserbaseApiKey: apiEnv.BROWSERBASE_API_KEY,
    browserbaseProjectId: apiEnv.BROWSERBASE_PROJECT_ID,
    browserUseApiKey: apiEnv.BROWSER_USE_API_KEY,
  };
}
