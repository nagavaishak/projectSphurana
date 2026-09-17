/**
 * The one wrapper every microsite tool goes through.
 *
 * Five things happen here and nowhere else, which is the point — a tool that
 * forgets one of them cannot exist:
 *
 *   1. the per-turn call budget is charged (contract §3 cap);
 *   2. the model's arguments are Zod-validated (the org's own content reaches
 *      the model as untrusted text, so what comes back is untrusted too);
 *   3. the confirmation gate runs for destructive tools, against a set the
 *      REQUEST supplies and the model cannot write;
 *   4. the tool's output is charged against the turn's context ceiling;
 *   5. anything thrown becomes an INTERNAL_ERROR `Result` — a tool never
 *      throws into the loop.
 */

import { logError } from '@borradh-workspace/observability';
import type { ZodType } from 'zod';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../shared/index.js';
import { chargeToolCall, chargeToolOutput } from './guardrails.js';
import type {
  MicrositeAgentTool,
  MicrositeToolContext,
  MicrositeToolOutput,
} from './types.js';

export interface DefineMicrositeToolConfig<I, O> {
  name: string;
  description: string;
  inputSchema: ZodType<I>;
  mutating: boolean;
  destructive?: boolean;
  /**
   * Required for destructive tools: the confirmation key + prompt for THIS
   * input. Returning `null` means "no confirmation needed for this call".
   */
  confirmation?: (
    input: I,
    ctx: MicrositeToolContext
  ) => Promise<{ action: string; prompt: string } | null>;
  execute: (
    ctx: MicrositeToolContext,
    input: I
  ) => Promise<Result<MicrositeToolOutput<O>>>;
}

const byteLength = (value: unknown): number => {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
  } catch {
    return 0;
  }
};

export const defineMicrositeTool = <I, O>(
  config: DefineMicrositeToolConfig<I, O>
): MicrositeAgentTool => {
  if (config.destructive && !config.confirmation) {
    // A destructive tool with no confirmation builder would silently run: the
    // gate is only real if it cannot be omitted.
    throw new Error(
      `Destructive microsite tool "${config.name}" must define confirmation()`
    );
  }

  return {
    name: config.name,
    description: config.description,
    inputSchema: config.inputSchema as ZodType<unknown>,
    mutating: config.mutating,
    destructive: config.destructive ?? false,
    execute: async (ctx, rawInput) => {
      const overBudget = chargeToolCall(ctx.budget, config.name);
      if (overBudget) return err(overBudget);

      const parsed = config.inputSchema.safeParse(rawInput);
      if (!parsed.success) {
        return err(
          new FeatureError(
            ErrorCodes.VALIDATION_ERROR,
            `Invalid arguments for ${config.name}`,
            { issues: parsed.error.issues }
          )
        );
      }
      const input = parsed.data;

      if (config.confirmation) {
        const required = await config.confirmation(input, ctx);
        if (required && !ctx.confirmedActions.has(required.action)) {
          return ok({
            data: { confirmationRequired: true } as O,
            summary: required.prompt,
            mutated: false,
            confirmationRequired: required,
          });
        }
      }

      try {
        const result = await config.execute(ctx, input);
        if (!result.success) return result;

        const overflow = chargeToolOutput(
          ctx.budget,
          byteLength(result.data.data)
        );
        if (overflow) return err(overflow);

        return result;
      } catch (error) {
        logError(`microsites.agent.${config.name}`, error, {
          feature: 'microsites',
          extra: {
            micrositeId: ctx.session.micrositeId,
            organizationId: ctx.session.organizationId,
          },
        });
        return err(
          new FeatureError(
            ErrorCodes.INTERNAL_ERROR,
            `${config.name} could not be completed`
          )
        );
      }
    },
  };
};
