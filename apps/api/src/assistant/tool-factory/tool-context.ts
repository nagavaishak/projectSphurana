import type { ClaireConfirmationAction } from '@borradh-workspace/database';
import { logError, logWarning } from '@borradh-workspace/observability';
import { buildAssistantPorts } from '../ports/index.js';
import { type InternalAuthConfig, createApiFetch } from './api-fetch.js';
import { createConfirmation, verifyConfirmation } from './confirmation.js';
import {
  type ToolFailureTracker,
  createToolFailureTracker,
} from './failure-tracker.js';
import { runHardBlockValidators } from './hard-blocks.js';
import {
  type ToolCallCounter,
  createToolCallCounter,
} from './tool-call-limit.js';
import type { AssistantToolsContext, HardBlockRunner } from './types.js';

export interface BuildToolsContextInput {
  organizationId: string;
  /**
   * The org's IANA timezone (`organization.timezone`, via `AssistantContext`).
   * Threaded in so date-bearing tools resolve relative expressions server-side
   * in the org zone (Phase 3). Defaults to `'UTC'` when omitted.
   */
  timezone?: string;
  userId: string;
  /**
   * The caller's org role, from `resolveCallerRole` below. Threaded in rather
   * than looked up here because this builder is synchronous and a DB read is
   * not — and making it async would ripple through every call site for a value
   * the callers can resolve once, alongside the work they already do.
   *
   * Omitting it is FAIL-CLOSED, not permissive: a tool declaring a `policy`
   * refuses when this is absent.
   */
  callerRole?: 'member' | 'admin' | 'owner';
  conversationId: string;
  /**
   * Branch this turn is scoped to, forwarded onto every internal API hop as
   * `X-Location-Id`. On the web path it is the `X-Location-Id` the chat
   * request itself carried — i.e. the branch the user is looking at.
   */
  locationId?: string;
  /** Cookie header forwarded from the chat request, used for internal auth.
   *  Web path. Mutually exclusive with `internalAuth`. */
  cookie?: string;
  /** Bearer authorization forwarded from the web chat request. */
  authorization?: string;
  /** Internal service-auth (loopback acts-as). The WhatsApp worker sets this
   *  instead of `cookie` — it has no browser session. */
  internalAuth?: InternalAuthConfig;
  /** Local API port — internal HTTP target for the apiFetch helper. */
  port: number;
  cdnUrl?: string;
  appUrl?: string;
  /** Existing counter (e.g. shared across multiple controller invocations).
   *  If omitted, a fresh counter is created. */
  callCounter?: ToolCallCounter;
  /** Existing per-turn identical-failure breaker (Phase 4). If omitted, a
   *  fresh tracker is created — shared across every tool call this request. */
  failureTracker?: ToolFailureTracker;
  /** Override the per-tool path-whitelist extension. The factory composes
   *  per-tool extensions inside the wrapped execute; the context-level value
   *  is for tools that need a baseline broader than the shared list. Most
   *  tools should NOT pass this — prefer `additionalAllowedPaths` on
   *  `defineTool` so the extension is co-located with the tool. */
  additionalAllowedPaths?: readonly RegExp[];
  /** Optional override of the hard-block runner — tests use this to inject
   *  a deterministic runner without touching the production stub. */
  runHardBlocks?: HardBlockRunner;
  /** Transport channel (WS-8). Defaults to `'web'`; the WhatsApp worker
   *  (WS-10) passes `'whatsapp'`. */
  channel?: 'web' | 'whatsapp';
  /** Destructive actions the worker has determined the user affirmed for this
   *  turn (WS-8). Only honored on the `'whatsapp'` channel. */
  confirmedActions?: readonly ClaireConfirmationAction[];
}

/**
 * Build the per-request context the factory passes into every wrapped
 * `execute`. The controller (W-C02-E) calls this once per chat request.
 *
 * Note: the per-tool `additionalAllowedPaths` declared on `defineTool` is
 * applied inside the factory's wrapped execute, *after* the shared whitelist
 * the context already carries. That means a tool's extension is scoped only
 * to its own calls.
 */
export function buildAssistantToolsContext(
  input: BuildToolsContextInput
): AssistantToolsContext {
  const callCounter = input.callCounter ?? createToolCallCounter();
  const failureTracker = input.failureTracker ?? createToolFailureTracker();
  // Auth mode is fixed per context: internal acts-as for workers, or the
  // originating cookie/bearer credentials for web requests.
  const authConfig = input.internalAuth
    ? { internalAuth: input.internalAuth }
    : { cookie: input.cookie, authorization: input.authorization };
  const apiFetch = createApiFetch({
    ...authConfig,
    port: input.port,
    locationId: input.locationId,
    additionalAllowedPaths: input.additionalAllowedPaths,
  });
  const buildApiFetch: AssistantToolsContext['buildApiFetch'] = (extraPaths) =>
    createApiFetch({
      ...authConfig,
      port: input.port,
      locationId: input.locationId,
      additionalAllowedPaths: input.additionalAllowedPaths
        ? [...input.additionalAllowedPaths, ...extraPaths]
        : extraPaths,
    });

  return {
    organizationId: input.organizationId,
    locationId: input.locationId,
    timezone: input.timezone ?? 'UTC',
    userId: input.userId,
    callerRole: input.callerRole,
    conversationId: input.conversationId,
    channel: input.channel,
    confirmedActions: input.confirmedActions,
    apiFetch,
    buildApiFetch,
    // Gate 2 — capability ports, assembled once per request. Tools that have
    // been ported call `ctx.ports.<capability>` and never touch `apiFetch`,
    // so their result shape is the port's discriminated union rather than
    // whatever the HTTP hop happened to return.
    ports: buildAssistantPorts({
      apiFetch,
      organizationId: input.organizationId,
      channel: input.channel,
      conversationId: input.conversationId,
    }),
    // Base reporter — the factory replaces this per-call with a tool-bound
    // version that also attaches the tool name. This fallback only fires if a
    // wrapped execute is ever invoked with the raw context.
    reportIssue: (summary, opts) => {
      const extra = {
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        summary,
        ...opts?.extra,
      };
      if ((opts?.level ?? 'warning') === 'error') {
        logError('claire.tool', opts?.error ?? new Error(summary), {
          feature: 'claire',
          user: { id: input.userId },
          extra,
        });
      } else {
        logWarning('claire.tool', summary, {
          feature: 'claire',
          user: { id: input.userId },
          extra,
        });
      }
    },
    cdnUrl: input.cdnUrl,
    appUrl: input.appUrl,
    callCounter,
    failureTracker,
    runHardBlocks: input.runHardBlocks ?? runHardBlockValidators,
    createConfirmation: (args) =>
      createConfirmation({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        ...args,
      }),
    verifyConfirmation: (args) =>
      verifyConfirmation({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        ...args,
      }),
  };
}
