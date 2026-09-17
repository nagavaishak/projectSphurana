import { createLogger } from '@borradh-workspace/observability';

import type { ExtractedServiceData, StrategyResult } from './types.js';

const logger = createLogger('BrowserUseStrategy');

const BROWSER_USE_API = 'https://api.browser-use.com/api/v3';
const TASK_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 2_000;
// Per-request bound. The TASK_TIMEOUT_MS deadline is only checked between
// poll iterations, so a single hung request would otherwise stall the whole
// analysis job indefinitely.
const REQUEST_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

interface SessionResponse {
  id: string;
}

interface SessionPollResponse {
  status: string;
  output?: string;
  error?: string;
}

const TASK_PROMPT = (url: string) =>
  `Go to ${url}. Your goal is to find ALL services and prices offered by this business.

Steps:
1. Navigate to the homepage
2. Find and click on any "Services", "Treatments", "Prices", "Menu", or "What We Offer" page
3. If the site has a booking system or pricing page, navigate there too
4. Scroll down on each page to ensure all content is loaded
5. List EVERY service name and its price(s) you find

Return a comprehensive list like:
SERVICE: Botox
PRICE: 1 area £150, 2 areas £200, 3 areas £250

Include every service and every price point you can find. Do not summarise or skip any.`;

export async function runBrowserUseStrategy(
  websiteUrl: string,
  apiKey: string
): Promise<StrategyResult> {
  logger.info(`[browser-use] starting session for ${websiteUrl}`);

  const createRes = await fetchWithTimeout(`${BROWSER_USE_API}/sessions`, {
    method: 'POST',
    headers: {
      'X-Browser-Use-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ task: TASK_PROMPT(websiteUrl) }),
  });

  if (!createRes.ok) {
    const body = await createRes.text().catch(() => '');
    throw new Error(`Browser Use ${createRes.status}: ${body.slice(0, 300)}`);
  }

  const session = (await createRes.json()) as SessionResponse;
  if (!session.id) throw new Error('Browser Use: no session ID returned');

  logger.info(`[browser-use] session ${session.id} created, polling...`);

  const deadline = Date.now() + TASK_TIMEOUT_MS;
  let rawOutput: string | null = null;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    let pollRes: Response;
    try {
      pollRes = await fetchWithTimeout(
        `${BROWSER_USE_API}/sessions/${session.id}`,
        { headers: { 'X-Browser-Use-API-Key': apiKey } }
      );
    } catch {
      // Transient network/timeout error — let the deadline loop retry
      continue;
    }

    if (!pollRes.ok) {
      if (pollRes.status === 404) continue;
      continue;
    }

    const poll = (await pollRes.json()) as SessionPollResponse;

    if (['idle', 'stopped', 'finished', 'completed'].includes(poll.status)) {
      rawOutput = poll.output ?? '';
      break;
    }

    if (['error', 'timed_out', 'failed'].includes(poll.status)) {
      throw new Error(
        `Browser Use session failed: ${poll.error ?? poll.status}`
      );
    }
  }

  if (rawOutput === null) throw new Error('Browser Use session timed out');

  logger.info(
    `[browser-use] session complete, ${rawOutput.length} chars output`
  );

  let services: ExtractedServiceData[] = [];
  try {
    const jsonMatch = rawOutput.match(/\{[\s\S]*"services"[\s\S]*\}/);
    const json = jsonMatch ? jsonMatch[0] : rawOutput;
    const parsed = JSON.parse(json) as { services?: ExtractedServiceData[] };
    services = (parsed.services ?? []).filter(
      (s) => s.name && s.name.trim().length > 0
    );
  } catch {
    // Non-JSON output — fall through with raw content for GPT extraction
  }

  logger.info(`[browser-use] extracted ${services.length} services directly`);

  return {
    services,
    rawContent: rawOutput,
    source: 'browser-use',
  };
}
