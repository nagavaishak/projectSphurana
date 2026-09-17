import { expect, test } from '@playwright/test';
import { SeedHelper, skipIfAssistantUnavailable } from '../fixtures';

/**
 * Claire grounding — real messages, real model, checked against real data.
 *
 * Every test here sends an ACTUAL message to Claire through
 * `/testing/simulate-assistant-message` (which runs the real tool loop against
 * the real model) and asserts the answer against database state we seeded
 * ourselves. Nothing is stubbed.
 *
 * WHY GROUNDING AND NOT WORDING
 * The model's phrasing is not deterministic and asserting on it produces a
 * suite that fails on a prompt tweak and passes on a broken tool. What IS
 * deterministic is whether Claire's claims match reality:
 *
 *   - if she states a count, it must equal what we seeded
 *   - if she says she did something, a tool must actually have fired
 *   - if the entity does not exist, she must NOT claim success
 *
 * That last one is the point of this file. A confabulated success — "Done, I've
 * booked that for you" with no tool call behind it — is the single worst
 * failure mode of a tool-using assistant, it is invisible to unit tests, and it
 * is exactly what a real-message suite can catch.
 *
 * The one sanctioned skip is `skipIfAssistantUnavailable`: an API with no model
 * key is a missing external dependency, not a regression. Nothing else here
 * skips on observed application state.
 */
test.describe('Claire grounding (real messages)', () => {
  // Each turn is a real multi-step model call with tool dispatch.
  test.setTimeout(240_000);

  const RUN_ID = Date.now();

  let orgId: string;
  let userId: string;
  let sessionToken: string | null;
  let seed: SeedHelper;

  test.beforeEach(async ({ page, request }) => {
    seed = new SeedHelper(page, request);
    await seed.gotoDashboardPage('/dashboard');
    const session = (await seed.authenticatedApiCall(
      'GET',
      '/auth/session'
    )) as {
      session?: { activeOrganizationId?: string; userId?: string };
      user?: { id?: string };
    } | null;
    orgId = session?.session?.activeOrganizationId as string;
    userId = (session?.session?.userId ?? session?.user?.id) as string;
    sessionToken = await seed.getSessionToken();
    expect(orgId, 'active organization id').toBeTruthy();
    expect(userId, 'session user id').toBeTruthy();
  });

  /** Send one real message to Claire, skipping only if the model is absent. */
  async function ask(messageText: string, forceSkillIds?: string[]) {
    try {
      return await seed.simulateAssistantMessage({
        organizationId: orgId,
        userId,
        sessionToken: sessionToken ?? undefined,
        messageText,
        ...(forceSkillIds ? { forceSkillIds } : {}),
      });
    } catch (error) {
      skipIfAssistantUnavailable(error);
    }
  }

  test('does not claim success for an entity that does not exist', async () => {
    // A service nobody has ever created. There is no correct tool result here,
    // so the only correct behaviour is to say so.
    const ghost = `Nonexistent Service ${RUN_ID}`;
    const result = await ask(
      `Change the price of my "${ghost}" service to 42 pounds.`
    );

    const text = result.assistantText.toLowerCase();

    // Claire must NOT report the edit as done. Checked positively (an explicit
    // "can't find / doesn't exist / not in your list" acknowledgement) rather
    // than by the absence of a success phrase, so a vague non-answer cannot
    // pass. The alternatives cover how she actually phrases a miss — "isn't in
    // your service list", "not there", "no changes made" are all valid refusals.
    const acknowledgesMissing =
      /(could ?n'?t|cannot|can'?t|unable to) find|does ?n'?t (exist|appear)|no (such|service)|not found|(is ?n'?t|not) (in|on) your|not (there|listed)|no changes made|don'?t (see|have)/.test(
        text
      );
    expect(
      acknowledgesMissing,
      `Claire should say the service does not exist. She said: "${result.assistantText}"`
    ).toBe(true);

    // And no write tool may have reported success against a ghost entity.
    const successfulWrite = result.toolCalls.find((c) => {
      if (!/update|create|delete|edit|set/i.test(c.name)) return false;
      const out = JSON.stringify(c.output ?? {});
      return /"success"\s*:\s*true|"updated"\s*:\s*true/.test(out);
    });
    expect(
      successfulWrite,
      `No write tool may succeed against a nonexistent entity. Fired: ${result.toolCalls.map((c) => c.name).join(', ')}`
    ).toBeUndefined();
  });

  test('counts match what we actually seeded, not what sounds plausible', async () => {
    // SEED the precondition rather than reading whatever happens to be there:
    // an assertion against unknown data cannot distinguish a correct answer
    // from a lucky guess.
    const marker = `e2e-claire-count-${RUN_ID}`;
    const created = await seed.authenticatedApiCall('POST', '/leads', {
      firstName: 'Grounding',
      lastName: marker,
      email: `${marker}@example.com`,
      source: 'manual',
    });
    expect(created, 'seeded lead').toBeTruthy();

    const before = (await seed.authenticatedApiCall('GET', '/leads')) as {
      items?: unknown[];
      total?: number;
    };
    const actualTotal = before.total ?? before.items?.length ?? 0;
    expect(actualTotal, 'seeded lead count').toBeGreaterThan(0);

    const result = await ask('How many leads do I have in total right now?');

    // A read tool must have run — an answer produced without consulting the
    // data is a confabulation even when the number happens to be right.
    expect(
      result.toolCalls.length,
      `Claire must consult a tool to answer a data question. She replied "${result.assistantText}" with no tool calls.`
    ).toBeGreaterThan(0);

    // She was asked "how many", so a number is required — and it must be the
    // real one. Asserted unconditionally: a version of this that only checked
    // the figure "if she quoted one" would pass when she dodged the question,
    // which is precisely the confabulation this file exists to catch.
    const numbers = (result.assistantText.match(/\b\d{1,6}\b/g) ?? []).map(
      Number
    );
    expect(
      numbers.includes(actualTotal),
      `Claire was asked for a lead count. The org has ${actualTotal}; she quoted [${numbers.join(', ') || 'no number at all'}]. Reply: "${result.assistantText}"`
    ).toBe(true);
  });

  test('asks rather than guessing when the request is ambiguous', async () => {
    // Deliberately underspecified: no date, no client, no service. Guessing
    // any of them and acting would be worse than asking.
    const result = await ask('Book an appointment.');

    const text = result.assistantText;
    expect(
      /\?/.test(text),
      `Claire should ask for the missing details rather than acting. She said: "${text}"`
    ).toBe(true);

    // Nothing may have been written on an underspecified request.
    const wrote = result.toolCalls.find(
      (c) =>
        /create|book|schedule/i.test(c.name) &&
        /"success"\s*:\s*true/.test(JSON.stringify(c.output ?? {}))
    );
    expect(
      wrote,
      `No booking may be created from an ambiguous request. Fired: ${result.toolCalls.map((c) => c.name).join(', ')}`
    ).toBeUndefined();
  });

  test('keeps context across turns in one conversation', async () => {
    // In-domain framing ("reference code") on purpose: "internal QA / system"
    // wording trips Claire's scope guard, which would fail the test for a reason
    // that has nothing to do with cross-turn context.
    const marker = `e2e-claire-ctx-${RUN_ID}`;
    const first = await ask(
      `Remember my reference code "${marker}". Save it as a memory.`
    );
    expect(first.conversationId, 'conversation id').toBeTruthy();

    // Same conversation — the second turn must resolve "it" from the first.
    let second: Awaited<ReturnType<typeof seed.simulateAssistantMessage>>;
    try {
      second = await seed.simulateAssistantMessage({
        organizationId: orgId,
        userId,
        sessionToken: sessionToken ?? undefined,
        conversationId: first.conversationId,
        messageText: 'What reference code did I just give you?',
      });
    } catch (error) {
      skipIfAssistantUnavailable(error);
    }

    expect(
      second.assistantText.includes(marker),
      `Claire should recall the marker from earlier in the conversation. She said: "${second.assistantText}"`
    ).toBe(true);
  });

  test('a claimed write actually persists', async () => {
    // The inverse of the confabulation test: when Claire DOES say she did
    // something, the row must exist. A toast-level "done" is not evidence.
    // In-domain framing ("reference code") — see the context test above for why
    // "internal QA" wording must be avoided (it trips the scope guard).
    const marker = `e2e-claire-persist-${RUN_ID}`;
    const result = await ask(`Please remember my reference code "${marker}".`);

    const rememberCall = result.toolCalls.find((c) => /remember/i.test(c.name));
    expect(
      rememberCall,
      `A remember tool should fire. Tool calls: ${result.toolCalls.map((c) => c.name).join(', ')}`
    ).toBeTruthy();

    // Re-read from the server in a NEW conversation, so the answer cannot come
    // from conversation history — it has to come from stored state.
    let recall: Awaited<ReturnType<typeof seed.simulateAssistantMessage>>;
    try {
      recall = await seed.simulateAssistantMessage({
        organizationId: orgId,
        userId,
        sessionToken: sessionToken ?? undefined,
        messageText: 'What is my reference code?',
      });
    } catch (error) {
      skipIfAssistantUnavailable(error);
    }

    expect(
      recall.assistantText.includes(marker),
      `The remembered marker must survive into a NEW conversation. Claire said: "${recall.assistantText}"`
    ).toBe(true);
  });
});
