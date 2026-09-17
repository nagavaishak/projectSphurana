/**
 * The microsite tools, in the shape Claire's tool loop dispatches.
 *
 * The adapter is deliberately thin — validation, the call budget, the
 * confirmation gate and error handling all live in the feature package's
 * `defineMicrositeTool`, so the eval path and the production path cannot
 * diverge by way of two different wrappers.
 *
 * `AssistantToolsContext` is IGNORED by these tools. `runClaireTurn` passes it
 * to every `execute`, but a microsite tool's context is the
 * `MicrositeToolContext` closed over here — session ids from the request,
 * never from the model, plus the per-turn budget and the confirmations the UI
 * supplied. Nothing a microsite tool does goes back through Claire's
 * `apiFetch`, ports, or confirmation tokens.
 *
 * THE REGISTRATION RULE (contract §2): both entry points — the streaming
 * controller and the headless/eval runner — call THIS function. There is no
 * second list. `microsite-tool-registration.spec.ts` fails if either stops.
 */

import {
  MICROSITE_AGENT_TOOLS,
  type MicrositeToolContext,
} from '@borradh-workspace/features/microsites';
import { z } from 'zod';
import type { ToolDefinition } from '../../assistant/tool-factory/index.js';

/** JSON Schema for Anthropic, from the tool's own Zod schema. */
const toInputSchema = (schema: z.ZodType<unknown>): Record<string, unknown> => {
  const json = z.toJSONSchema(schema, {
    target: 'draft-7',
    reused: 'inline',
  }) as Record<string, unknown>;
  // Anthropic rejects the `$schema` meta-field on `input_schema`.
  const { $schema: _meta, ...rest } = json;
  return rest;
};

export const buildMicrositeToolDefinitions = (
  ctx: MicrositeToolContext
): Map<string, ToolDefinition> => {
  const map = new Map<string, ToolDefinition>();

  for (const tool of MICROSITE_AGENT_TOOLS) {
    const definition: ToolDefinition = {
      name: tool.name,
      feature: 'microsites',
      action: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      // The microsite agent's confirmation gate is its own (a set supplied by
      // the request), NOT Claire's DB-persisted token flow — the sidebar has
      // no confirmation-token round trip. Declaring `destructive: true` here
      // would arm a second, unreachable gate.
      destructive: false,
      preferredModel: 'sonnet',
      hardBlocks: [],
      policy: 'member',
      toAnthropicDefinition: () => ({
        name: tool.name,
        description: tool.description,
        input_schema: toInputSchema(tool.inputSchema),
      }),
      execute: async (input) => {
        const result = await tool.execute(ctx, input);
        if (!result.success) {
          return {
            ok: false,
            error: result.error.message,
            code: result.error.code,
          };
        }
        return {
          ok: true,
          data: {
            // Read by the sink for the sidebar's activity line.
            summary: result.data.summary,
            ...(result.data.confirmationRequired
              ? { confirmationRequired: result.data.confirmationRequired }
              : {}),
            result: result.data.data,
          },
        };
      },
    };

    map.set(tool.name, definition);
  }

  return map;
};

/** The names both entry points must expose. Asserted in the registration spec. */
export const micrositeToolNames = (): string[] =>
  MICROSITE_AGENT_TOOLS.map((tool) => tool.name);
