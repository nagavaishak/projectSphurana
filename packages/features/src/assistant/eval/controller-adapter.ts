/**
 * Live-controller adapter — contract.
 *
 * The actual adapter implementation lives in
 * `apps/api/src/assistant/eval/controller-pipeline-adapter.ts`. The features
 * package can't import from apps/api (TypeScript project-reference direction);
 * the brief originally placed this file in features but the implementation
 * has to live alongside the controller's `lib/` modules
 * (`runToolLoop`, `emit-ui-stream-event`, etc.) it exercises.
 *
 * This file exists to:
 *
 *  1. Document the live-controller mode for anyone reading the eval surface
 *     in features (where the in-process harness lives).
 *  2. Re-export the runner-level types the apps/api adapter feeds back to
 *     `compareFixture`. Right now the apps/api side imports those types
 *     directly via `@borradh-workspace/features/assistant`, so this file
 *     stays slim — it's a documentation anchor, not a code path.
 *
 * **How to run live-controller mode:**
 *
 * ```bash
 * # From repo root — requires ANTHROPIC_API_KEY in .env
 * pnpm test:eval-claire-live
 *
 * # Or filter to one fixture
 * EVAL_FILTER=confirmation-launch-ad pnpm test:eval-claire-live
 * ```
 *
 * **What it validates** (delta vs in-process):
 *
 *  - `runToolLoop` round-trip through the Anthropic streaming SDK
 *  - `emitUIStreamEvent` chunk shapes (AI SDK UI message stream protocol)
 *  - `writeUIStreamHeaders` / `closeUIStream` framing
 *  - SSE byte-stream → parsed-event round-trip (catches encoder/parser drift)
 *
 * **What it does NOT validate** (deferred to other layers):
 *
 *  - HTTP transport (`AuthGuard`, plan/quota gates) — Playwright e2e covers
 *  - DB-backed confirmation tokens — factory unit tests cover (W-C02-C)
 *  - Real classifier / knowledge / orchestrator content — in-process replay
 *    catches changes faster
 *  - Replay-from-recorded-SSE-stream — deferred follow-up; v1 is record-only
 *
 * **CI behaviour:**
 *
 *  - In-process replay job: runs on every PR touching prompt/skill/factory
 *    paths (no API key required).
 *  - Live-controller job: gated on `secrets.ANTHROPIC_API_KEY`. Currently
 *    skipped automatically when the secret isn't available.
 *
 * @see ../../../../apps/api/src/assistant/eval/controller-pipeline-adapter.ts
 * @see docs/implementations/claire-briefs/window-c04-a-finish.md
 */

/**
 * Sentinel marker so TypeScript treats this as a module (it would otherwise
 * be ambient with no exports). The value isn't consumed by callers — it's
 * just here so `import('./controller-adapter.js')` resolves cleanly if
 * downstream tooling globs the eval directory.
 */
export const LIVE_CONTROLLER_ADAPTER_LOCATION =
  'apps/api/src/assistant/eval/controller-pipeline-adapter.ts';
