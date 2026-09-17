import {
  type AssistantContextResponse,
  assistantContextResponseSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

/**
 * `context_getOrganizationContext` — load the organization profile.
 *
 * Ported from the legacy `getOrganizationContext` tool in `context-tools.ts`.
 * Same input schema (empty) and same output shape; the factory adds the
 * standard wrapping (counter, telemetry, error sanitization).
 *
 * The response is PARSED against `assistantContextResponseSchema`, whose column
 * names are `.pick()`ed from the `organization` / `organization_service` atoms —
 * so `getAssistantContext` narrowing its `columns:` selection breaks the build
 * here rather than silently handing the model an object full of `undefined`.
 * The hand-written interface this replaces was already drifting: the sibling
 * `draftReply` tool asserted `brandKit` / `toneRegion` / a scalar `brandVoice`
 * on the same endpoint, none of which it returns.
 *
 * Note on naming: the factory builds `${feature}_${action}` as the
 * model-facing tool name. Skill `toolNames` arrays in
 * `packages/features/src/assistant/skills/*.skill.ts` still reference the
 * pre-factory name (`getOrganizationContext`); the W-C03-D controller wiring
 * is responsible for mapping skill names to factory tool definitions.
 */
export const getOrganizationContextTool = defineTool<
  Record<string, never>,
  AssistantContextResponse
>({
  feature: 'context',
  action: 'getOrganizationContext',
  description:
    'Load the organization profile including business type, brand voice, ' +
    'target audience, services, and location. Use this to understand the ' +
    'business before making recommendations.',
  inputSchema: z.object({}),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Loading the business profile' },
  execute: async (_input, ctx) => {
    const data = await ctx.apiFetch('assistant/context', {
      schema: assistantContextResponseSchema,
    });
    return { data };
  },
});
