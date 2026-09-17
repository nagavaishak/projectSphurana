/**
 * Claire tool factory — public exports.
 *
 * The factory bundles five layers around every Anthropic tool the assistant
 * exposes:
 *   1. Per-turn tool-call counter
 *   2. Input validation
 *   3. Telemetry (Sentry breadcrumbs + intentional PostHog events)
 *   4. Confirmation enforcement (DB-persisted tokens) for destructive tools
 *   5. Hard-block validators (defense in depth — see `hard-blocks.ts`)
 *
 * @see docs/implementations/claire-briefs/track-c02.md §§Step 4–5
 * @see docs/implementations/claire-briefs/window-c02-c.md
 * @see docs/implementations/claire-briefs/window-c02-d.md
 */

export { defineTool, type DefineToolConfig } from './define-tool.js';

export {
  buildAssistantToolsContext,
  type BuildToolsContextInput,
} from './tool-context.js';

export {
  createToolCallCounter,
  MAX_TOOL_CALLS_PER_REQUEST,
  type ToolCallCounter,
} from './tool-call-limit.js';

export {
  createToolFailureTracker,
  recordToolFailure,
  toolFailureSignature,
  applyStopAndAsk,
  DEFAULT_FAILURE_THRESHOLD,
  type ToolFailureTracker,
  type StopAndAskPresentation,
} from './failure-tracker.js';

export {
  ALLOWED_API_PATHS,
  isPathAllowed,
} from './path-whitelist.js';

export {
  sanitizeApiError,
  STATUS_MESSAGES,
  INTERNAL_ERROR_PATTERNS,
} from './error-sanitization.js';

export {
  ApiFetchError,
  ApiResponseContractError,
  createApiFetch,
  type ApiFetchFn,
  type ApiFetchOptions,
  type CreateApiFetchConfig,
  type InternalAuthConfig,
} from './api-fetch.js';

export {
  trackToolCalled,
  trackToolFailed,
  trackToolConfirmed,
  trackOpusRouted,
  type ToolCalledProps,
  type ToolFailedProps,
  type ToolConfirmedProps,
  type OpusRoutedProps,
} from './telemetry.js';

export {
  createConfirmation,
  verifyConfirmation,
  type CreateConfirmationFnInput,
  type CreatedConfirmation,
  type VerifyConfirmationFnInput,
} from './confirmation.js';

export {
  fetchServiceCatalogue,
  type ServiceCatalogue,
} from './service-catalogue.js';

export {
  hardBlockValidators,
  runHardBlockValidators,
  type HardBlockValidator,
  type HardBlockValidatorName,
} from './hard-blocks.js';

export type {
  AnthropicToolDefinition,
  AssistantToolsContext,
  ConfirmationSummary,
  HardBlockResult,
  HardBlockRunner,
  PresentationPayload,
  ToolDefinition,
  ToolPresentation,
  ToolResult,
} from './types.js';
// Separate module on purpose: this is the ONLY file here that imports the
// database barrel as a VALUE. Folding it into `tool-context.ts` pulled the ESM
// schema graph into every spec that loads a tool context.
export { resolveCallerRole } from './caller-role.js';
