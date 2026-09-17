import { z } from 'zod';
import { ApiFetchError, defineTool } from '../../tool-factory/index.js';

/**
 * The customer chatbot's "top-level override" — the free-text directive an
 * owner writes to steer how the live bot talks to their customers. It is
 * persisted on `organization.chatbotSystemPrompt` and injected at the very head
 * of the customer bot's prompt as the "CUSTOM DIRECTIVE (HIGHEST PRIORITY —
 * OVERRIDES ALL OTHER RULES)" block (see
 * `packages/features/src/chatbots/services/generate-ai-response/borradh-prompt-builder.ts`).
 *
 * This tool writes ONLY that override. It never touches the base chatbot system
 * prompt (which is code, not data), Claire's own prompt, the structured
 * `chatbotSettings`, or the knowledge base — the update endpoint applies only
 * the fields present in the body, and we send exactly one.
 */
const MAX_DIRECTIVE_LENGTH = 5000;

const setChatbotDirectiveInputSchema = z.object({
  directive: z
    .string()
    .max(
      MAX_DIRECTIVE_LENGTH,
      `Keep the directive under ${MAX_DIRECTIVE_LENGTH} characters.`
    )
    .describe(
      'The FULL new override text for the customer chatbot. This REPLACES the ' +
        'existing override in its entirety — it is not appended, so pass the ' +
        'complete directive, not just the change. Pass an empty string to ' +
        'CLEAR the override and return the bot to its default behaviour.'
    ),
  confirmationToken: z
    .string()
    .optional()
    .describe('Set on the second call only.'),
});

type SetChatbotDirectiveInput = z.infer<typeof setChatbotDirectiveInputSchema>;

interface SetChatbotDirectiveOutput {
  /** Whether the override now holds text or was cleared. */
  cleared: boolean;
  /**
   * The PERSISTED override read back from the update endpoint's response — not
   * an echo of the request. `null` when the override was cleared. If this
   * differs from what was asked, the write did not land and the model must say
   * so (Phase 1 truthful-state rule).
   */
  directive: string | null;
}

/** `PUT organizations/:id/chatbot-settings` returns the updated org fields. */
const updateChatbotSettingsResponseSchema = z.object({
  chatbotSystemPrompt: z.string().nullable(),
});

/**
 * Trim to decide clear-vs-set, but PERSIST the owner's text verbatim (leading/
 * trailing newlines in a directive are theirs to keep). An all-whitespace
 * directive is treated as "clear".
 */
function normalizeDirective(raw: string): string | null {
  return raw.trim().length === 0 ? null : raw;
}

/** A compact, single-line preview of the directive for the confirmation card. */
function previewDirective(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > 160 ? `${collapsed.slice(0, 157)}…` : collapsed;
}

/**
 * `chatbots_setDirective` — set or clear the customer chatbot's top-level
 * override (the CUSTOM DIRECTIVE block). Exposed write, `confirm: true`: the
 * factory's destructive flow shows the owner the exact directive (or that it is
 * being cleared) and only writes after they approve. Same footing as the
 * kill switch — it changes what every live customer experiences — so `admin`.
 *
 * The override text is bound into the confirmation payload, so the model cannot
 * change what gets written between the card the owner saw and the executed call.
 */
export const setChatbotDirectiveTool = defineTool<
  SetChatbotDirectiveInput,
  SetChatbotDirectiveOutput
>({
  feature: 'chatbots',
  action: 'setDirective',
  description:
    "Set or clear the customer-facing chatbot's custom directive — the " +
    'top-level override that steers how the bot replies to customers. Use ' +
    'this when the owner wants to change the bot’s instructions, tone, or ' +
    'rules (e.g. "always offer a free consult first", "never quote prices, ' +
    'book a call instead"). The directive REPLACES the existing override in ' +
    'full, so pass the complete new text; pass an empty string to clear it and ' +
    'return the bot to default behaviour. Requires the owner to approve a ' +
    'confirmation before anything is written. This edits the OVERRIDE only — ' +
    "it never changes the chatbot's base system prompt, and it does not affect " +
    'Claire herself.',
  inputSchema: setChatbotDirectiveInputSchema,
  destructive: true,
  destructiveAction: 'set_chatbot_directive',
  // Rewriting how the live bot talks to every customer is an operational
  // control on the same footing as the chatbot kill switch (both `admin`):
  // `destructive` gates the human confirmation, `policy` gates WHO may ask.
  policy: 'admin',
  preferredModel: 'sonnet',
  hardBlocks: [],
  presentation: {
    statusLabel: 'Updating chatbot directive',
  },
  additionalAllowedPaths: [/^organizations\/[a-zA-Z0-9_-]+\/chatbot-settings$/],
  summarizeForConfirmation: async (input, ctx) => {
    const normalized = normalizeDirective(input.directive);
    const clearing = normalized === null;
    return {
      title: clearing
        ? 'Clear the chatbot directive?'
        : 'Update the chatbot directive?',
      fields: clearing
        ? [
            {
              label: 'Change',
              value:
                'Remove the override — the bot returns to default behaviour.',
            },
          ]
        : [
            { label: 'New directive', value: previewDirective(normalized) },
            {
              label: 'Applies to',
              value:
                'Every customer conversation on Messenger, Instagram and WhatsApp.',
            },
          ],
      resourceId: ctx.organizationId,
      // Bind the exact directive text so the model cannot alter what gets
      // written between the card the owner approved and the executed call.
      payload: { directive: input.directive },
    };
  },
  execute: async (input, ctx) => {
    const normalized = normalizeDirective(input.directive);
    let persisted: string | null;
    try {
      const res = await ctx.apiFetch(
        `organizations/${ctx.organizationId}/chatbot-settings`,
        {
          method: 'PUT',
          body: { chatbotSystemPrompt: normalized },
          schema: updateChatbotSettingsResponseSchema,
        }
      );
      persisted = res.chatbotSystemPrompt;
    } catch (error) {
      if (error instanceof ApiFetchError && error.status === 404) {
        throw new Error('This organization was not found.');
      }
      throw error;
    }
    return {
      data: {
        cleared: persisted === null,
        directive: persisted,
      },
    };
  },
});
