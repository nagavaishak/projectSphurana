import { db, withSystemScope } from '@borradh-workspace/database';
import { writeKnowledgeEntry } from '@borradh-workspace/features/assistant';
import { checkAdminAccess } from '@borradh-workspace/features/organizations';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const REMEMBER_HARD_BLOCKS = [
  'noPomBrandNamesInAdCopy',
  'noFabricatedResultClaims',
] as const;

export interface RememberOutput {
  saved: boolean;
  scope: 'personal' | 'organization';
  knowledgeEntryId?: string;
  message: string;
  hardBlock?: { code: string; message: string };
}

/**
 * `remember` — store a stable preference or fact the user wants Claire to
 * recall in future conversations.
 *
 * Always-loaded meta tool (alongside `loadSkill` + `dispatchTour`). Writes
 * a `knowledge_entry` row with `type: 'preference'`, scoped per-user by
 * default and per-org when the user explicitly opts in. The post-W-C13-schema
 * `queryKnowledge` then surfaces it on subsequent turns when called with the
 * conversation's `userId`.
 *
 * Defense-in-depth: although this is a non-destructive tool (no confirmation
 * flow), we still run hard-block validators against the proposed memory
 * content before writing. The factory only auto-runs hard-blocks for
 * destructive tools, so we invoke `ctx.runHardBlocks` manually here — same
 * pattern as `videos_generateVideoScript` and `customer_conversations_draftReply`.
 *
 * Two scopes:
 *   - `personal` (default) → row written with `user_id = ctx.userId`.
 *     Visible only to that user in future `queryKnowledge` calls.
 *   - `organization` → row written with `user_id = null`. Visible to every
 *     user in the org. Requires the model to set the input field
 *     deliberately; never auto-flipped from content.
 *
 * Memory hygiene: `remember` is for stable preferences and facts
 * ("I prefer warm color palettes" / "we don't run ads on Sundays"), not
 * one-off ephemera ("the appointment is Tuesday at 3pm" — that's already
 * in the conversation history and doesn't need a knowledge entry).
 *
 * @see docs/implementations/claire-briefs/window-c13-remember-tool.md
 * @see docs/implementations/claire.md §2 (knowledge populators — explicit memories)
 */
export const rememberTool = defineTool<
  { content: string; scope?: 'personal' | 'organization' },
  RememberOutput
>({
  feature: 'meta',
  action: 'remember',
  description:
    'Store a memory about the user or the business that you should reference in future conversations. ' +
    'Use when the user says "remember that…" or expresses a clear, stable preference or fact ' +
    '(e.g. "I prefer warm color palettes", "we don\'t run ads on Sundays"). ' +
    "Don't use it for one-off facts that the conversation already captures " +
    '(e.g. "the appointment is Tuesday at 3pm"). ' +
    'Default scope is "personal" (just the speaking user); use "organization" only when ' +
    'the user explicitly says the memory applies to the whole team or business.',
  inputSchema: z.object({
    content: z
      .string()
      .min(8)
      .max(500)
      .describe('The memory itself, in two sentences max.'),
    scope: z
      .enum(['personal', 'organization'])
      .optional()
      .describe(
        'Who this memory applies to. "personal" (default) = just this user. ' +
          '"organization" = anyone in the org. Only use "organization" when the ' +
          'user explicitly says the memory is for the whole team or business.'
      ),
  }),
  destructive: false,
  // NOTE: deliberately NOT declared on the config. The factory now enforces
  // declared hard blocks for non-destructive tools too (returning its generic
  // hard_block_violation), but this tool wants its OWN softer handling — it
  // runs the validators manually inside `execute` (below) and degrades to a
  // friendly "rephrase" message rather than a hard error.
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Saving that for later' },
  execute: async ({ content, scope: rawScope }, ctx) => {
    const scope = rawScope ?? 'personal';

    // Org-wide writes require admin/owner — mirrors editMemory/deleteMemory
    // controllers, which gate org-scoped mutations on `checkAdminAccess`.
    // Without this gate, any team member could plant org-wide preference
    // entries (RAG-retrieved on every other user's future Claire turn) just
    // by phrasing a request as "remember for the team that ...".
    if (scope === 'organization') {
      const adminCheck = await withSystemScope(
        (conn) =>
          checkAdminAccess(conn, {
            userId: ctx.userId,
            organizationId: ctx.organizationId,
          }),
        { db }
      );
      if (!adminCheck.success || !adminCheck.data.hasAccess) {
        return {
          data: {
            saved: false,
            scope,
            message:
              "Only organization admins can save shared team memories. I'll save this as a personal memory for you instead — say so explicitly if you want me to retry as team-wide.",
          },
        };
      }
    }

    // Run hard-blocks against the proposed memory content before writing. We
    // run them HERE (not via the config `hardBlocks`) so we can degrade to a
    // friendly "rephrase" message instead of the factory's generic hard error.
    const hbResult = await ctx.runHardBlocks(
      REMEMBER_HARD_BLOCKS,
      { content },
      ctx
    );
    if (!hbResult.pass) {
      return {
        data: {
          saved: false,
          scope,
          message:
            "I can't save that as a memory — it brushes against one of my " +
            'safety rules. Try rephrasing without specific brand names or ' +
            'absolute outcome claims.',
          hardBlock: { code: hbResult.code, message: hbResult.message },
        },
        presentation: {
          type: 'hard_block_violation',
          code: hbResult.code,
          message: hbResult.message,
        },
      };
    }

    const userId = scope === 'personal' ? ctx.userId : null;

    // Title surfaces in the system prompt's knowledge context block so a
    // descriptive prefix helps the model distinguish memory entries from
    // org_profile / service / ad_insight rows. Truncate the content to
    // keep titles below the column's 200-char practical limit.
    const titlePrefix = scope === 'personal' ? 'Memory' : 'Team memory';
    const titleSuffix =
      content.length > 60 ? `${content.slice(0, 60)}…` : content;
    const title = `${titlePrefix}: ${titleSuffix}`;

    const writeResult = await writeKnowledgeEntry(db, {
      organizationId: ctx.organizationId,
      userId,
      type: 'preference',
      title,
      content,
      source: 'manual',
      metadata: {
        savedBy: ctx.userId,
        scope,
        conversationId: ctx.conversationId,
      },
    });

    if (!writeResult.success) {
      // Surface a clean failure to the model. The factory's outer error
      // sanitization wraps thrown errors; throwing here is the right path
      // when the write fails — same shape as `loadSkillTool`.
      throw new Error(`Failed to save memory: ${writeResult.error.message}`);
    }

    return {
      data: {
        saved: true,
        scope,
        knowledgeEntryId: writeResult.data.knowledgeEntryId,
        message:
          scope === 'personal'
            ? "Got it. I'll remember that for next time we talk."
            : 'Saved that for the team — anyone here will see it.',
      },
      presentation: {
        type: 'memory_saved',
        scope,
        content,
      },
    };
  },
});
