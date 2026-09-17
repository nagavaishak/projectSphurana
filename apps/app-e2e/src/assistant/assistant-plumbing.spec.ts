import { expect, test } from '@playwright/test';
import { SeedHelper, skipIfAssistantUnavailable } from '../fixtures';

/**
 * Assistant (Claire) plumbing E2E.
 *
 * Proves the deterministic test-injection path into the LLM-driven assistant
 * works end to end against the real staging API:
 *
 *   POST /testing/simulate-assistant-message
 *     → testing.service.simulateAssistantMessage
 *       → runHeadlessTurn (forced skill, no SSE)
 *         → runToolLoop → real Anthropic call → tool dispatch
 *
 * Determinism strategy:
 *   - `forceSkillIds: ['manage-services']` bypasses the first-turn
 *     `classifyIntent` (Haiku) router, so skill selection is NOT left to the
 *     model. This exercises the forced-skill injection path the public
 *     `/assistant/chat` controller deliberately does NOT expose.
 *   - The asserted side effect uses the **always-loaded** `meta_remember`
 *     tool, which is non-destructive (no two-call confirmation round-trip)
 *     and writes a real `knowledge_entry` row via `db`. A "remember that …"
 *     message drives it in a single turn — so we get a real, queryable,
 *     reversible side effect without depending on a confirmation handshake.
 *
 * NOTE ON MODEL NON-DETERMINISM: the endpoint still calls the real model for
 * tool-argument generation. We therefore assert on the SHAPE of the result
 * (the `meta_remember` tool fired with `saved: true`, and a matching memory
 * row exists for this org) rather than on exact assistant wording. A unique
 * `Date.now()` marker in the memory content keeps the verify + cleanup
 * targeted and run-isolated.
 */
test.describe('Assistant plumbing (forced-skill injection)', () => {
  // The endpoint runs a real LLM turn server-side; allow generous time.
  test.setTimeout(180_000);

  const RUN_ID = Date.now();
  // A distinctive, stable preference the model should store verbatim-ish.
  const MEMORY_MARKER = `e2e-claire-plumbing-${RUN_ID}`;

  let createdMemoryId: string | undefined;
  let orgId: string;
  let userId: string;
  let sessionToken: string | null;

  test('forced skill + remember tool persists a memory row', async ({
    page,
    request,
  }) => {
    const seed = new SeedHelper(page, request);

    await test.step('resolve session org + user', async () => {
      // Establish the browser session (storageState) by visiting a protected
      // page, then read org/user from the session.
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
      // The forced `manage-services` skill loads tools that may call back into
      // the API via apiFetch (those behind the AuthGuard). Forward the browser
      // session so any such tool the model picks runs authenticated, rather
      // than throwing "Authentication required" on an unauthenticated hop.
      sessionToken = await seed.getSessionToken();
      expect(sessionToken, 'session token cookie').toBeTruthy();
    });

    let result: Awaited<ReturnType<typeof seed.simulateAssistantMessage>>;

    await test.step('run a forced-skill assistant turn', async () => {
      try {
        result = await seed.simulateAssistantMessage({
          organizationId: orgId,
          userId,
          // Force the manage-services skill to exercise the injection path that
          // bypasses the LLM intent router. meta_remember is always loaded
          // regardless of skill, so the turn can still drive it.
          forceSkillIds: ['manage-services'],
          sessionToken: sessionToken ?? undefined,
          messageText: `Please remember that our internal QA marker is "${MEMORY_MARKER}". Save it as a personal memory.`,
        });
      } catch (error) {
        // No model key on this API → skip rather than hard-fail.
        skipIfAssistantUnavailable(error);
      }

      expect(result.conversationId, 'conversation id returned').toBeTruthy();
    });

    await test.step('assert the remember tool fired and saved', async () => {
      const rememberCall = result.toolCalls.find(
        (c) => c.name === 'meta_remember'
      );
      // The model may phrase the turn differently, but with an explicit
      // "remember that …" instruction it reliably calls meta_remember.
      expect(
        rememberCall,
        `meta_remember should fire; tool calls seen: ${result.toolCalls
          .map((c) => c.name)
          .join(', ')}`
      ).toBeTruthy();

      const output = rememberCall?.output as
        | { saved?: boolean; knowledgeEntryId?: string }
        | undefined;
      expect(output?.saved, 'memory saved flag').toBe(true);
      createdMemoryId = output?.knowledgeEntryId ?? createdMemoryId;
    });

    await test.step('verify the memory row exists for this org', async () => {
      const memories = (await seed.authenticatedApiCall(
        'GET',
        '/assistant/memories?limit=100'
      )) as {
        items?: Array<{ id: string; content: string }>;
      };
      const match = (memories.items ?? []).find((m) =>
        m.content.includes(MEMORY_MARKER)
      );
      expect(
        match,
        'a personal memory containing the QA marker should exist'
      ).toBeTruthy();
      // Prefer the id from the listing for cleanup (covers the case where the
      // tool output didn't echo knowledgeEntryId).
      createdMemoryId = match?.id ?? createdMemoryId;
    });

    await test.step('clean up the created memory', async () => {
      // The verify step above asserted a matching memory row exists, so its id
      // is always resolved by now — no need (and no excuse) to branch here.
      expect(createdMemoryId, 'created memory id for cleanup').toBeTruthy();
      const deleted = (await seed.authenticatedApiCall(
        'DELETE',
        `/assistant/memories/${createdMemoryId}`,
        undefined,
        [404]
      )) as { deleted?: boolean };
      expect(deleted?.deleted ?? true).toBeTruthy();
    });
  });
});
