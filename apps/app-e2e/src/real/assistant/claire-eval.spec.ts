import { expect, test } from '@playwright/test';
import {
  SeedHelper,
  TEST_DATA,
  skipIfAssistantUnavailable,
} from '../../fixtures/index.js';

/**
 * Wraps `simulateAssistantMessage` so a turn that can't run because the API
 * has no Anthropic model key skips cleanly instead of hard-failing the nightly
 * suite (the suite is documented to need a live model key).
 */
async function simulateOrSkip(
  seed: SeedHelper,
  data: Parameters<SeedHelper['simulateAssistantMessage']>[0]
): ReturnType<SeedHelper['simulateAssistantMessage']> {
  try {
    return await seed.simulateAssistantMessage(data);
  } catch (error) {
    return skipIfAssistantUnavailable(error);
  }
}

/**
 * ════════════════════════════════════════════════════════════════════════
 *  CLAIRE REAL-LLM EVAL SUITE  —  NIGHTLY / ON-DEMAND, NOT PER-PR
 * ════════════════════════════════════════════════════════════════════════
 *
 * This is a *real-model* eval, NOT a deterministic plumbing test. Where
 * `src/assistant/assistant-plumbing.spec.ts` proves the test-injection
 * endpoint is wired end to end (one forced skill, one always-loaded tool,
 * a queryable side effect), THIS suite probes whether Claire actually ROUTES
 * a natural-language request to the RIGHT family of tools across the headline
 * capabilities the product cares about: ads, video, customer chats, services,
 * leads, offers.
 *
 * It lives under `src/real/` so the `real-e2e` Playwright project picks it up
 * (testMatch `/src\/real\/.*\.spec\.ts/`). Per .claude/rules/testing/e2e.md
 * the `real` project is EXCLUDED from the per-PR `authenticated` run
 * (testIgnore `src\/real\/`) and runs single-worker with a 10-minute timeout
 * — i.e. on the nightly / on-demand schedule, against the real staging API
 * and the real Anthropic model.
 *
 * ── DETERMINISM STRATEGY ───────────────────────────────────────────────
 *   - `forceSkillIds: [<skillId>]` bypasses the first-turn Haiku intent
 *     classifier, so SKILL SELECTION is deterministic. The eval is about
 *     "given this skill is loaded, does the model reach for a sensible tool
 *     in this skill's family?" — not about the router.
 *   - The endpoint STILL calls the real model for tool-argument generation,
 *     so the EXACT tool, args, and assistant wording are non-deterministic.
 *     Every assertion is therefore LOOSE: success === true, at least one tool
 *     fired, and at least one fired tool's canonical name is in an EXPECTED
 *     SET for that skill. We never assert on assistant prose.
 *
 * ── TOOL-NAME SHAPE ────────────────────────────────────────────────────
 *   `toolCalls[].name` is the CANONICAL factory name `{feature}_{action}`,
 *   not the bare action the skill's `toolNames` array lists. The mapping
 *   (confirmed against the apps/api/src/assistant/tools index.ts headers):
 *     create-ad            → meta_ads_<action>   + claire_<recommend*>
 *     generate-video       → videos_<action>
 *     manage-customer-chats→ customer_conversations_<action>
 *     manage-services      → context_<action>
 *     manage-leads         → leads_<action>
 *     manage-offers        → offers_<action> + context_listOffers + claire_*
 *   Read/recommend tools shared from context-tools keep the `context_` prefix
 *   (e.g. `context_listServices`, `context_listOffers`).
 *   The expected sets below intentionally accept any tool in the skill's
 *   family — including read-only tools — because the model legitimately leads
 *   with a read (list/recommend) before any write, and on a bare org with no
 *   data a read is often the *only* sensible call.
 *
 * ── DESTRUCTIVE TOOLS (createService, createLead, ad launch, …) ─────────
 *   Destructive tools enforce a TWO-CALL confirmation flow. On a SINGLE turn
 *   the first call returns a `confirmation_required` presentation envelope
 *   (with a one-time `token`) and DOES NOT create the row. The row is only
 *   written when a SECOND turn echoes that token back as `confirmationToken`.
 *   Most cases below therefore assert on the CONFIRMATION / tool-call, not a
 *   committed side effect. ONE case (services) drives the full two-turn
 *   confirm flow, extracts the token from the first turn's tool output,
 *   echoes it on the same conversation, then verifies + cleans up the row.
 *
 * ── RUN COMMAND (cannot run here — needs staging tunnel + seed token +
 *    model key) ─────────────────────────────────────────────────────────
 *   This file CANNOT be executed in this environment: it requires the
 *   staging tunnel, a valid `E2E_SEED_TOKEN`, the bare-user creds, and a live
 *   Anthropic key on the API. To run it (mirrors the plumbing test's command
 *   but targets the `real-e2e` project):
 *
 *     cd apps/app-e2e
 *     E2E_ENV=staging PW_SKIP_DEPS=true SKIP_WEBSERVER=true \
 *       npx playwright test --project=real-e2e \
 *       src/real/assistant/claire-eval.spec.ts --reporter=list
 */

// Guard: the SeedHelper module throws at import time if E2E_SEED_TOKEN is
// absent, so by the time this file's tests run the token exists. We still keep
// an explicit env check so the suite skips gracefully (rather than erroring mid
// step) if the bare-user creds needed for the two-turn confirm flow are absent.
const HAS_SEED_TOKEN = Boolean(process.env.E2E_SEED_TOKEN);
const HAS_BARE_CREDS = Boolean(
  process.env.TEST_BARE_USER_EMAIL && process.env.TEST_BARE_USER_PASSWORD
);

/** Services the eval's destructive-confirm case creates; reaped in afterEach. */
const EVAL_SERVICE_PREFIX = 'E2E Claire Eval Service';

/**
 * Canonical tool-name expectations per skill. A case passes if at least one
 * fired toolCall name is in this set. Built from each skill's `toolNames`
 * (packages/features/src/assistant/skills/*.skill.ts) mapped through the
 * factory's `{feature}_{action}` convention — where the feature's hyphens
 * become underscores (`meta-ads` → `meta_ads_…`, see tool-factory/define-tool.ts).
 *
 * KEEP THIS IN STEP WITH THE SKILLS. These sets are a hand-maintained mirror of
 * a list that lives in another package, and they had already drifted: the
 * generate-video set still named `videos_createDraftVideo`,
 * `videos_listAvailableAssets`, `videos_updateDraftConfig`,
 * `videos_queueVideoExport` and `videos_executeVideoExport` long after the
 * content vertical replaced them with `content_createContent` /
 * `content_renderVideo` / `content_patchContent` / `content_listMedia`. Every
 * one of those names was unreachable, so the "did it route to a video tool?"
 * assertion could only ever have failed — the case was dead, and the zero-tool
 * failure above it hid that. When a skill's `toolNames` changes, change the
 * matching set here in the same commit.
 */
const EXPECTED_TOOLS = {
  'create-ad': new Set<string>([
    'meta_ads_checkMetaIntegration',
    'meta_ads_listCampaigns',
    'meta_ads_createCampaign',
    'meta_ads_listRecentVideos',
    'meta_ads_listRecentAds',
    'meta_ads_listLibraryImages',
    'meta_ads_generateAdCopy',
    'meta_ads_previewCampaign',
    'meta_ads_createDraftAd',
    'meta_ads_deleteDraftAd',
    'meta_ads_confirmLaunchAd',
    'meta_ads_executeLaunchAd',
    'meta_ads_confirmUpdateBudget',
    'meta_ads_executeUpdateBudget',
    'meta_ads_updateAd',
    'meta_ads_updateCampaign',
    // recommendation engine + service lookups the skill leans on first
    'claire_recommendServiceForAds',
    'claire_getAlternativeRecommendation',
    'context_listServices',
    'context_listRecentVideos',
  ]),
  'generate-video': new Set<string>([
    // The content vertical — one tool per intent, addressed by content item.
    'content_createContent',
    'content_patchContent',
    'content_renderVideo',
    'content_listMedia',
    // Video-specific helpers the skill still reaches for.
    'videos_deleteDraftVideo',
    'videos_generateVideoScript',
    'videos_listDraftClips',
    'videos_useStockClips',
    'videos_autoSelectClips',
    'videos_autoSelectMusic',
    'videos_getVideoStatus',
    'videos_generateTalkingHeadQR',
    // The skill reads services (and offers) first to anchor the video.
    'context_listServices',
    'context_listOffers',
    'offers_suggestIntroOffer',
    'offers_createOffer',
  ]),
  'manage-customer-chats': new Set<string>([
    'customer_conversations_listOpenConversations',
    'customer_conversations_summariseConversation',
    'customer_conversations_summariseConversationsThisWeek',
    'customer_conversations_draftReply',
    'customer_conversations_sendReply',
    'customer_conversations_confirmEscalateToHuman',
    'customer_conversations_executeEscalateToHuman',
    'customer_conversations_confirmAssignConversation',
    'customer_conversations_executeAssignConversation',
  ]),
  'manage-services': new Set<string>([
    'context_listServices',
    'context_getServiceDetails',
    'context_createService',
    'context_updateService',
    'context_deleteService',
    'packages_listSellables',
  ]),
  'manage-leads': new Set<string>([
    'leads_listLeads',
    'leads_searchLeads',
    'leads_getLeadStats',
    'leads_summariseRecentLeads',
    'leads_createLead',
    'leads_updateLead',
  ]),
  'manage-offers': new Set<string>([
    'context_listOffers',
    'offers_getOfferPerformance',
    'offers_suggestIntroOffer',
    'offers_createOffer',
    'offers_extendOffer',
    'offers_expireOffer',
    'claire_recommendServiceForAds',
    'claire_recommendOfferForService',
    'claire_getAlternativeRecommendation',
  ]),
} as const;

/** A captured tool call from `simulateAssistantMessage`. */
type ToolCall = {
  name: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

/** Pretty-print the fired tool names for assertion failure messages. */
const names = (calls: ToolCall[]): string =>
  calls.map((c) => c.name).join(', ') || '(none)';

/** True if any fired tool name is in the expected set for the skill. */
const hitExpected = (
  calls: ToolCall[],
  expected: ReadonlySet<string>
): boolean => calls.some((c) => expected.has(c.name));

/**
 * Routing assertion for a non-deterministic eval.
 *
 * ZERO TOOL CALLS IS A FAILURE, NOT A SKIP. This helper used to skip when the
 * model fired no tool ("it may have asked a clarifying question") — which is
 * exactly what a routing regression looks like from the outside, so the suite's
 * headline failure mode could never turn it red. The skill is FORCED here
 * (`forceSkillIds`), the prompt is an unambiguous imperative, and every case is
 * answerable with a read-only tool on a bare org: silence means the routing is
 * broken. The assertions stay loose on WHICH tool fired (any member of the
 * skill's family passes) — that's where the model's legitimate freedom is.
 */
const assertRouted = (
  calls: ToolCall[],
  expected: ReadonlySet<string>,
  label: string
): void => {
  expect(
    calls.length,
    `model fired no tool for ${label} — routing regression`
  ).toBeGreaterThan(0);
  expect(
    hitExpected(calls, expected),
    `expected a ${label} tool; saw: ${names(calls)}`
  ).toBe(true);
};

test.describe('Claire real-LLM eval — tool routing (nightly, non-deterministic)', () => {
  // Each case hits the real API + the real model. Budget generously: the model
  // round-trip plus tool dispatch routinely takes 30-90s, and the run is
  // single-worker. The project default (10 min) already covers this; we set an
  // explicit per-test ceiling so the intent is obvious at the file level.
  test.setTimeout(180_000);

  test.skip(
    !HAS_SEED_TOKEN,
    'E2E_SEED_TOKEN is required for the Claire eval (staging seed endpoints).'
  );

  const RUN_ID = Date.now();

  let orgId: string;
  let userId: string;

  // Resolve the session org + user once for the whole file. Mirrors the
  // plumbing test: establish the browser session by visiting a protected page,
  // then read org/user from /auth/session.
  test.beforeEach(async ({ page, request }) => {
    const seed = new SeedHelper(page, request);
    await seed.gotoDashboardPage('/dashboard');
    const session = (await seed.authenticatedApiCall(
      'GET',
      '/auth/session'
    )) as {
      session?: { activeOrganizationId?: string; userId?: string };
      user?: { id?: string };
    } | null;
    const resolvedOrg = session?.session?.activeOrganizationId;
    const resolvedUser = session?.session?.userId ?? session?.user?.id;
    expect(resolvedOrg, 'active organization id').toBeTruthy();
    expect(resolvedUser, 'session user id').toBeTruthy();
    orgId = resolvedOrg as string;
    userId = resolvedUser as string;
  });

  // Reap anything the destructive-confirm case committed, whether it passed,
  // failed mid-assertion, or the model created the row on an unexpected turn —
  // so the org stays tidy across nightly runs.
  test.afterEach(async ({ page, request }) => {
    const seed = new SeedHelper(page, request);
    const services = await seed.listServices();
    for (const service of services.filter((s) =>
      s.name.startsWith(EVAL_SERVICE_PREFIX)
    )) {
      await seed.deleteServiceWithLinkedAssets(service.id);
    }
  });

  /**
   * Guarantee the org has at least one service, so skills that anchor their
   * work to a treatment can reach past their "you have no services yet"
   * branch. Idempotent — reuses an existing eval service when one is present.
   *
   * Named with EVAL_SERVICE_PREFIX so the afterEach reaper takes it away with
   * everything else this file creates.
   */
  const ensureEvalService = async (seed: SeedHelper): Promise<string> => {
    const existing = await seed.listServices();
    const reusable = existing.find((service) =>
      service.name.startsWith(EVAL_SERVICE_PREFIX)
    );
    if (reusable) return reusable.name;

    const name = `${EVAL_SERVICE_PREFIX} Anchor ${RUN_ID}`;
    await seed.authenticatedApiCall('POST', '/organization-services', {
      name,
      category: 'treatment',
    });
    return name;
  };

  // ── CREATING ADS ───────────────────────────────────────────────────────
  // "draft me an ad" → the create-ad skill. Launching an ad is destructive
  // (confirmLaunchAd → executeLaunchAd two-call flow), so a single turn will
  // NOT publish anything to Meta. We assert only that Claire reached for an
  // ad-family tool (it typically leads with a recommendation / draft, both of
  // which are non-destructive reads/previews). Nothing is created on Meta, so
  // there is nothing to clean up.
  test('routes an ad request to a Meta-ads / recommendation tool', async ({
    page,
    request,
  }) => {
    const seed = new SeedHelper(page, request);
    const result = await simulateOrSkip(seed, {
      organizationId: orgId,
      userId,
      forceSkillIds: ['create-ad'],
      messageText:
        'Draft me an ad for my botox service to bring in new clients this month.',
    });

    expect(result.conversationId, 'conversation id returned').toBeTruthy();
    assertRouted(result.toolCalls, EXPECTED_TOOLS['create-ad'], 'ad-family');
  });

  // ── CREATING GRAPHICS / VIDEOS ───────────────────────────────────────────
  // "make me a before-and-after video" → the generate-video skill. Drafting a
  // video (createDraftVideo) is non-destructive; queueing the export
  // (queueVideoExport → executeVideoExport) is the destructive two-call step.
  // A single turn drafts/scripts/selects clips but does NOT render. We assert
  // a video-family tool fired and don't wait for a render.
  //
  // ── THE FORMAT THIS ASKS FOR IS LOAD-BEARING ─────────────────────────────
  // This case used to ask for a "before-and-after video", and failed on every
  // nightly with "model fired no tool for videos — routing regression". The
  // model was right and the eval was wrong: `before_after` is WITHDRAWN
  // (generate-video.skill.ts — "never offer it and never call it", because the
  // product cannot yet prove two photos are the same client). Claire declined
  // and called nothing, which is the specified behaviour. The eval was asking
  // for the one format the product has deliberately switched off, so its
  // headline "did routing regress?" case could only ever be red — and while it
  // was red for that, it was not watching routing at all.
  //
  // It now asks for `educational`, a live format, and the withdrawn format gets
  // its own case below asserting the refusal.
  //
  // A SERVICE IS SEEDED FIRST. On a bare org Claire correctly answers "no
  // services set up yet — head to Services → New Service" and reaches only for
  // reads, so the create path would never be exercised. Per the suite's own
  // rule: seed the precondition, don't skip on it.
  test('routes a video request to a videos tool', async ({ page, request }) => {
    const seed = new SeedHelper(page, request);
    await ensureEvalService(seed);

    const result = await simulateOrSkip(seed, {
      organizationId: orgId,
      userId,
      forceSkillIds: ['generate-video'],
      messageText:
        'Make me an educational video showcasing one of my treatments.',
    });

    expect(result.conversationId, 'conversation id returned').toBeTruthy();
    assertRouted(result.toolCalls, EXPECTED_TOOLS['generate-video'], 'videos');
  });

  // The other half of the above: the withdrawn format must stay withdrawn.
  // This is the assertion that has teeth — a regression that quietly re-enables
  // `before_after` would publish two different people as one person's result,
  // which is precisely why the format was retired. Asserting "no video was
  // drafted" is the check; the prose is the model's to word, so we don't assert
  // on it.
  test('declines the withdrawn before/after format without drafting a video', async ({
    page,
    request,
  }) => {
    const seed = new SeedHelper(page, request);
    await ensureEvalService(seed);

    const result = await simulateOrSkip(seed, {
      organizationId: orgId,
      userId,
      forceSkillIds: ['generate-video'],
      messageText:
        'Make me a before-and-after video showcasing one of my treatments.',
    });

    expect(result.conversationId, 'conversation id returned').toBeTruthy();

    const drafted = result.toolCalls.filter(
      (c) =>
        c.name === 'content_createContent' || c.name === 'content_renderVideo'
    );
    expect(
      drafted.length,
      `before_after is withdrawn — Claire must not draft or render one. Fired: ${names(result.toolCalls)}`
    ).toBe(0);

    // She must still ANSWER — a silent turn is its own failure.
    expect(
      (result.assistantText ?? '').trim().length,
      'Claire declined the format but said nothing'
    ).toBeGreaterThan(0);
  });

  // ── SENDING MESSAGES / CUSTOMER CHATS ────────────────────────────────────
  // "reply to my newest customer conversation" → manage-customer-chats.
  // sendReply / escalate / assign are destructive; on a single turn the model
  // leads with a read (listOpenConversations) and at most a draftReply.
  // On a BARE org with no open conversations, a read tool is the ONLY sensible
  // call — so the expected set deliberately includes the read tools and we
  // assert loosely on the customer_conversations_* family. Nothing is sent.
  test('routes a customer-chat request to a conversations tool', async ({
    page,
    request,
  }) => {
    const seed = new SeedHelper(page, request);
    const result = await simulateOrSkip(seed, {
      organizationId: orgId,
      userId,
      forceSkillIds: ['manage-customer-chats'],
      messageText: 'Reply to my newest customer conversation for me.',
    });

    expect(result.conversationId, 'conversation id returned').toBeTruthy();
    assertRouted(
      result.toolCalls,
      EXPECTED_TOOLS['manage-customer-chats'],
      'customer_conversations_*'
    );
  });

  // ── MANAGING LEADS ───────────────────────────────────────────────────────
  // "how are my leads doing this week" → manage-leads. createLead/updateLead
  // are destructive; a read-oriented prompt drives a list/stats/summary tool.
  // No row is written, so no cleanup is needed.
  test('routes a leads request to a leads tool', async ({ page, request }) => {
    const seed = new SeedHelper(page, request);
    const result = await simulateOrSkip(seed, {
      organizationId: orgId,
      userId,
      forceSkillIds: ['manage-leads'],
      messageText: 'How are my leads doing this week? Give me a quick summary.',
    });

    expect(result.conversationId, 'conversation id returned').toBeTruthy();
    assertRouted(result.toolCalls, EXPECTED_TOOLS['manage-leads'], 'leads_*');
  });

  // ── MANAGING OFFERS ──────────────────────────────────────────────────────
  // "show me my current offers" → manage-offers. createOffer/extendOffer/
  // expireOffer are destructive; a read prompt drives listOffers /
  // getOfferPerformance / a recommendation. No write, no cleanup.
  test('routes an offers request to an offers tool', async ({
    page,
    request,
  }) => {
    const seed = new SeedHelper(page, request);
    const result = await simulateOrSkip(seed, {
      organizationId: orgId,
      userId,
      forceSkillIds: ['manage-offers'],
      messageText:
        'Show me my current offers and tell me which one is performing best.',
    });

    expect(result.conversationId, 'conversation id returned').toBeTruthy();
    assertRouted(
      result.toolCalls,
      EXPECTED_TOOLS['manage-offers'],
      'offers-family'
    );
  });

  // ── MANAGING SERVICES (full two-turn destructive confirm flow) ───────────
  // This is the ONE case that exercises the full destructive confirmation
  // round-trip end to end:
  //
  //   Turn 1: "create a service named X" → context_createService fires and,
  //           because it's destructive, returns a `confirmation_required`
  //           presentation envelope carrying a one-time `token`. NO row is
  //           created yet. We assert the confirmation surfaced.
  //   Turn 2: on the SAME conversationId, echo "yes, go ahead" — the model is
  //           expected to re-call context_createService with the extracted
  //           `confirmationToken`, which the factory verifies + consumes,
  //           then executes the real create via apiFetch (hence we pass a
  //           sessionToken so the authenticated POST /organization-services
  //           succeeds).
  //
  // Then we verify the row exists via listServices; the afterEach hook reaps
  // every service this file created.
  //
  // The model MUST attempt context_createService on turn 1 — the prompt is an
  // unambiguous imperative with the skill forced. Leading with a read instead
  // used to be tolerated with an annotation + early return, which meant the
  // destructive-confirmation contract (the whole point of this case) went
  // unexercised on a green run. It's now an assertion.
  //
  // TEST_BARE_USER_* is an ENVIRONMENT precondition (we mint a session token
  // for the execute hop), declared up front rather than discovered mid-test.
  test('services: two-turn confirm creates a service, then cleans up', async ({
    page,
    request,
  }) => {
    test.skip(
      !HAS_BARE_CREDS,
      'TEST_BARE_USER_* creds are required to mint the session token the confirmed execute hop needs.'
    );

    const seed = new SeedHelper(page, request);
    const serviceName = `${EVAL_SERVICE_PREFIX} ${RUN_ID}`;

    let result = await simulateOrSkip(seed, {
      organizationId: orgId,
      userId,
      forceSkillIds: ['manage-services'],
      messageText: `Create a new service called "${serviceName}" in the treatment category.`,
    });
    const conversationId = result.conversationId;

    assertRouted(
      result.toolCalls,
      EXPECTED_TOOLS['manage-services'],
      'context_* services'
    );

    // Pull the confirmation envelope off the createService tool's output.
    // Destructive tools return { presentation: { type: 'confirmation_required',
    // token, executeToolName, ... } } on the first call — and DO NOT create the
    // row. So at this point the service must NOT yet exist.
    const createCall = result.toolCalls.find(
      (c) => c.name === 'context_createService'
    );
    expect(
      createCall,
      `model never called context_createService on turn 1 (asked to create "${serviceName}"); ` +
        `saw: ${names(result.toolCalls)}`
    ).toBeTruthy();

    const presentation = (createCall?.output as { presentation?: unknown })
      ?.presentation as
      | {
          type?: string;
          token?: string;
          executeToolName?: string;
        }
      | undefined;
    expect(
      presentation?.type,
      `createService should surface a confirmation_required envelope; output: ${JSON.stringify(
        createCall?.output
      )}`
    ).toBe('confirmation_required');
    const confirmationToken = presentation?.token;
    expect(confirmationToken, 'confirmation token present').toBeTruthy();

    // Mint a session token so the execute step's apiFetch'd POST is authed.
    const { token: sessionToken } = await seed.createSession(
      TEST_DATA.bareUser.email,
      TEST_DATA.bareUser.password
    );

    // Turn 2: same conversation, echo the confirmation. The model re-calls
    // context_createService with the confirmationToken, which executes the
    // real create.
    result = await simulateOrSkip(seed, {
      organizationId: orgId,
      userId,
      conversationId,
      forceSkillIds: ['manage-services'],
      sessionToken,
      messageText: `Yes, go ahead and create it. Use this confirmation token: ${confirmationToken}`,
    });

    // Turn 2 diagnostics BEFORE the existence check.
    //
    // The bare "row should exist" assertion could not tell apart the two ways
    // this fails, and both happened: the model re-calling createService WITHOUT
    // the token (so the factory issued a second confirmation instead of
    // executing), and the factory REFUSING a correctly-echoed token. The
    // second was a harness defect — `runHeadlessTurn` never persisted its
    // messages, so `verifyConfirmationToken`'s turn-boundary rule saw no
    // intervening user turn and answered `CONFIRMATION_INVALID / no_user_turn`
    // on every attempt. Three nightlies said only "service should exist".
    //
    // So: name what the second call actually did.
    const executeCall = result.toolCalls.find(
      (c) => c.name === 'context_createService'
    );
    expect(
      executeCall,
      `model never re-called context_createService on turn 2; saw: ${names(
        result.toolCalls
      )}`
    ).toBeTruthy();

    const executeOutput = executeCall?.output as
      | {
          code?: string;
          error?: string;
          presentation?: { type?: string; reason?: string };
        }
      | undefined;

    // One message, several facts — assembled before the assertion so the
    // failure text stays readable at the call site.
    const executeDiagnostics = [
      `code=${executeOutput?.code ?? '(none)'}`,
      `reason=${executeOutput?.presentation?.reason ?? '(none)'}`,
      `error=${executeOutput?.error ?? '(none)'}`,
      `input=${JSON.stringify(executeCall?.input)}`,
    ].join(' ');

    expect(
      executeOutput?.presentation?.type,
      `turn 2 returned another confirmation instead of executing — the confirmed token was rejected or was never echoed. ${executeDiagnostics}`
    ).not.toBe('confirmation_required');
    expect(
      executeOutput?.code,
      `turn 2's createService was refused: ${executeOutput?.error ?? '(no error text)'} ` +
        `(reason=${executeOutput?.presentation?.reason ?? 'n/a'})`
    ).not.toBe('CONFIRMATION_INVALID');

    // Verify the row now exists for the org.
    const services = await seed.listServices();
    const match = services.find((s) => s.name === serviceName);
    expect(
      match,
      `service "${serviceName}" should exist after the confirmed two-turn flow; ` +
        `turn-2 tools: ${names(result.toolCalls)}; ` +
        `turn-2 createService input: ${JSON.stringify(executeCall?.input)}`
    ).toBeTruthy();
  });
});
