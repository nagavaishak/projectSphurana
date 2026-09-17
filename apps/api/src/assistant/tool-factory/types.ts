import type { ClaireConfirmationAction } from '@borradh-workspace/database';
import type { ZodType } from 'zod';
import type { AssistantPorts } from '../ports/index.js';
import type { ApiFetchFn } from './api-fetch.js';
import type { ToolFailureTracker } from './failure-tracker.js';
import type { ToolCallCounter } from './tool-call-limit.js';

/**
 * Anthropic SDK tool definition shape — what `client.messages.create({ tools })`
 * accepts. The factory produces this from the Zod input schema; callers don't
 * hand-write JSON schemas.
 */
export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/**
 * Result of running a hard-block validator (or the whole list).
 */
export type HardBlockResult =
  | { pass: true }
  | { pass: false; code: string; message: string };

/**
 * Runs a list of named hard-block validators against the proposed tool
 * input. Real implementation lives in `hard-blocks.ts`
 * (`runHardBlockValidators`); tests can inject an alternative via
 * `BuildToolsContextInput.runHardBlocks`.
 */
export type HardBlockRunner = (
  names: readonly string[],
  input: unknown,
  ctx: AssistantToolsContext
) => Promise<HardBlockResult>;

/**
 * Presentation hints attached at definition time, used by the factory when
 * it auto-emits confirmation/status payloads.
 */
export interface ToolPresentation {
  /** Short label shown in the chain-of-thought view while the tool runs. */
  statusLabel?: string;
  /**
   * Frontend rich-content renderer name. Maps to a component in
   * `apps/web/src/features/assistant/components/rich-content/`. The factory
   * propagates this into the `confirmation_required` payload so the UI knows
   * which renderer to mount.
   */
  confirmationRenderer?: string;
}

/**
 * Confirmation summary — what the operator sees when asked to approve a
 * destructive action. Authored by each destructive tool's
 * `summarizeForConfirmation` callback.
 */
export interface ConfirmationSummary {
  title?: string;
  fields?: { label: string; value: string }[];
  /**
   * The thing being acted on (adId, appointmentId, offerId, etc.). Used as
   * the `resourceId` on the persisted token row and matched in second-call
   * verification.
   */
  resourceId: string;
  /**
   * Frozen action input — stored on the token row so the second call can be
   * validated against what was originally proposed (the model can't quietly
   * change its mind between confirmation and execution).
   */
  payload?: Record<string, unknown>;
}

/**
 * The presentation envelope a tool result can carry. The frontend uses
 * the `type` discriminator to mount the right rich-content renderer.
 *
 * Library-emitted variants:
 *   - confirmation_required  (factory emits when a destructive tool first runs)
 *   - confirmation_expired   (factory emits when token verification fails)
 *   - hard_block_violation   (factory emits when a hard-block validator fails)
 *
 * Tool-emitted variants are open: any object with a string `type` discriminator
 * the frontend renderer knows.
 */
export type PresentationPayload =
  | {
      type: 'confirmation_required';
      action: ClaireConfirmationAction;
      resourceId: string;
      token: string;
      expiresAt: string;
      summary?: { title?: string; fields?: { label: string; value: string }[] };
      executeToolName: string;
      renderer?: string;
    }
  | {
      type: 'confirmation_expired';
      reason:
        | 'expired'
        | 'consumed'
        | 'mismatch'
        | 'not_found'
        | 'no_user_turn';
    }
  | { type: 'hard_block_violation'; code: string; message: string }
  | (Record<string, unknown> & { type: string });

/**
 * Discriminated result returned by every wrapped tool execute. The
 * controller serialises this into the model's `tool_result` content block.
 */
export type ToolResult<O = unknown> =
  | {
      ok: true;
      data?: O;
      presentation?: PresentationPayload;
    }
  | {
      ok: false;
      error: string;
      code?: string;
      presentation?: PresentationPayload;
    };

/**
 * Context object passed into every tool's wrapped `execute`. The controller
 * builds one of these per chat request; all tools in the turn share it.
 */
export interface AssistantToolsContext {
  organizationId: string;
  /**
   * The branch this turn is scoped to, if any. Tools that reach the API via
   * `apiFetch` get it applied for free (it rides as `X-Location-Id`); this is
   * exposed so a tool can NAME the branch in its output.
   */
  locationId?: string;
  /**
   * The organisation's IANA timezone (e.g. "Europe/Dublin"), from
   * `organization.timezone`. The single time source for date-bearing tools
   * (Phase 3): tools resolve the user's relative date expressions ("tomorrow",
   * "valid for 2 weeks", "this week") against the real server clock in THIS
   * zone and echo the resolved absolute value back — the model never does date
   * arithmetic. Defaults to `'UTC'` when the builder can't resolve the org zone.
   */
  timezone: string;
  userId: string;
  /**
   * The caller's org role, resolved from the `member` table by whoever built
   * this context — the SAME source `RoleGuard` reads.
   *
   * Present so a tool's declared `policy` can actually be ENFORCED. Optional
   * only because not every construction site can resolve it (eval harnesses,
   * some tests); when it is absent and a tool declares a policy, the factory
   * REFUSES. Fail-closed is the only safe default here: the alternative is a
   * capability that quietly loses its role gate whenever role resolution is
   * skipped, which is exactly the regression this field exists to prevent.
   */
  callerRole?: 'member' | 'admin' | 'owner';
  conversationId: string;
  /**
   * Transport channel for this turn. Defaults to `'web'` when omitted (the
   * SSE/frontend path). On `'whatsapp'` there is no frontend button to echo a
   * confirmation token, so the destructive-action gate is satisfied by an
   * inbound text affirmation resolved upstream in the worker — see
   * `confirmedActions`. (WS-8)
   */
  channel?: 'web' | 'whatsapp';
  /**
   * Destructive actions the worker has already determined the user affirmed
   * for THIS turn (e.g. an inbound "launch" reply matching a pending ad
   * preview). Only consulted on the `'whatsapp'` channel. When a destructive
   * tool's `destructiveAction` is listed here, the factory treats it as
   * confirmed and executes WITHOUT issuing/verifying a confirmation token.
   *
   * The decision of *whether* an inbound message is an affirmation lives in
   * the worker/model (WS-9/WS-10), NOT in the tool — this array is purely the
   * plumbing that carries that decision into the gate. On web this is
   * undefined and the existing token flow is unchanged. (WS-8)
   */
  confirmedActions?: readonly ClaireConfirmationAction[];
  /**
   * Capability ports — the typed description of what a tool may do, assembled
   * at the composition root (`../ports/index.ts`).
   *
   * Prefer these over `apiFetch` for anything a port already covers. A ported
   * tool gets a discriminated union it must branch on, instead of an untyped
   * response bag it can mis-describe: `videos_createDraftVideo` returned
   * `{ rendered: true, status: 'queued' }` 47 times in production, and Claire
   * honestly relayed it as "your video is rendering".
   */
  ports: AssistantPorts;
  /** Authenticated internal API fetch. Path-whitelisted to the base list. */
  apiFetch: ApiFetchFn;
  /**
   * Build a fresh `apiFetch` whose whitelist is the base list plus the
   * provided extra patterns. The factory calls this for tools that declare
   * `additionalAllowedPaths`. Cookie + port are encapsulated by the
   * controller-side builder; tools never need to see them.
   */
  buildApiFetch: (extraPaths: readonly RegExp[]) => ApiFetchFn;
  /**
   * Manually surface a problem to Sentry from inside a tool's `execute`.
   *
   * Use this for the "soft failure" path: when a tool deliberately catches an
   * error and returns a friendly `{ data }` message to the model instead of
   * throwing (so the factory sees `ok: true` and would otherwise log nothing).
   * Thrown errors are already captured by the factory at error level — you do
   * NOT need to call this before re-throwing.
   *
   * The factory injects a tool-bound implementation into every `execute`'s
   * context, so the tool name, organization, user, and conversation id are
   * attached automatically — callers only supply the summary and (optionally)
   * the underlying error + extra context.
   *
   * Defaults to `warning` level. Pass `level: 'error'` for a hard failure the
   * tool is masking but that genuinely broke the user's request.
   */
  reportIssue: (
    summary: string,
    opts?: {
      error?: unknown;
      level?: 'warning' | 'error';
      extra?: Record<string, unknown>;
    }
  ) => void;
  cdnUrl?: string;
  appUrl?: string;
  /** Per-turn counter shared across every tool call this request. */
  callCounter: ToolCallCounter;
  /**
   * Per-turn identical-failure breaker (Phase 4). Shared across every tool
   * call this request. When a single tool fails identically `threshold` times,
   * the factory converts the failure into a `stop_and_ask` result so the model
   * stops retrying and asks the user. Optional so construction sites that don't
   * supply one (some tests) simply run without the breaker.
   */
  failureTracker?: ToolFailureTracker;
  /** Hard-block validator dispatcher. Defaults to `runHardBlockValidators`
   *  from `./hard-blocks.js`; tests inject deterministic alternatives. */
  runHardBlocks: HardBlockRunner;
  /** Issue a new confirmation token row for a destructive action. */
  createConfirmation: (input: {
    action: ClaireConfirmationAction;
    resourceId: string;
    payload?: Record<string, unknown>;
  }) => Promise<{ id: string; expiresAt: Date }>;
  /** Verify and consume a confirmation token. `resourceId` is optional —
   *  create-style tools whose input can't echo back a natural id pass
   *  `undefined` and rely on action + payload binding instead. */
  verifyConfirmation: (input: {
    token: string;
    action: ClaireConfirmationAction;
    resourceId?: string;
  }) => Promise<
    | { valid: true; payload: Record<string, unknown> | null }
    | {
        valid: false;
        reason:
          | 'expired'
          | 'consumed'
          | 'mismatch'
          | 'not_found'
          | 'no_user_turn';
      }
  >;
}

/**
 * The frozen tool record returned by `defineTool`. The controller keeps a
 * map of these and dispatches by `name`.
 */
/**
 * The minimum org role a caller must hold to invoke a tool, or `'any'` for
 * "any authenticated member". See `ToolDefinition.policy`.
 */
export type ToolPolicy = 'any' | 'member' | 'admin' | 'owner';

export interface ToolDefinition<I = unknown, O = unknown> {
  /** Globally unique tool name (`{feature}_{action}`). */
  name: string;
  feature: string;
  action: string;
  description: string;
  inputSchema: ZodType<I>;
  destructive: boolean;
  destructiveAction?: ClaireConfirmationAction;
  /**
   * WHO may invoke this tool — the authorization policy, declared.
   *
   * Distinct from `destructive`, which is a HUMAN-IN-THE-LOOP confirmation
   * gate ("ask before doing this"), NOT an authorization one ("this caller may
   * not do this at all"). A tool can be non-destructive and still owner-only;
   * a tool can be destructive and open to any member. Conflating the two is
   * why `@RequireRole('admin')` on a controller route has no counterpart when
   * the same capability is reached through Claire.
   *
   * `'member' | 'admin' | 'owner'` name the MINIMUM org role. `'any'` means
   * any authenticated member of the active organization — stated explicitly
   * rather than by omission, so an undeclared policy stays distinguishable
   * from a deliberately open one.
   *
   * Optional ONLY so Gate 3 can ratchet the existing tools down rather than
   * demand a flag day. Nothing ENFORCES this yet, and that is deliberate: the
   * architecture doc's rule is "do not move policy anywhere before Gate 3
   * exists", so this lands as a declaration the gate can count first.
   */
  policy?: ToolPolicy;
  preferredModel: 'sonnet' | 'opus';
  hardBlocks: readonly string[];
  presentation?: ToolPresentation;
  additionalAllowedPaths?: readonly RegExp[];
  /** The Anthropic-shaped definition for `client.messages.create({ tools })`. */
  toAnthropicDefinition: () => AnthropicToolDefinition;
  /** The wrapped execute the controller invokes per tool_use block. */
  execute: (
    input: unknown,
    ctx: AssistantToolsContext
  ) => Promise<ToolResult<O>>;
}
