/**
 * Public surface of the Claire eval harness.
 *
 * The CLI entry (`run-eval.ts`) is the runtime entrypoint; importers that
 * need to embed the runner in another tool (e.g. the future
 * controller-call adapter in W-C04-A-finish) consume `runEval` and the
 * type surface here.
 *
 * @see ./README.md
 */

export { runFixture, DEFAULT_ORG_CONTEXT, HarnessError } from './harness.js';
export type {
  AnthropicMessage,
  AnthropicMessageContent,
  AnthropicMessageRole,
  LiveModelCallInput,
  LiveModelCallOutput,
  LiveProvider,
  RecordingProvider,
  RunFixtureOptions,
} from './harness.js';

export { runEval, compareFixture, loadFixtureModules } from './runner.js';
export type { FixtureModule, RunnerOptions } from './runner.js';

export {
  readRecording,
  writeRecording,
  recordingPath,
  recordingsDir,
} from './recording.js';

export { KNOWN_PRESENTATION_TYPES } from './types.js';
export type {
  ClaireFixture,
  EvalMode,
  FixtureCategory,
  FixtureExpectation,
  FixtureOutcome,
  FixtureSetup,
  FixtureTurn,
  HarnessHardBlockCheck,
  HarnessPresentation,
  HarnessRecording,
  HarnessToolCall,
  HarnessToolResult,
  HarnessToolStub,
  HarnessTrace,
  HarnessTurnTrace,
  RecordedRound,
  RecordedToolUse,
  RecordedTurn,
  RunSummary,
} from './types.js';
