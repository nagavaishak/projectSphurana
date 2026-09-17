import { type Page, test } from '@playwright/test';
import { isVisibleWithin } from './wait.js';

const API_URL = process.env.API_URL || 'http://localhost:3000';

/**
 * True when the target API is running the Meta contract fake.
 *
 * WHY EVERY SKIP BELOW IS GATED ON THIS
 * -------------------------------------
 * These helpers exist to absorb genuinely-external conditions — Meta rate
 * limits, a revoked token, a Graph outage. That is legitimate on the NIGHTLY
 * run, which talks to real Meta.
 *
 * Against the fake, none of those conditions can occur. Meta is deterministic
 * and in-process. So if a rate-limit dialog or a Meta error envelope shows up
 * on a stubbed run, it is NOT an external constraint — it is a product bug, or
 * the fake diverging from what the app expects. Skipping there would convert
 * the exact regression this suite exists to catch into a green run.
 *
 * Hence: skip on the nightly, THROW on a stubbed PR run.
 */
const IS_STUBBED = process.env.META_E2E_STUB === 'true';

/**
 * Fail loudly rather than skip, when the condition is impossible under the fake.
 */
function failOnStub(condition: string): never {
  throw new Error(
    [
      `${condition} — but this run is stubbed (META_E2E_STUB=true).`,
      '',
      'Under the contract fake this condition CANNOT come from Meta, so it is',
      'not an external constraint to skip past. It means either:',
      '  1. a product bug in the Meta error-handling path, or',
      '  2. the fake returned something the app treated as a Meta failure.',
      '',
      'Both need fixing. To exercise a genuine Meta failure on purpose, drive it',
      'with a magic id (see meta-contract/fake/magic-ids.ts) and assert the',
      'surface — do not skip.',
    ].join('\n')
  );
}

/**
 * Meta rate-limits the connected test org's ad account unpredictably — the
 * connected-ads suite fires many Marketing API calls against a single account.
 * When a publish is throttled, the app surfaces a "Too Many Requests" dialog
 * (MetaErrorDialog) instead of completing the publish.
 *
 * That's an external constraint, not a regression, so skip the test cleanly
 * rather than failing it. The connected-ads project also runs with retries:0,
 * so a skipped test won't re-run and dig the org deeper into the rate limit.
 *
 * Call this right after a publish attempt, before asserting the result.
 */
export async function skipIfMetaRateLimited(page: Page): Promise<void> {
  const rateLimitDialog = page
    .getByRole('dialog')
    .filter({ hasText: /too many requests/i });

  // Genuinely wait for the dialog: the rate-limit response can land a moment
  // after the publish click, and a non-waiting probe would miss it and let the
  // test fail on a confusing downstream assertion instead of skipping cleanly.
  if (await isVisibleWithin(rateLimitDialog, 5_000)) {
    if (IS_STUBBED) failOnStub('A "Too Many Requests" dialog appeared');
    test.skip(
      true,
      'Meta API rate limit hit (Too Many Requests) — retry later'
    );
  }
}

function isMetaAuthExpired(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;

  const data = payload as {
    code?: unknown;
    message?: unknown;
    details?: { metaError?: { errorKey?: unknown } };
  };
  return (
    data.code === 'META_AUTH_EXPIRED' ||
    data.details?.metaError?.errorKey === 'META_AUTH_TOKEN_REVOKED' ||
    (typeof data.message === 'string' &&
      /access token has been revoked|reconnect/i.test(data.message))
  );
}

/**
 * Connected ads specs require a live Meta Marketing API token. When the shared
 * test credential expires or is revoked, skip cleanly so a secret rotation
 * issue does not fail unrelated PRs.
 */
export async function skipIfMetaAuthUnavailable(page: Page): Promise<void> {
  const response = await page.request.fetch(`${API_URL}/meta-campaigns`, {
    method: 'GET',
    timeout: 15_000,
  });

  if (response.ok()) return;

  const body = await response.text();
  let payload: unknown = { message: body };
  try {
    payload = JSON.parse(body);
  } catch {
    // Keep the plain-text body in payload.message.
  }

  if (isMetaAuthExpired(payload)) {
    if (IS_STUBBED)
      failOnStub('The API reported an expired/revoked Meta token');
    test.skip(true, 'Meta Ads token expired/revoked - reconnect test org');
  }
}

/** The Meta-backed endpoint the ad wizard's Facebook-Page dropdown reads from. */
const META_PAGES_ENDPOINT = `${API_URL}/integrations/meta-ads/pages`;

/**
 * Classify a response from a Meta-backed endpoint as the external
 * "Meta returned an error / is unavailable" surface, or not. Returns a human
 * reason to skip on, or `null` to let the test proceed (and fail on a real bug).
 *
 * WHY this distinguishes a Meta OUTAGE from a REGRESSION in our own ad flow:
 *
 *  1. NON-JSON BODY → external, skip. Every route in this NestJS API answers
 *     with JSON — the payload on success, or a Nest error envelope
 *     ({ statusCode, message, ... }) on failure. A plain-text body such as
 *     "An error occurred..." can therefore NEVER originate in our handler; it is
 *     injected by the preview gateway / an upstream Meta error page when the
 *     Meta-backed request fails or times out. This is the exact surface that
 *     broke the connected-ads run: the browser's apiClient ran JSON.parse on it
 *     and threw `SyntaxError: Unexpected token 'A', "An error o"... is not valid
 *     JSON`, leaving the Facebook-Page dropdown empty so the wizard's page
 *     button never rendered. `jsonParsed === false` is that detector.
 *
 *  2. JSON META ERROR ENVELOPE → external, skip. A Graph API error surfaced
 *     through our layer: an expired/revoked token, a `details.metaError`, a
 *     `META_*` code, or an OAuthException / Graph transient error. Meta
 *     rejecting or dropping the call is not our regression.
 *
 * A generic 500 carrying OUR OWN envelope ({ statusCode: 500, message: 'Internal
 * server error' } with no Meta marker) returns `null` — that could be a real bug
 * in the ad-creation flow, so it must FAIL, not skip.
 */
function metaServiceErrorReason(
  body: string,
  jsonParsed: boolean,
  payload: unknown
): string | null {
  // (1) Non-JSON body — the "An error o…" gateway / upstream-Meta surface. Our
  // handlers always emit JSON, so anything else is provably external.
  if (!jsonParsed) {
    const snippet = body.trim().slice(0, 80) || '(empty body)';
    return `non-JSON response ("${snippet}…") — a Meta-backed request failed upstream`;
  }

  // (2) A JSON Meta error envelope surfaced through our layer.
  if (isMetaAuthExpired(payload)) {
    return 'Meta Ads token expired/revoked';
  }
  if (!payload || typeof payload !== 'object') return null;

  const data = payload as {
    code?: unknown;
    message?: unknown;
    details?: { metaError?: unknown };
  };
  if (data.details?.metaError) {
    return 'Meta Graph API error envelope present in response';
  }
  if (typeof data.code === 'string' && /^META_/.test(data.code)) {
    return `Meta error code ${data.code}`;
  }
  if (
    typeof data.message === 'string' &&
    /oauthexception|graph\.facebook|temporarily unavailable|reduce the amount of data/i.test(
      data.message
    )
  ) {
    return `Meta error: ${data.message.slice(0, 120)}`;
  }

  return null;
}

/**
 * Preflight the Meta dependency the ad wizard's details step relies on — the
 * Facebook-Page list — and skip cleanly when Meta is returning errors / is
 * unavailable, rather than letting the run fail 15s later on the page button's
 * `toBeVisible` timeout.
 *
 * This is a sibling of {@link skipIfMetaRateLimited}: a NARROW gate on a
 * genuinely-external condition (Meta outage / Graph error), NOT a fallback that
 * swallows product failures. When Meta is healthy this returns without skipping
 * and the spec exercises and asserts ad creation in full. It only skips on the
 * two provably-external surfaces classified in {@link metaServiceErrorReason}
 * (non-JSON gateway body, or a Meta error envelope) — a real bug in our ad flow
 * (our own JSON error envelope) does not match and still fails the test.
 *
 * Call it just before the details step exercises the page dropdown.
 */
export async function skipIfMetaUnavailable(page: Page): Promise<void> {
  let response: Awaited<ReturnType<Page['request']['fetch']>>;
  try {
    response = await page.request.fetch(META_PAGES_ENDPOINT, {
      method: 'GET',
      timeout: 15_000,
    });
  } catch {
    // The request could not complete at all (connection reset / gateway down).
    // Not a regression in the ad flow — the same external condition.
    if (IS_STUBBED)
      failOnStub('The Meta-backed pages endpoint was unreachable');
    test.skip(
      true,
      'Meta-backed pages endpoint unreachable — external outage, retry later'
    );
    return;
  }

  const body = await response.text();
  let payload: unknown = null;
  let jsonParsed = true;
  try {
    payload = JSON.parse(body);
  } catch {
    jsonParsed = false;
  }

  const reason = metaServiceErrorReason(body, jsonParsed, payload);
  if (reason) {
    if (IS_STUBBED) failOnStub(`Meta appeared unavailable — ${reason}`);
    test.skip(true, `Meta unavailable — ${reason}. Retry once Meta recovers.`);
  }
}

/**
 * Meta's own transient-failure envelope, surfaced on the ad row's `syncError`.
 *
 * When Meta's ad-creation backend has a wobble it accepts the publish, then
 * flips the ad to `error` with a message that says, in as many words, that the
 * problem is temporary and to try again shortly. `waitForAdActive` correctly
 * treats `error` as terminal and throws — the ad IS dead, and pretending
 * otherwise would hide real disapprovals.
 *
 * But "Meta had a wobble" is not a regression in our ad flow, and it is not
 * something the suite can seed its way past: it is the same class of external
 * constraint as {@link skipIfMetaRateLimited}. Anything else — a policy
 * disapproval, a malformed creative, a missing video — must still FAIL, which
 * is why the match is on Meta's transient phrasing and its transient error
 * subcodes rather than on "the ad errored".
 *
 * Meta's transient markers (Marketing API):
 *   - code 2 / "temporary issue", "temporarily unavailable"
 *   - code 1 / "unknown error", "please retry"
 *   - code 4, 17, 32, 613 — throttling, surfaced as ad errors under load
 */
const META_TRANSIENT_AD_ERROR =
  /(temporar(?:y|ily)|try again in a few minutes|please retry|unknown error has occurred|service is (?:currently )?unavailable|reduce the amount of data|request limit reached|too many calls|rate limit)/i;

/**
 * Skip when an ad-activation failure is Meta's own transient error, re-throw
 * otherwise.
 *
 * Usage mirrors {@link skipIfAssistantUnavailable} — wrap the `waitForAdActive`
 * call, not the whole test:
 *
 *   try {
 *     const { adStatus } = await seed.waitForAdActive(id, name, 300_000);
 *     expect(adStatus.toLowerCase()).toContain('active');
 *   } catch (error) {
 *     skipIfMetaTransientAdFailure(error);
 *   }
 */
export function skipIfMetaTransientAdFailure(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);

  // Only ad-activation failures are eligible: this must never swallow an
  // assertion error or an unrelated throw that happens to contain the word
  // "temporary".
  const isActivationFailure = message.includes('[waitForAdActive]');

  if (isActivationFailure && META_TRANSIENT_AD_ERROR.test(message)) {
    if (IS_STUBBED)
      failOnStub('Meta reported a transient error while activating the ad');
    test.skip(
      true,
      `Meta transient failure while activating the ad — external, retry later. Meta said: ${message.slice(0, 200)}`
    );
  }

  throw error instanceof Error ? error : new Error(message);
}
