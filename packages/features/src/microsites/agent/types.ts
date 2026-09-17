/**
 * The agent tool contract (phase-3 contract §2).
 *
 * A microsite tool is a plain, transport-free object: a Zod schema, a
 * `Result`-returning `execute`, and a one-line human summary the sidebar shows
 * as an activity line. Nothing here knows about Anthropic, SSE or NestJS — the
 * API layer (apps/api/src/microsites/agent) adapts these into Claire's
 * `ToolDefinition` shape. That split is what lets every tool be unit-tested
 * without a model.
 *
 * THE SESSION IS NOT MODEL INPUT. `micrositeId`/`organizationId` live on
 * `MicrositeToolContext`, resolved from the caller's session, and no tool's
 * input schema carries them. A model that emits `{"micrositeId": "..."}` is
 * emitting an ignored field, not naming another tenant's site — and every
 * service the tools call re-checks ownership with a WHERE clause anyway
 * (services/shared/authorize.ts).
 */

import type { ZodType } from 'zod';
import type { DbConnection, Result } from '../../shared/index.js';
import type { MicrositeTurnBudget } from './guardrails.js';

/** Server-resolved identity for a turn. Never assembled from tool arguments. */
export interface MicrositeAgentSession {
  micrositeId: string;
  organizationId: string;
  /** Staff member driving the turn — carried into revisions and transcripts. */
  userId: string;
}

export interface MicrositeToolContext {
  db: DbConnection;
  session: MicrositeAgentSession;
  /**
   * Per-turn call budget. Shared by every tool in the turn: the cap is a
   * property of the TURN, not of a tool (contract §3).
   */
  budget: MicrositeTurnBudget;
  /**
   * Destructive actions the UI has already confirmed for this turn, as
   * `"<tool>:<resource>"` keys (see `confirmationKey`).
   *
   * Supplied by the REQUEST BODY — the sidebar echoes back what the user
   * clicked — and deliberately absent from every tool's input schema. The
   * model cannot set it, so it cannot argue its way past a confirmation.
   */
  confirmedActions: ReadonlySet<string>;
}

/**
 * What a tool hands back. `data` is what the model sees; `summary` is what the
 * human sees; the flags are what the turn runner and the sidebar act on.
 */
export interface MicrositeToolOutput<T = unknown> {
  data: T;
  /** Human-readable activity line: "Added a testimonials section". */
  summary: string;
  /** True when this call changed the draft — drives the one-revision-per-turn rule. */
  mutated: boolean;
  /**
   * Set when the tool REFUSED pending explicit UI confirmation. Not an error:
   * the sidebar renders a confirm button and the same call is replayed with
   * the action in `confirmedActions`.
   */
  confirmationRequired?: {
    /** The key the UI echoes back to confirm. */
    action: string;
    /** One line describing exactly what will happen. */
    prompt: string;
  };
}

/**
 * The erased tool the registry holds. `execute` takes `unknown`: input is
 * validated INSIDE the wrapper (`defineMicrositeTool`), so there is exactly one
 * place a tool argument can enter the system unvalidated — none.
 */
export interface MicrositeAgentTool {
  /** Contract §2 name, snake_case — the model sees exactly this. */
  name: string;
  description: string;
  /** Zod schema, also the source of the model-facing JSON schema. */
  inputSchema: ZodType<unknown>;
  /** True for tools that can change the draft. Read tools are false. */
  mutating: boolean;
  /** True for tools that need UI confirmation before they run (contract §3). */
  destructive: boolean;
  execute: (
    ctx: MicrositeToolContext,
    input: unknown
  ) => Promise<Result<MicrositeToolOutput>>;
}
