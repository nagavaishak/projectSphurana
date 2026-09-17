/**
 * Harness + runner integration test.
 *
 * Boots the runner over the on-disk fixtures + recordings in replay mode
 * and asserts every fixture passes. This is the smoke test for the prep
 * harness — it pins the wire-level invariants (correct trace shape,
 * correct comparison semantics, correct mid-turn skill mutation) without
 * touching the network.
 *
 * Also covers a few unit-level invariants on the runner's comparator
 * directly, which are easier to assert with a hand-built trace than via
 * a fixture+recording round-trip.
 */

import { describe, expect, it } from '@borradh-workspace/testing';
import { compareFixture } from './runner.js';
import type { ClaireFixture, HarnessTrace, HarnessTurnTrace } from './types.js';

// Vitest mocks for observability are set up globally in test-setup.ts.

describe('compareFixture', () => {
  it('returns no failures when expectations are met', () => {
    const fixture: ClaireFixture = {
      id: 'fx',
      description: '',
      category: 'tool-dispatch',
      turns: [
        {
          userMessage: 'hi',
          expect: {
            toolsCalled: ['context_listServices'],
            responseContains: ['Lip filler'],
          },
        },
      ],
    };
    const trace: HarnessTrace = {
      fixtureId: 'fx',
      perTurn: [
        makeTurn({
          userMessage: 'hi',
          finalText: 'You offer Lip filler and a few more.',
          toolCalls: [
            {
              name: 'context_listServices',
              input: {},
              result: { ok: true, data: { services: [] } },
            },
          ],
        }),
      ],
    };
    expect(compareFixture(fixture, trace)).toEqual([]);
  });

  it('flags missing tool calls', () => {
    const fixture: ClaireFixture = {
      id: 'fx',
      description: '',
      category: 'tool-dispatch',
      turns: [
        {
          userMessage: 'hi',
          expect: { toolsCalled: ['someTool'] },
        },
      ],
    };
    const trace: HarnessTrace = {
      fixtureId: 'fx',
      perTurn: [makeTurn({ userMessage: 'hi' })],
    };
    const failures = compareFixture(fixture, trace);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0]).toMatch(/expected tool "someTool"/);
  });

  /* ------------------------------------------------------------------ */
  /* Decision assertions.                                                */
  /*                                                                     */
  /* Each case below is modelled on a REAL finding from the production   */
  /* conversation audit (717 defect findings; ~50.6% root-caused to      */
  /* prompt behaviour). Every one of them DISPATCHES CORRECTLY — the     */
  /* plumbing keys above stay green on all of them, which is why they    */
  /* shipped. The paired "…and stays silent when correct" tests exist so */
  /* these keys cannot pass by always failing.                           */
  /* ------------------------------------------------------------------ */

  const decisionFixture = (
    expectation: ClaireFixture['turns'][number]['expect']
  ): ClaireFixture => ({
    id: 'fx',
    description: '',
    category: 'tool-dispatch',
    turns: [{ userMessage: 'hi', expect: expectation }],
  });

  // AUDIT: "make me 2 ads … both graphics and really professional" -> Claire
  // called the ORGANIC-post graphic tool, produced no ad graphic, no draft ad
  // and no campaign, then labelled the output "Ad 1" and "Ad 2". Category
  // `substituted`, 37 behaviour-caused findings. `toolsCalled` cannot catch it:
  // it is a positive subsequence match that tolerates extra calls.
  it('toolsNotCalled flags the wrong tool even when the right one also ran', () => {
    const fixture = decisionFixture({
      toolsCalled: ['graphics_createAdGraphic'],
      toolsNotCalled: ['graphics_createGraphic'],
    });
    const trace: HarnessTrace = {
      fixtureId: 'fx',
      perTurn: [
        makeTurn({
          userMessage: 'hi',
          finalText: 'Here are Ad 1 and Ad 2.',
          toolCalls: [
            {
              name: 'graphics_createAdGraphic',
              input: {},
              result: { ok: true, data: {} },
            },
            {
              name: 'graphics_createGraphic',
              input: {},
              result: { ok: true, data: {} },
            },
          ],
        }),
      ],
    };
    // The positive half passes — which is the point.
    expect(
      compareFixture(
        decisionFixture({ toolsCalled: ['graphics_createAdGraphic'] }),
        trace
      )
    ).toEqual([]);

    const failures = compareFixture(fixture, trace);
    expect(failures.length).toBe(1);
    expect(failures[0]).toMatch(/"graphics_createGraphic" must NOT be called/);
  });

  it('toolsNotCalled stays silent when the banned tool did not run', () => {
    const trace: HarnessTrace = {
      fixtureId: 'fx',
      perTurn: [
        makeTurn({
          userMessage: 'hi',
          toolCalls: [
            {
              name: 'graphics_createAdGraphic',
              input: {},
              result: { ok: true, data: {} },
            },
          ],
        }),
      ],
    };
    expect(
      compareFixture(
        decisionFixture({ toolsNotCalled: ['graphics_createGraphic'] }),
        trace
      )
    ).toEqual([]);
  });

  // AUDIT: "Claire's metrics report states all 50 leads were contacted when
  // every status update in the session had FAILED". Category `false-success`.
  it('toolFailed + responseLacks flags a refusal relayed as a success', () => {
    const trace: HarnessTrace = {
      fixtureId: 'fx',
      perTurn: [
        makeTurn({
          userMessage: 'hi',
          finalText: 'Done — all 50 leads are now marked contacted.',
          toolCalls: [
            {
              name: 'leads_updateLead',
              input: {},
              result: { ok: false, error: 'nope', code: 'INVALID_STATE' },
            },
          ],
        }),
      ],
    };
    const failures = compareFixture(
      decisionFixture({
        toolFailed: { name: 'leads_updateLead', code: 'INVALID_STATE' },
        responseLacks: ['Done'],
      }),
      trace
    );
    expect(failures.length).toBe(1);
    expect(failures[0]).toMatch(/NOT to contain "Done"/);
  });

  it('toolFailed fails the FIXTURE when the stub did not actually refuse', () => {
    // Guards the assertion itself: a relay check whose tool succeeded proves
    // nothing, and must not read as a pass.
    const trace: HarnessTrace = {
      fixtureId: 'fx',
      perTurn: [
        makeTurn({
          userMessage: 'hi',
          finalText: 'Done.',
          toolCalls: [
            {
              name: 'leads_updateLead',
              input: {},
              result: { ok: true, data: {} },
            },
          ],
        }),
      ],
    };
    const failures = compareFixture(
      decisionFixture({ toolFailed: { name: 'leads_updateLead' } }),
      trace
    );
    expect(failures.length).toBe(1);
    expect(failures[0]).toMatch(/expected tool .* to return a FAILURE/);
  });

  // AUDIT: 'Claire said the video was rendering "with the waist measure clip"
  // when the call she made specified no clip at all.' Category `false-success`
  // / `silent-wrong` — the largest behaviour-caused categories at 49 and 51.
  it('claimsRequireToolSupport flags prose unsupported by any tool result', () => {
    const trace: HarnessTrace = {
      fixtureId: 'fx',
      perTurn: [
        makeTurn({
          userMessage: 'hi',
          finalText: 'Rendering now with the waist measure clip.',
          toolCalls: [
            {
              name: 'videos_createDraftVideo',
              input: {},
              result: { ok: true, data: { clips: ['auto-1', 'auto-2'] } },
            },
          ],
        }),
      ],
    };
    const failures = compareFixture(
      decisionFixture({
        claimsRequireToolSupport: [
          { phrase: 'waist measure clip', support: 'waist-measure' },
        ],
      }),
      trace
    );
    expect(failures.length).toBe(1);
    expect(failures[0]).toMatch(
      /claims "waist measure clip" but NO tool result/
    );
  });

  it('claimsRequireToolSupport stays silent when a tool result backs the claim', () => {
    const trace: HarnessTrace = {
      fixtureId: 'fx',
      perTurn: [
        makeTurn({
          userMessage: 'hi',
          finalText: 'Rendering now with the waist measure clip.',
          toolCalls: [
            {
              name: 'videos_createDraftVideo',
              input: {},
              result: { ok: true, data: { clips: ['waist-measure-01'] } },
            },
          ],
        }),
      ],
    };
    expect(
      compareFixture(
        decisionFixture({
          claimsRequireToolSupport: [
            { phrase: 'waist measure clip', support: 'waist-measure' },
          ],
        }),
        trace
      )
    ).toEqual([]);
  });

  it('claimsRequireToolSupport ignores a phrase Claire never said', () => {
    const trace: HarnessTrace = {
      fixtureId: 'fx',
      perTurn: [makeTurn({ userMessage: 'hi', finalText: 'Rendering now.' })],
    };
    expect(
      compareFixture(
        decisionFixture({
          claimsRequireToolSupport: [
            { phrase: 'waist measure clip', support: 'waist-measure' },
          ],
        }),
        trace
      )
    ).toEqual([]);
  });

  it('flags hard-block mismatches', () => {
    const fixture: ClaireFixture = {
      id: 'fx',
      description: '',
      category: 'hard-block',
      turns: [
        {
          userMessage: 'hi',
          expect: { hardBlockTriggered: 'noFabricatedResultClaims' },
        },
      ],
    };
    const trace: HarnessTrace = {
      fixtureId: 'fx',
      perTurn: [makeTurn({ userMessage: 'hi' })],
    };
    const failures = compareFixture(fixture, trace);
    expect(failures[0]).toMatch(
      /expected hard block "noFabricatedResultClaims"/
    );
  });

  it('flags responseLacks violations', () => {
    const fixture: ClaireFixture = {
      id: 'fx',
      description: '',
      category: 'persona',
      turns: [
        {
          userMessage: 'hi',
          expect: { responseLacks: ['just'] },
        },
      ],
    };
    const trace: HarnessTrace = {
      fixtureId: 'fx',
      perTurn: [
        makeTurn({
          userMessage: 'hi',
          finalText: 'I just wanted to say hi.',
        }),
      ],
    };
    const failures = compareFixture(fixture, trace);
    expect(failures[0]).toMatch(/expected response NOT to contain "just"/);
  });

  it('preserves order semantics for toolsCalled', () => {
    const fixture: ClaireFixture = {
      id: 'fx',
      description: '',
      category: 'tool-dispatch',
      turns: [
        {
          userMessage: 'hi',
          expect: { toolsCalled: ['a', 'b', 'c'] },
        },
      ],
    };
    const trace: HarnessTrace = {
      fixtureId: 'fx',
      perTurn: [
        makeTurn({
          userMessage: 'hi',
          toolCalls: [
            { name: 'b', input: {}, result: { ok: true } },
            { name: 'a', input: {}, result: { ok: true } },
            { name: 'c', input: {}, result: { ok: true } },
          ],
        }),
      ],
    };
    const failures = compareFixture(fixture, trace);
    // 'a' was called AFTER 'b', so the in-order check fails on 'b'
    // having no later instance, OR on 'a' being unreachable from the
    // post-'b' cursor. Either way, at least one failure.
    expect(failures.length).toBeGreaterThan(0);
  });
});

/**
 * Fixtures committed WITHOUT a recording yet, and the reason.
 *
 * A RATCHET that may only shrink. Recording costs a live Anthropic call per
 * fixture, so a set can land before someone runs `EVAL_RECORD=1` — but it must
 * not land silently: an un-recorded fixture that this suite quietly skipped
 * would read as a pass forever, which is worse than no fixture at all.
 *
 * Populate with:
 *   EVAL_RECORD=1 ANTHROPIC_API_KEY=… pnpm test:eval-claire-heldout
 */
const AWAITING_RECORDING: Record<string, string> = {
  // EMPTY, and it must stay that way.
  //
  // The three branch-pricing fixtures sat here, filtered out of the pass check
  // below — so the gate guarding the location redesign's headline risk was
  // green with nothing behind it, which is worse than having no gate at all.
  // They are recorded now and assert for real.
  //
  // One of them could never have passed as written: it asked "How much is
  // Botox?" and Claire correctly refuses to quote prescription-only medicine
  // prices in chat, so she never called listServices and never said a number.
  // The fixture now uses a service that carries no such restriction. If an
  // entry is ever added here, treat it as an outage of that gate, not as
  // bookkeeping.
};

describe('runEval over committed fixtures + recordings', () => {
  it('every committed fixture passes in replay mode', async () => {
    // Dynamically import so the global mocks have already loaded.
    const { runEval } = await import('./runner.js');
    const summary = await runEval({
      mode: 'replay',
      log: () => {
        // Suppress console.log during the test.
      },
    });
    // Un-recorded fixtures are accounted for by the ratchet below, not here.
    summary.outcomes = summary.outcomes.filter(
      (o) => !(o.fixtureId in AWAITING_RECORDING)
    );
    summary.failed = summary.outcomes.filter((o) => !o.passed).length;

    if (summary.failed !== 0) {
      const failureLines = summary.outcomes
        .filter((o) => !o.passed)
        .map((o) => `  ${o.fixtureId}: ${o.failures.join(' | ')}`)
        .join('\n');
      throw new Error(`${summary.failed} fixture(s) failed:\n${failureLines}`);
    }
    expect(summary.passed).toBeGreaterThan(0);
  });

  it('every AWAITING_RECORDING entry is a real fixture that is still un-recorded', async () => {
    // Keeps the exemption list from becoming a place fixtures go to die. An
    // entry naming a fixture that no longer exists, or one that HAS since been
    // recorded, is stale and must be deleted — otherwise the list silently
    // suppresses a fixture that is now working, and the next real failure in it
    // goes unnoticed.
    const { loadFixtureModules } = await import('./runner.js');
    const { readRecording } = await import('./recording.js');
    const ids = new Set((await loadFixtureModules()).map((m) => m.default.id));

    const stale: string[] = [];
    for (const id of Object.keys(AWAITING_RECORDING)) {
      if (!ids.has(id)) {
        stale.push(`${id} — no such fixture`);
        continue;
      }
      if (await readRecording(id)) {
        stale.push(`${id} — now recorded, remove the entry`);
      }
    }

    expect(
      stale,
      `Stale AWAITING_RECORDING entries:\n${stale.map((l) => `  ${l}`).join('\n')}`
    ).toEqual([]);
  });

  it('gives every awaiting-recording entry a reason', () => {
    for (const [id, reason] of Object.entries(AWAITING_RECORDING)) {
      expect(reason.length, `${id} needs a real reason`).toBeGreaterThan(20);
    }
  });
});

function makeTurn(
  overrides: Partial<HarnessTurnTrace> & { userMessage: string }
): HarnessTurnTrace {
  return {
    userMessage: overrides.userMessage,
    loadedSkillIdsAtStart: ['default'],
    loadedSkillIdsAtEnd: overrides.loadedSkillIdsAtEnd ?? ['default'],
    toolCalls: overrides.toolCalls ?? [],
    hardBlockEvents: overrides.hardBlockEvents ?? [],
    confirmationEvents: overrides.confirmationEvents ?? [],
    skillLoadEvents: overrides.skillLoadEvents ?? [],
    finalText: overrides.finalText ?? '',
    rounds: overrides.rounds ?? 1,
    ...(overrides.classifierCall
      ? { classifierCall: overrides.classifierCall }
      : {}),
  };
}
