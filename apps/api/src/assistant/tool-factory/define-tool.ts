import type { ClaireConfirmationAction } from '@borradh-workspace/database';
import { logError, logWarning } from '@borradh-workspace/observability';
import { type ZodType, z } from 'zod';
import { hasMinimumRole } from '../../common/guards/permissions.js';
import { ApiFetchError } from './api-fetch.js';
import { sanitizeApiError } from './error-sanitization.js';
import { applyStopAndAsk, recordToolFailure } from './failure-tracker.js';
import {
  trackToolCalled,
  trackToolConfirmed,
  trackToolFailed,
} from './telemetry.js';
import type {
  AnthropicToolDefinition,
  AssistantToolsContext,
  ConfirmationSummary,
  PresentationPayload,
  ToolDefinition,
  ToolPolicy,
  ToolPresentation,
  ToolResult,
} from './types.js';

/**
 * Public config accepted by `defineTool`.
 *
 * @see claire.md §2 (Tool factory) and `claire-briefs/track-c02.md` Step 4.
 *
 * The factory wraps the user's `execute` with five layers, in order:
 *   1. Per-turn tool-call counter (`tool-call-limit.ts`)
 *   2. Input validation against `inputSchema`
 *   3. Telemetry (`telemetry.ts` — `claire.tool_called`)
 *   4. Confirmation enforcement (destructive only; via `confirmation.ts`)
 *   5. Hard-block validators (defense in depth — `hard-blocks.ts`)
 *
 * Errors thrown by the user's `execute` are caught, sanitized via
 * `sanitizeApiError`, logged through `logError`, and returned as a
 * `ToolResult.ok=false`. The model never sees raw stack traces or SQL.
 */
export interface DefineToolConfig<I, O> {
  /** Logical area (e.g. `meta-ads`, `appointments`, `offers`). Used as the
   *  prefix of the tool name and as the Sentry/PostHog feature label. */
  feature: string;
  /** camelCase action verb (e.g. `launchAd`, `pauseCampaign`). Combined with
   *  `feature` to form the global tool name. */
  action: string;
  /** Anthropic-facing description. The model uses this to decide when to
   *  call the tool. Aim for one paragraph; the orchestrator's prompt frames
   *  the high-level rules. */
  description: string;
  /** Zod schema describing the tool's input. The factory validates against
   *  this on every call AND uses Zod 4's `toJSONSchema` to produce the
   *  Anthropic `input_schema`. */
  inputSchema: ZodType<I>;
  /** When true, the factory enforces a two-call confirmation flow: first
   *  call → run hard-blocks → emit `confirmation_required`. Second call
   *  (with `confirmationToken`) → verify token → execute. */
  destructive: boolean;
  /** Required when `destructive: true`. The DB-persisted action enum value
   *  the issued token will carry. Frontend rich-content renderers may key
   *  off this for human-readable labels. */
  destructiveAction?: ClaireConfirmationAction;
  /** Minimum org role required to invoke this tool. See `ToolDefinition.policy`
   *  — this is AUTHORIZATION, not the `destructive` confirmation gate. */
  policy?: ToolPolicy;
  /** Default `'sonnet'`. The orchestrator picks `'opus'` for the whole turn
   *  if any loaded skill requests opus routing. */
  preferredModel?: 'sonnet' | 'opus';
  /** Names of validators the factory should run before issuing a token (or
   *  before executing a non-destructive read tool). Stub-only in C-02. */
  hardBlocks?: readonly string[];
  /** Static presentation hints — status label + frontend renderer name. */
  presentation?: ToolPresentation;
  /** Per-tool extension to the path whitelist. */
  additionalAllowedPaths?: readonly RegExp[];
  /** The actual implementation. Receives validated input + context. May
   *  return arbitrary `data` plus a `presentation` envelope (e.g. a
   *  `clip_selection` payload that the rich-content renderer mounts). */
  execute: (
    input: I,
    ctx: AssistantToolsContext
  ) => Promise<{ data?: O; presentation?: PresentationPayload }>;
  /** Required when `destructive: true`. Builds the human-facing summary
   *  shown in `confirmation_required` plus the resourceId / payload that
   *  bind the token. */
  summarizeForConfirmation?: (
    input: I,
    ctx: AssistantToolsContext
  ) => Promise<ConfirmationSummary>;
}

/**
 * Action names must be camelCase identifiers — the factory relies on this
 * shape when building the tool name and asserting uniqueness.
 */
const ACTION_NAME_RE = /^[a-z][a-zA-Z0-9_]*$/;
const FEATURE_NAME_RE = /^[a-z][a-zA-Z0-9-]*$/;

interface InputWithToken {
  confirmationToken?: string;
}

const INPUT_RESOURCE_ID_FIELDS = [
  'resourceId',
  'adId',
  'campaignId',
  'appointmentId',
  'offerId',
  'leadId',
  'postId',
  'conversationId',
  'sequenceId',
  'id',
] as const;

/** Walk known fields to find the resourceId on the proposed action input. */
function inferResourceId(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const obj = input as Record<string, unknown>;
  for (const field of INPUT_RESOURCE_ID_FIELDS) {
    const value = obj[field];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/**
 * Structural deep-equal for the JSON-shaped payloads stored on confirmation
 * tokens. Sufficient for the destructive tools' input shapes (scalars, arrays
 * of scalars, nested plain objects). Intentionally avoids `JSON.stringify`
 * comparison so key-order differences in input/payload don't cause false
 * mismatches.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const arr = a as unknown[];
    const brr = b as unknown[];
    if (arr.length !== brr.length) return false;
    return arr.every((v, i) => deepEqual(v, brr[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (!(k in bo) || !deepEqual(ao[k], bo[k])) return false;
  return true;
}

/**
 * True when the proposed input contradicts a value the operator already
 * confirmed via the token's stored payload. We compare only on overlapping
 * keys: the model can pass extra fields not in the payload (some tools
 * deliberately bind only a subset of inputs — e.g. `book-appointment`
 * doesn't lock the appointment title/description, only the time slot), but
 * cannot CHANGE a confirmed value.
 *
 * `confirmationToken` is excluded — it isn't part of the confirmed action.
 *
 * Limitation: this catches changes to confirmed fields, not drops. A tool
 * that wants strict binding on every input field should explicitly include
 * every field in its `summarizeForConfirmation` payload (`update-lead` and
 * `update-service` already do this via the `Object.entries(input).filter`
 * pattern).
 */
function inputContradictsConfirmedPayload(
  payload: Record<string, unknown>,
  input: unknown
): boolean {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    // Input isn't even an object — can't compare. Treat as a contradiction.
    return true;
  }
  const obj = input as Record<string, unknown>;
  for (const [key, confirmedValue] of Object.entries(payload)) {
    if (key === 'confirmationToken') continue;
    if (!(key in obj)) continue; // unbound on second call — see Limitation above
    if (!deepEqual(obj[key], confirmedValue)) return true;
  }
  return false;
}

function zodToAnthropicInputSchema(
  schema: ZodType<unknown>,
  toolName: string
): Record<string, unknown> {
  // Anthropic's `input_schema` is JSON Schema. Zod 4 ships a built-in
  // converter; no extra dependency required.
  const json = z.toJSONSchema(schema, {
    target: 'draft-7',
    // Anthropic chokes on `$ref`/`$defs` cycles in some shapes. Inline
    // everything to keep the schema flat.
    reused: 'inline',
  }) as Record<string, unknown>;
  // Anthropic doesn't want the `$schema` meta-field on the input schema.
  const { $schema: _$schema, ...rest } = json;
  // Anthropic explicitly rejects top-level `oneOf`/`allOf`/`anyOf` on tool
  // input_schemas with:
  //   "input_schema does not support oneOf, allOf, or anyOf at the top level"
  // This shows up when a tool's `inputSchema` is a `z.discriminatedUnion`
  // or `z.union` at the root. Catch it at construction time so the boot
  // fails loudly instead of every chat turn silently 500-ing the moment
  // the model decides to use the tool. Wrap the union in `z.object({...})`
  // with the union as one property — that compiles to a top-level object
  // schema that Anthropic accepts.
  for (const key of ['oneOf', 'allOf', 'anyOf'] as const) {
    if (key in rest) {
      throw new Error(
        `defineTool(${toolName}): inputSchema produces top-level "${key}" in its JSON Schema (likely a z.discriminatedUnion or z.union at the root). Anthropic rejects this with "input_schema does not support oneOf, allOf, or anyOf at the top level". Wrap the union inside z.object({ ... }) instead.`
      );
    }
  }
  return rest;
}

/**
 * Build a Claire tool. See `DefineToolConfig` for the full surface.
 */
export function defineTool<I, O>(
  config: DefineToolConfig<I, O>
): ToolDefinition<I, O> {
  if (!FEATURE_NAME_RE.test(config.feature)) {
    throw new Error(
      `defineTool: feature "${config.feature}" must match ${FEATURE_NAME_RE}`
    );
  }
  if (!ACTION_NAME_RE.test(config.action)) {
    throw new Error(
      `defineTool: action "${config.action}" must match ${ACTION_NAME_RE}`
    );
  }
  if (config.destructive && !config.destructiveAction) {
    throw new Error(
      `defineTool: tool "${config.feature}_${config.action}" is destructive but no destructiveAction was set`
    );
  }
  if (config.destructive && !config.summarizeForConfirmation) {
    throw new Error(
      `defineTool: tool "${config.feature}_${config.action}" is destructive but no summarizeForConfirmation was provided`
    );
  }

  const name = `${config.feature.replace(/-/g, '_')}_${config.action}`;
  const preferredModel = config.preferredModel ?? 'sonnet';
  const hardBlocks = config.hardBlocks ?? [];

  // After the construction-time guards above, these are known non-null when
  // the tool is destructive. Capture them in typed locals so the closure
  // doesn't have to assert at every use site.
  const destructiveAction: ClaireConfirmationAction | null = config.destructive
    ? (config.destructiveAction as ClaireConfirmationAction)
    : null;
  type SummarizeFn = (
    input: I,
    ctx: AssistantToolsContext
  ) => Promise<ConfirmationSummary>;
  const summarizeForConfirmation: SummarizeFn | null = config.destructive
    ? (config.summarizeForConfirmation as SummarizeFn)
    : null;

  const runToolInner = async (
    rawInput: unknown,
    ctx: AssistantToolsContext
  ): Promise<ToolResult<O>> => {
    // 1. Tool-call counter — short-circuit before doing anything else.
    if (ctx.callCounter.count >= ctx.callCounter.max) {
      return {
        ok: false,
        error: `Tool call limit reached (${ctx.callCounter.max} calls per request). Please start a new message.`,
        code: 'TOOL_CALL_LIMIT_EXCEEDED',
      };
    }
    ctx.callCounter.count += 1;

    // 1b. POLICY — who may call this at all.
    //
    // Runs BEFORE input validation on purpose: whether a caller is permitted
    // must not depend on whether their arguments happened to parse, or an
    // unauthorized caller learns the shape of a capability they may not use.
    //
    // FAIL-CLOSED. A declared policy with no resolvable caller role is a
    // refusal, not a pass. The alternative silently drops the role gate
    // wherever role resolution was skipped, which is the exact regression this
    // check exists to prevent — and it is how `@RequireRole('admin')` on
    // PUT /meta-campaigns/:metaCampaignId would evaporate the moment a port
    // stops going through the authenticated loopback.
    if (config.policy && config.policy !== 'any') {
      if (!ctx.callerRole) {
        return {
          ok: false,
          error: 'This action requires a role that could not be verified.',
          code: 'FORBIDDEN',
        };
      }
      if (!hasMinimumRole(ctx.callerRole, config.policy)) {
        return {
          ok: false,
          error: `This action requires the ${config.policy} role or higher.`,
          code: 'FORBIDDEN',
        };
      }
    }

    // 2. Validate input.
    const parsed = config.inputSchema.safeParse(rawInput);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      return {
        ok: false,
        error: `Invalid input: ${issues}`,
        code: 'VALIDATION_ERROR',
      };
    }
    const input = parsed.data;

    // Tool-bound manual issue reporter. The tool only supplies a summary +
    // optional error; we attach the tool name, org, user, and conversation so
    // the Sentry issue carries the same context the throw path would. This is
    // the channel for "soft failures" a tool swallows into a friendly message
    // (see `AssistantToolsContext.reportIssue`).
    const reportIssue: AssistantToolsContext['reportIssue'] = (
      summary,
      opts
    ) => {
      const operation = `claire.tool.${name}`;
      const extra = {
        tool: name,
        organizationId: ctx.organizationId,
        conversationId: ctx.conversationId,
        summary,
        ...opts?.extra,
      };
      if ((opts?.level ?? 'warning') === 'error') {
        logError(operation, opts?.error ?? new Error(summary), {
          feature: 'claire',
          user: { id: ctx.userId },
          extra,
        });
      } else {
        logWarning(operation, summary, {
          feature: 'claire',
          user: { id: ctx.userId },
          extra: opts?.error
            ? {
                ...extra,
                cause:
                  opts.error instanceof Error
                    ? opts.error.message
                    : String(opts.error),
              }
            : extra,
        });
      }
    };

    // If the tool declared additional whitelist paths, compose a per-call
    // context whose `apiFetch` is path-extended. Cookie + port are
    // encapsulated in the controller-side `buildApiFetch`, so tools never
    // see them. The per-call context always carries the tool-bound
    // `reportIssue` so swallow-style tools can surface soft failures.
    const callCtx: AssistantToolsContext =
      config.additionalAllowedPaths && config.additionalAllowedPaths.length > 0
        ? {
            ...ctx,
            apiFetch: ctx.buildApiFetch(config.additionalAllowedPaths),
            reportIssue,
          }
        : { ...ctx, reportIssue };

    // 3. Telemetry — every tool dispatch emits `claire.tool_called`.
    trackToolCalled(ctx.userId, {
      toolName: name,
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      destructive: config.destructive,
    });

    // 4. Confirmation enforcement (destructive only).
    if (config.destructive) {
      // The construction-time guards (lines above) ensure these are set
      // whenever `destructive` is true. The runtime check exists only to
      // satisfy the type narrowing — it is structurally unreachable.
      if (!destructiveAction || !summarizeForConfirmation) {
        return {
          ok: false,
          error: 'Internal error: destructive tool is missing required wiring.',
          code: 'INTERNAL_ERROR',
        };
      }

      // Channel-aware confirmation (WS-8). On the WhatsApp channel there is
      // no frontend button to mint/echo a confirmation token: the inbound
      // text affirmation ("launch"/"yes, publish") IS the confirmation, and
      // the worker (WS-10) has already matched it against the conversation's
      // `pendingConfirmation` and listed this action in `ctx.confirmedActions`.
      // When that holds, run the hard blocks (defense in depth) and execute —
      // skipping the two-call token flow entirely. Web is untouched: it never
      // sets `channel='whatsapp'` so this branch can't fire there.
      const whatsappConfirmed =
        ctx.channel === 'whatsapp' &&
        (ctx.confirmedActions?.includes(destructiveAction) ?? false);

      if (whatsappConfirmed) {
        if (hardBlocks.length > 0) {
          let hbResult: Awaited<ReturnType<typeof ctx.runHardBlocks>>;
          try {
            hbResult = await ctx.runHardBlocks(hardBlocks, input, callCtx);
          } catch (error) {
            logError(`claire.tool.${name}.hardBlock`, error, {
              feature: 'claire',
              extra: { tool: name, organizationId: ctx.organizationId },
            });
            trackToolFailed(ctx.userId, {
              toolName: name,
              organizationId: ctx.organizationId,
              conversationId: ctx.conversationId,
              errorCode: 'HARD_BLOCK_RUNNER_FAILED',
            });
            return {
              ok: false,
              error: 'Failed to run safety checks. Please try again.',
              code: 'HARD_BLOCK_RUNNER_FAILED',
            };
          }
          if (!hbResult.pass) {
            trackToolFailed(ctx.userId, {
              toolName: name,
              organizationId: ctx.organizationId,
              conversationId: ctx.conversationId,
              errorCode: hbResult.code,
            });
            return {
              ok: false,
              error: hbResult.message,
              code: hbResult.code,
              presentation: {
                type: 'hard_block_violation',
                code: hbResult.code,
                message: hbResult.message,
              },
            };
          }
        }
        trackToolConfirmed(ctx.userId, {
          toolName: name,
          organizationId: ctx.organizationId,
          conversationId: ctx.conversationId,
          action: destructiveAction,
        });
        // fall through to execute (skip the token flow below)
      } else {
        const inputWithToken = input as I & InputWithToken;
        if (!inputWithToken.confirmationToken) {
          // First call — defense-in-depth: run hard blocks before issuing a
          // token. If anything fires, we don't want a stale confirmation
          // sitting in the DB the model could come back to.
          if (hardBlocks.length > 0) {
            let hbResult: Awaited<ReturnType<typeof ctx.runHardBlocks>>;
            try {
              hbResult = await ctx.runHardBlocks(hardBlocks, input, callCtx);
            } catch (error) {
              logError(`claire.tool.${name}.hardBlock`, error, {
                feature: 'claire',
                extra: { tool: name, organizationId: ctx.organizationId },
              });
              trackToolFailed(ctx.userId, {
                toolName: name,
                organizationId: ctx.organizationId,
                conversationId: ctx.conversationId,
                errorCode: 'HARD_BLOCK_RUNNER_FAILED',
              });
              return {
                ok: false,
                error: 'Failed to run safety checks. Please try again.',
                code: 'HARD_BLOCK_RUNNER_FAILED',
              };
            }
            if (!hbResult.pass) {
              trackToolFailed(ctx.userId, {
                toolName: name,
                organizationId: ctx.organizationId,
                conversationId: ctx.conversationId,
                errorCode: hbResult.code,
              });
              return {
                ok: false,
                error: hbResult.message,
                code: hbResult.code,
                presentation: {
                  type: 'hard_block_violation',
                  code: hbResult.code,
                  message: hbResult.message,
                },
              };
            }
          }

          // Build the human-facing summary and persist a token row.
          let summary: ConfirmationSummary;
          try {
            summary = await summarizeForConfirmation(input, callCtx);
          } catch (error) {
            logError(`claire.tool.${name}.summarize`, error, {
              feature: 'claire',
              extra: { tool: name, organizationId: ctx.organizationId },
            });
            trackToolFailed(ctx.userId, {
              toolName: name,
              organizationId: ctx.organizationId,
              conversationId: ctx.conversationId,
              errorCode: 'CONFIRMATION_SUMMARIZE_FAILED',
            });
            return {
              ok: false,
              error: 'Failed to prepare confirmation. Please try again.',
              code: 'CONFIRMATION_SUMMARIZE_FAILED',
            };
          }

          let token: { id: string; expiresAt: Date };
          try {
            token = await ctx.createConfirmation({
              action: destructiveAction,
              resourceId: summary.resourceId,
              payload: summary.payload,
            });
          } catch (error) {
            logError(`claire.tool.${name}.createConfirmation`, error, {
              feature: 'claire',
              extra: { tool: name, organizationId: ctx.organizationId },
            });
            trackToolFailed(ctx.userId, {
              toolName: name,
              organizationId: ctx.organizationId,
              conversationId: ctx.conversationId,
              errorCode: 'CONFIRMATION_CREATE_FAILED',
            });
            return {
              ok: false,
              error: 'Failed to prepare confirmation. Please try again.',
              code: 'CONFIRMATION_CREATE_FAILED',
            };
          }

          return {
            ok: true,
            presentation: {
              type: 'confirmation_required',
              action: destructiveAction,
              resourceId: summary.resourceId,
              token: token.id,
              expiresAt: token.expiresAt.toISOString(),
              summary: { title: summary.title, fields: summary.fields },
              executeToolName: name,
              renderer: config.presentation?.confirmationRenderer,
            },
          };
        }

        // Second call — verify the echoed token. The factory pulls a
        // resourceId out of the input when it can find one in a well-known
        // field; if the input has no natural id (create-style tools whose
        // resource doesn't exist yet), it falls back to (action + payload)
        // binding. The token id is unguessable, so dropping the resourceId
        // check on creates is safe — `inputContradictsConfirmedPayload`
        // below still enforces field-level binding to what the operator
        // approved.
        const resourceId = inferResourceId(input);

        let verification: Awaited<ReturnType<typeof ctx.verifyConfirmation>>;
        try {
          verification = await ctx.verifyConfirmation({
            token: inputWithToken.confirmationToken,
            action: destructiveAction,
            resourceId,
          });
        } catch (error) {
          logError(`claire.tool.${name}.verifyConfirmation`, error, {
            feature: 'claire',
            extra: { tool: name, organizationId: ctx.organizationId },
          });
          trackToolFailed(ctx.userId, {
            toolName: name,
            organizationId: ctx.organizationId,
            conversationId: ctx.conversationId,
            errorCode: 'CONFIRMATION_VERIFY_FAILED',
          });
          return {
            ok: false,
            error: 'Failed to verify confirmation. Please try again.',
            code: 'CONFIRMATION_VERIFY_FAILED',
          };
        }

        if (!verification.valid) {
          return {
            ok: false,
            // `no_user_turn` is the turn-boundary rule (Phase 6, #131): a
            // token can never be consumed in the turn that created it. The
            // user's chat approval after seeing the card IS the approval —
            // tell the model to stop and wait rather than retry.
            error:
              verification.reason === 'no_user_turn'
                ? 'This action has not been approved yet. Show the confirmation to the user and WAIT for their reply — the action can only execute in a later turn, after the user has responded.'
                : 'This confirmation has expired or is no longer valid. Please re-issue the request.',
            code: 'CONFIRMATION_INVALID',
            presentation: {
              type: 'confirmation_expired',
              reason: verification.reason,
            },
          };
        }

        // Bind execute to what the operator actually confirmed. The token
        // carries the frozen action input from the first call's
        // `summarizeForConfirmation`; if the model echoed back a different
        // value for any confirmed field on the second call, the user clicked
        // "approve" on a stale summary and the action would no longer match.
        // Reject so the model re-runs the confirm half with the new values.
        //
        // When the stored payload is `null` (a tool that didn't supply one,
        // or older rows from before this check shipped) we fall back to
        // resourceId+action binding only — that's the previous behaviour and
        // doesn't regress any tool that already returns a payload.
        if (
          verification.payload !== null &&
          inputContradictsConfirmedPayload(verification.payload, input)
        ) {
          trackToolFailed(ctx.userId, {
            toolName: name,
            organizationId: ctx.organizationId,
            conversationId: ctx.conversationId,
            errorCode: 'CONFIRMATION_PAYLOAD_MISMATCH',
          });
          return {
            ok: false,
            error:
              'The action you tried to execute does not match what was confirmed. Please re-confirm with the new values.',
            code: 'CONFIRMATION_PAYLOAD_MISMATCH',
            presentation: {
              type: 'confirmation_expired',
              reason: 'mismatch',
            },
          };
        }

        trackToolConfirmed(ctx.userId, {
          toolName: name,
          organizationId: ctx.organizationId,
          conversationId: ctx.conversationId,
          action: destructiveAction,
        });
        // fall through to execute
      }
      // fall through to execute
    } else if (hardBlocks.length > 0) {
      // 4b. Non-destructive tool with hard blocks → still enforce them, but
      // inline (single call, no confirmation card). Lets a tool keep its safety
      // validators (e.g. no below-cost discount, no fabricated claims) without
      // forcing a two-call approve flow on a non-spend action like creating an
      // offer or a paused campaign.
      let hbResult: Awaited<ReturnType<typeof ctx.runHardBlocks>>;
      try {
        hbResult = await ctx.runHardBlocks(hardBlocks, input, callCtx);
      } catch (error) {
        logError(`claire.tool.${name}.hardBlock`, error, {
          feature: 'claire',
          extra: { tool: name, organizationId: ctx.organizationId },
        });
        trackToolFailed(ctx.userId, {
          toolName: name,
          organizationId: ctx.organizationId,
          conversationId: ctx.conversationId,
          errorCode: 'HARD_BLOCK_RUNNER_FAILED',
        });
        return {
          ok: false,
          error: 'Failed to run safety checks. Please try again.',
          code: 'HARD_BLOCK_RUNNER_FAILED',
        };
      }
      if (!hbResult.pass) {
        trackToolFailed(ctx.userId, {
          toolName: name,
          organizationId: ctx.organizationId,
          conversationId: ctx.conversationId,
          errorCode: hbResult.code,
        });
        return {
          ok: false,
          error: hbResult.message,
          code: hbResult.code,
          presentation: {
            type: 'hard_block_violation',
            code: hbResult.code,
            message: hbResult.message,
          },
        };
      }
    }

    // 5. Run the user's execute. Errors become sanitized tool results.
    try {
      const result = await config.execute(input, callCtx);
      return {
        ok: true,
        ...(result.data === undefined ? {} : { data: result.data }),
        ...(result.presentation ? { presentation: result.presentation } : {}),
      };
    } catch (error) {
      const raw =
        error instanceof Error
          ? error.message
          : 'An unexpected error occurred.';
      // The error message may already be sanitized (apiFetch sanitizes its
      // own thrown errors). Re-running sanitizeApiError is idempotent for
      // the messages it returns.
      const sanitized = sanitizeApiError(raw, 500);
      // A 4xx from an internal apiFetch hop (auth required, validation,
      // not-found, conflict) is an EXPECTED tool outcome — the model sees the
      // sanitized message and reacts. Don't capture these to Sentry; they're
      // not infra faults and only create noise (e.g. an unauthenticated test
      // turn picking an auth-guarded tool). Genuine faults (5xx, thrown
      // non-ApiFetchError exceptions) are still logged below.
      const isExpectedClientError =
        error instanceof ApiFetchError &&
        error.status >= 400 &&
        error.status < 500;
      if (!isExpectedClientError) {
        logError(`claire.tool.${name}`, error, {
          feature: 'claire',
          extra: {
            tool: name,
            organizationId: ctx.organizationId,
            conversationId: ctx.conversationId,
          },
        });
      }
      trackToolFailed(ctx.userId, {
        toolName: name,
        organizationId: ctx.organizationId,
        conversationId: ctx.conversationId,
        errorMessage: sanitized,
      });
      return {
        ok: false,
        error: sanitized,
        code: 'TOOL_EXECUTION_ERROR',
      };
    }
  };

  /**
   * Outer wrapper: runs the tool, then applies the per-turn circuit breaker
   * (Phase 4). Any `ok: false` result is recorded; once this tool has failed
   * identically `threshold` times in the turn, the failure is converted into a
   * `stop_and_ask` result so the model stops retrying the same broken call and
   * asks the user instead (#9 #37). A successful result is passed through
   * untouched, and the breaker never fires for confirmation prompts (those are
   * `ok: true`).
   */
  const wrappedExecute = async (
    rawInput: unknown,
    ctx: AssistantToolsContext
  ): Promise<ToolResult<O>> => {
    const result = await runToolInner(rawInput, ctx);
    if (result.ok || !ctx.failureTracker) return result;
    const { tripped, count } = recordToolFailure(
      ctx.failureTracker,
      name,
      result
    );
    if (!tripped) return result;
    return applyStopAndAsk(name, result, count) as ToolResult<O>;
  };

  const anthropicDefinition: AnthropicToolDefinition = {
    name,
    description: config.description,
    input_schema: zodToAnthropicInputSchema(config.inputSchema, name),
  };

  return {
    name,
    feature: config.feature,
    action: config.action,
    description: config.description,
    inputSchema: config.inputSchema,
    destructive: config.destructive,
    destructiveAction: config.destructiveAction,
    policy: config.policy,
    preferredModel,
    hardBlocks,
    presentation: config.presentation,
    additionalAllowedPaths: config.additionalAllowedPaths,
    toAnthropicDefinition: () => anthropicDefinition,
    execute: wrappedExecute,
  };
}
