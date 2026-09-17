import { logError } from '@borradh-workspace/observability';
import type { Tool, ToolSet } from 'ai';
import { type ZodType, z } from 'zod';
import {
  type AnthropicToolDefinition,
  type AssistantToolsContext,
  type ToolDefinition,
  type ToolResult,
  sanitizeApiError,
  trackToolCalled,
  trackToolFailed,
} from '../tool-factory/index.js';

/**
 * Adapt remaining legacy `ToolSet` exports (`content-tools.ts`) to the
 * factory's `ToolDefinition` shape so they can be dispatched through the
 * W-C02-E controller's manual tool loop without being ported individually.
 * Phase 3 track C-09 replaces each remaining legacy content tool with a
 * factory-shaped one and removes the wiring.
 *
 * Ads (W-C05) and videos (W-C10) are no longer shimmed — they're factory-
 * shaped under `tools/ads/` and `tools/videos/`.
 *
 * The shim wraps the legacy execute with the factory's outer layers — counter
 * + telemetry + error sanitization — but **not** confirmation enforcement.
 * The remaining legacy content tools are all NON-destructive (list / draft /
 * caption / timing); the destructive schedule/publish confirm+execute pairs
 * that used the in-memory `confirmation-store.ts` were removed (W-C09,
 * Phase 6). Scheduling and publishing now go through the factory
 * `social_posts_schedulePost` / `social_posts_publishPostNow` tools, whose
 * DB-backed tokens are governed by the turn-boundary confirmation rule.
 *
 * Schema translation reuses Zod 4's built-in `z.toJSONSchema` (matching the
 * factory's helper). Names are preserved verbatim from the legacy `ToolSet`
 * keys (`getOrganizationContext`, `createSocialPostDraft`, etc.) so the
 * existing frontend rich-content renderers keep dispatching off them.
 */

function zodToAnthropicInputSchema(
  schema: ZodType<unknown>
): Record<string, unknown> {
  const json = z.toJSONSchema(schema, {
    target: 'draft-7',
    reused: 'inline',
  }) as Record<string, unknown>;
  const { $schema: _$schema, ...rest } = json;
  return rest;
}

interface LegacyExecuteResult {
  error?: unknown;
  [key: string]: unknown;
}

function isLegacyError(value: unknown): value is { error: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error: unknown }).error === 'string'
  );
}

/**
 * Shape one legacy tool entry into a `ToolDefinition`.
 */
function shimEntry(name: string, tool: Tool<unknown, unknown>): ToolDefinition {
  // Legacy tools always pass a Zod schema — they were authored with `tool({
  // inputSchema: z.object(...) })`. The narrow check here is defensive only.
  const inputSchema =
    (tool.inputSchema as ZodType<unknown> | undefined) ?? z.object({});
  const description = tool.description ?? '';

  const anthropicDefinition: AnthropicToolDefinition = {
    name,
    description,
    input_schema: zodToAnthropicInputSchema(inputSchema),
  };

  const execute = async (
    rawInput: unknown,
    ctx: AssistantToolsContext
  ): Promise<ToolResult<unknown>> => {
    if (ctx.callCounter.count >= ctx.callCounter.max) {
      return {
        ok: false,
        error: `Tool call limit reached (${ctx.callCounter.max} calls per request). Please start a new message.`,
        code: 'TOOL_CALL_LIMIT_EXCEEDED',
      };
    }
    ctx.callCounter.count += 1;

    // Best-effort input validation. Some legacy schemas use partial shapes
    // the model is unlikely to violate; we don't bail on parse failure here
    // (we want behaviour parity with the legacy controller, which fed input
    // straight to execute).
    const parsed = inputSchema.safeParse(rawInput);
    const input = parsed.success ? parsed.data : rawInput;

    trackToolCalled(ctx.userId, {
      toolName: name,
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      destructive: false,
    });

    try {
      // Legacy `execute` was authored as `async (input, options) => result`.
      // The runtime "options" arg in the SDK 6.x `tool()` wrapper carries the
      // tool-call ID + abort signal; we don't use either, so passing an empty
      // object is fine.
      type LegacyExecute = (
        input: unknown,
        options: { toolCallId: string; messages: unknown[] }
      ) => Promise<unknown>;
      const legacyExecute = tool.execute as unknown as LegacyExecute;
      const result = (await legacyExecute(input, {
        toolCallId: 'legacy-shim',
        messages: [],
      })) as LegacyExecuteResult;

      if (isLegacyError(result)) {
        trackToolFailed(ctx.userId, {
          toolName: name,
          organizationId: ctx.organizationId,
          conversationId: ctx.conversationId,
          errorMessage: result.error,
        });
        return {
          ok: false,
          error: sanitizeApiError(result.error, 500),
          code: 'TOOL_LEGACY_ERROR',
        };
      }
      return { ok: true, data: result };
    } catch (error) {
      const raw =
        error instanceof Error
          ? error.message
          : 'An unexpected error occurred.';
      const sanitized = sanitizeApiError(raw, 500);
      logError(`claire.tool.legacy.${name}`, error, {
        feature: 'claire',
        extra: {
          tool: name,
          organizationId: ctx.organizationId,
          conversationId: ctx.conversationId,
        },
      });
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

  return {
    name,
    feature: 'legacy',
    action: name,
    description,
    inputSchema,
    destructive: false,
    preferredModel: 'sonnet',
    hardBlocks: [],
    toAnthropicDefinition: () => anthropicDefinition,
    execute,
  };
}

/**
 * Convert a legacy `ToolSet` (object map of name → `tool({...})`) into an
 * array of factory-shaped `ToolDefinition`s.
 */
export function legacyToolsToFactoryShape(toolSet: ToolSet): ToolDefinition[] {
  return Object.entries(toolSet).map(([name, tool]) =>
    shimEntry(name, tool as Tool<unknown, unknown>)
  );
}
