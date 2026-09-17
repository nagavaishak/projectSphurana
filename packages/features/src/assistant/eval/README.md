# Claire eval harness

Integration tests for Claire's prompt + skill + classifier plumbing, plus
— since the decision assertions landed — a place to pin the DECISIONS she
makes, not only the wiring that carries them.

The plumbing half catches regressions on prompt content, skill registry
shape, and tool-dispatch flow before they reach the live controller.

## Why the decision assertions exist

The production conversation audit produced 717 defect findings. Root causes:
**prompt behaviour 50.6%**, product bug 23.3%, missing feature 13.2%. The
behavioural half is the largest single slice, and NONE of it was reachable by
this harness, because every original assertion key read tool NAMES,
presentation envelopes, skill IDs or the final text — never a tool INPUT and
never a tool RESULT, both of which the trace has always carried.

Concretely, all three of these dispatch perfectly and kept every plumbing
assertion green:

| Audit shape | Example | Key |
|---|---|---|
| wrong tool chosen | `create` called 158x where `regenerate` was correct; "make me 2 ads" answered with the ORGANIC-post graphic tool, output labelled "Ad 1"/"Ad 2" | `toolsNotCalled` |
| refusal relayed as success | "all 50 leads are now marked contacted" when every status update in the session had failed | `toolFailed` + `responseLacks` |
| state asserted, never read back | "rendering with the waist measure clip" when the call specified no clip at all | `claimsRequireToolSupport` |

`toolsCalled` cannot express the first: it is a positive subsequence match
that TOLERATES extra calls, so "also called the wrong one" is invisible to it.

### Limits, stated

- `claimsRequireToolSupport` catches ENUMERATED claims, not novel
  hallucination. A general detector needs an LLM judge in the comparator,
  which would break the property that replay mode makes no API call.
- In **replay** mode the model output is read from `recordings/<id>.json`, so
  a decision assertion gates a FROZEN transcript. It detects a recording
  re-recorded into a bad decision — not that today's model would make one.
  Only `EVAL_RECORD=1` / `test:eval-claire-live` exercises live choice.
  Decision fixtures therefore have different CI value from plumbing fixtures;
  re-record them when the prompt or the tool set changes.
- `toolFailed` fails the fixture when the named tool SUCCEEDED, deliberately:
  a relay check whose tool did not refuse proves nothing and must not read as
  a pass.

> **Scope (W-C04-A-prep):** in-process composition of orchestrator +
> skills + classifier, exercised via fixture recordings. The live
> controller adapter (HTTP + streaming + factory wrapping) ships in
> **W-C04-A-finish** once **W-C02-E** lands. Until then, the live
> Anthropic call in `record` mode bypasses the factory's tool wrapping
> — fixtures supply their own simulated tool results.

---

## Modes

The harness supports two modes:

| Mode | What it tests | Cost | When to run |
|---|---|---|---|
| **In-process** (default) | Orchestrator + skill registry + classifier + tool dispatch shape | None — replay-from-disk | Every PR (CI gate); fast iteration during prompt/skill/factory development |
| **Live-controller** | Adds `runToolLoop` SDK round-trip + `emitUIStreamEvent` SSE encoding + AI-SDK message-stream protocol | One Anthropic API call per fixture per run | Before merging changes to `assistant-chat.controller.ts`; after edits to `apps/api/src/assistant/lib/` |

Rule of thumb: **in-process** is the day-to-day mode; **live-controller**
runs at controller-pipeline change time. Both run the same fixtures + the
same `compareFixture` assertions — what differs is the engine driving each
turn.

## Run — in-process mode

```bash
# Replay (CI default — no API key required)
pnpm test:eval-claire

# Live recording (overwrites recordings/<id>.json on success)
EVAL_RECORD=1 ANTHROPIC_API_KEY=sk-ant-… pnpm test:eval-claire

# Subset / debug
EVAL_FILTER=hard-block pnpm test:eval-claire   # only fixtures whose ID contains "hard-block"
EVAL_SERIAL=1 pnpm test:eval-claire             # one at a time (preserves stdout interleaving)
```

The runner exits non-zero if any fixture fails. Output is a per-category
summary table plus a "Failures" section listing each failed expectation.

## Run — live-controller mode

```bash
# Drives every fixture through the controller pipeline: runToolLoop +
# emitUIStreamEvent + AI SDK UI message stream protocol. Requires
# ANTHROPIC_API_KEY.
pnpm test:eval-claire-live

# Subset
EVAL_FILTER=confirmation-launch-ad pnpm test:eval-claire-live
EVAL_SERIAL=1 pnpm test:eval-claire-live
```

The live-controller adapter lives at
`apps/api/src/assistant/eval/controller-pipeline-adapter.ts` (it can't live
in features because features can't import apps/api types). The adapter:

1. Builds the same orchestrator system blocks the controller builds.
2. Wraps each fixture stub as a `ToolDefinition` and feeds the set into
   `runToolLoop`.
3. Captures every `emitUIStreamEvent` write into a string buffer.
4. Parses the SSE byte stream back into events and asserts a 1:1
   round-trip against the events the controller emitted in-process.
5. Translates the events into a `HarnessTrace` for `compareFixture`.

**v1 limitations** (deferred to follow-ups):

- **Record-only.** SSE byte streams aren't yet captured to disk; every run
  hits the live API. CI gates the live-controller job on
  `secrets.ANTHROPIC_API_KEY` being set; without the secret the job is a
  no-op.
- **No DB / auth / plan checks.** The adapter exercises the controller's
  inner pipeline (orchestrator → tool loop → SSE) but not its outer
  wrapping (auth guard, plan/quota gates, conversation persistence).
  Those are covered by the existing Playwright e2e suite + the factory's
  unit tests.
- **No legacy ad/video/content tools.** Fixtures that exercise those
  currently rely on stubs (which the adapter respects). When Phase 2/3
  ports replace the legacy shim, the adapter picks them up automatically
  via the same `ToolDefinition` resolution path the controller uses.

---

## How the harness works

The runner discovers `eval/fixtures/*.fixture.ts` and runs each through
`runFixture`. For every fixture it:

1. Resolves the **loaded skill set** — either from `setup.initialLoadedSkillIds` (skipping the classifier) or by running `classifyIntent` on the first user message.
2. Builds the **orchestrator system blocks** via `buildOrchestratorPrompt` (including business-context interpolation from a `DEFAULT_ORG_CONTEXT` you can override per-fixture).
3. Resolves the **tool list** for the loaded skills via `buildToolListForSkills`, plus the always-loaded `meta_loadSkill` / `meta_dispatchTour`.
4. Drives the **manual tool loop**:
   - `replay` mode reads the round + tool result from `recordings/<id>.json`.
   - `record` mode calls Anthropic with the system blocks + tools + messages, parses the response, and feeds tool results back from the fixture's tool stubs.
5. Captures a **trace**: tool calls, tool results, hard-block events, confirmation events, skill-load events, the final assistant text. Compared against `expect`.

The harness intentionally does NOT call the factory in `apps/api/src/assistant/tool-factory/`. The factory's wrapping (counter, telemetry, confirmation tokens, hard-block runner) is verified by its own unit tests; this harness verifies the integration of the in-package pieces (orchestrator + skills + classifier) plus the wire-level invariants (which tools fire, what presentation envelopes come back, which skills end up loaded). The full live-controller adapter ships in W-C04-A-finish.

---

## Fixture file shape

A fixture lives at `eval/fixtures/<id>.fixture.ts` and exports a `default`
`ClaireFixture` plus an optional `toolStubs` array.

```ts
import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'tool-dispatch-services',
  description: 'User asks about services; Claire calls listServices.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['default'] },
  turns: [
    {
      userMessage: 'What services do I offer?',
      expect: {
        toolsCalled: ['context_listServices'],
        responseContains: ['Lip filler'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'context_listServices',
    respond: () => ({
      ok: true,
      data: { services: [/* … */], total: 4 },
    }),
  },
];

export default fixture;
```

Categories: `tool-dispatch` | `hard-block` | `persona` | `classifier` |
`confirmation` | `mid-turn-skill`.

### Expectation matching

- `toolsCalled` — array of tool names that must appear in the trace **in this order** (other tool calls between them are tolerated).
- `hardBlockTriggered` — code of a `hard_block_violation` presentation that must appear at least once.
- `responseContains` / `responseLacks` — substring search on the **final** assistant text (case-insensitive).
- `skillsLoaded` — every listed skill ID must end up in `loadedSkillIds` by the end of the turn.
- `confirmationPresented` — a `confirmation_required` presentation for this action must appear at least once.

Every field is optional. A persona fixture might only assert `responseContains` / `responseLacks`. A hard-block fixture might assert only `hardBlockTriggered`. Match tightly to what the fixture is actually checking.

### Tool stubs

A stub names a tool and supplies its simulated result. For destructive
tools, the stub mirrors the factory's two-call confirmation flow:

```ts
{
  name: 'confirmLaunchAd',
  destructive: true,
  destructiveAction: 'launch_ad',
  hardBlockChecks: [
    {
      code: 'noFabricatedResultClaims',
      evaluate: (input) => /99%/.test(JSON.stringify(input)) ? 'No fabricated claims.' : null,
    },
  ],
  summarizeForConfirmation: (input) => ({
    title: 'Launch ad',
    fields: [{ label: 'Headline', value: 'Lip filler that suits your face' }],
    resourceId: String(input.adId ?? 'ad-1'),
  }),
  respond: () => ({ ok: true, data: { launched: true } }),
}
```

The harness invokes `hardBlockChecks` before issuing a confirmation; on
fail it emits a `hard_block_violation` presentation. On the second call
(input carrying a `confirmationToken`), the harness invokes `respond`.

`meta_loadSkill` and `meta_dispatchTour` have **built-in** harness
behaviour — fixtures don't need stubs unless they want to override.

---

## Recordings

Every fixture has a `recordings/<id>.json` file. The recording is the
on-disk transcript of one fixture's run — model text, tool_use sequences,
and the simulated tool_result blocks.

### Format (v1)

```jsonc
{
  "version": 1,
  "fixtureId": "<fixture id>",
  "recordedAt": "<ISO timestamp>",
  "skillRegistryVersion": 1,
  "turns": [
    {
      "userMessage": "…",
      "classifierResponse": { "skillIds": ["…"], "confidence": 0.0 },  // turn 1 only, optional
      "rounds": [
        {
          "modelText": "free text the model emits in this round",
          "toolUses": [
            {
              "name": "tool_name",
              "input": { /* model's args */ },
              "result": { "ok": true, "data": { /* … */ } }
            }
          ],
          "stopReason": "end_turn" | "tool_use" | "max_tokens" | "pause_turn"
        }
      ]
    }
  ]
}
```

Only the **last round's** `modelText` is treated as the final assistant
response (matched by `responseContains` / `responseLacks`). Earlier
rounds typically emit short progress text or none at all.

### When to refresh

Refresh recordings whenever:

- A skill's `promptFragment` changes (`packages/features/src/assistant/skills/*.skill.ts`)
- The orchestrator's persona or block layout changes (`orchestrator.ts`)
- The classifier's system prompt changes (`classify-intent.service.ts`)
- A new tool is added that an existing fixture would call

Skip refresh when:

- Only fixture content (`*.fixture.ts`) changes
- Only types or comments change

### How to refresh

```bash
# Pre-flight: confirm your local skill registry matches what's in the
# fixtures' recordings. Bump SKILL_REGISTRY_VERSION if you've changed
# skill content materially.

# Refresh all recordings
EVAL_RECORD=1 ANTHROPIC_API_KEY=sk-ant-… pnpm test:eval-claire

# Refresh one
EVAL_RECORD=1 ANTHROPIC_API_KEY=sk-ant-… EVAL_FILTER=persona-greeting pnpm test:eval-claire

# Then commit the diff
git add packages/features/src/assistant/eval/recordings/
```

Review the JSON diff before committing — recordings are intentionally
human-readable, and an unexpected change (e.g. a new tool fired that
shouldn't have) is a real regression worth investigating.

### Synthetic vs real recordings

Recordings shipped in W-C04-A-prep are **synthetic** — hand-authored
model responses that match what a real Anthropic call would produce.
This lets CI replay-mode run on day one without an API key, and serves
as "specification by example" for what the fixtures expect.

Real recordings replace these once Daniel runs `EVAL_RECORD=1` locally.
The format is identical; the only diff is the modelText becoming an
actual model output.

---

## CI

`.github/workflows/claire-eval.yml` runs the eval in **replay mode** on
every PR that touches:

- `packages/features/src/assistant/skills/**`
- `packages/features/src/assistant/prompts/**`
- `packages/features/src/assistant/services/classify-intent/**`
- `packages/features/src/assistant/services/append-loaded-skill/**`
- `packages/features/src/assistant/eval/**`
- `apps/api/src/assistant/tool-factory/**`
- `apps/api/src/assistant/tools/**`

Failures block merge. CI does not have `ANTHROPIC_API_KEY`; it never
calls the live API. If you change anything that would invalidate the
existing recordings, refresh them locally and commit alongside your PR.

---

## Known limits (W-C04-A-prep)

This prep harness covers the **structural** integration of:

- Orchestrator system block layout + cache breakpoints
- Skill registry shape + tool-list resolution
- Classifier output normalisation (via the recording's `classifierResponse` field)
- Mid-turn skill loading (the `meta_loadSkill` flow + `loadedSkillIds` mutation)
- The **shape** of tool results (`confirmation_required`, `hard_block_violation`, `tour_dispatch`)

What it does NOT exercise:

- The live tool-factory wrapping (counter, telemetry, sanitization, real confirmation-token persistence) — the factory has its own 36-test suite in `apps/api/src/assistant/tool-factory/`
- The HTTP / SSE / AI SDK message stream layer
- The full controller path including rate-limiting, plan-gating, conversation persistence

W-C04-A-finish closes those gaps by wiring the harness directly to the
live `assistant-chat.controller.ts`. The fixture format and trace shape
stay the same; only the `runFixture` plumbing changes.

---

## Adding a fixture

1. Pick a **category** and write a `<id>.fixture.ts` file.
2. Author the **expected behaviour** in the `expect` block. Tighten,
   don't over-assert. A fixture that asserts everything fails on every
   minor model drift; a fixture that asserts the right invariant
   catches the regression you actually care about.
3. If the fixture exercises tool dispatch, write **stubs** for every
   tool the model is expected to call.
4. **Hand-author** a recording at `recordings/<id>.json` for day-one
   pass, OR run `EVAL_RECORD=1` to capture a real one once
   `ANTHROPIC_API_KEY` is available.
5. Run `pnpm test:eval-claire` locally; iterate until it passes.
6. Commit the fixture + recording together.

For destructive tools, double-check that the recording's tool_result
carries the right presentation (`confirmation_required` vs
`hard_block_violation`) — the harness's trace-event extraction reads
from there.
