/**
 * User-Agent sent when fetching a customer's website.
 *
 * This MUST track a reasonably current Chrome release. A stale version string
 * is itself a bot signature: managed-WordPress hosts and CDN WAFs age out old
 * Chrome majors and start answering them with 403.
 *
 * That is what broke ENG-828. The previously pinned `Chrome/131.0.0.0`
 * (November 2024) began drawing 403s from ~7% of customer sites in August
 * 2026, while the byte-identical string with a current major got 200 and the
 * full page. The version was the only variable.
 *
 * Bumping this is a mitigation, not the fix — it will rot again. The actual
 * fix is that a blocked native fetch is no longer fatal: `analyzeWebsiteImpl`
 * falls through to the enrichment strategies (Firecrawl / Browser Use /
 * Browserbase), which are not subject to our User-Agent. Keep it that way.
 */
export const SCRAPER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
