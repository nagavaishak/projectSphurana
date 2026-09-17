import type { Anthropic } from '@borradh-workspace/ai';
import { db } from '@borradh-workspace/database';
import {
  type AssistantContext,
  type OrchestratorOverrides,
  type ResolvedSkillRegistry,
  buildOrchestratorPrompt,
  getAssistantContext,
  getConversation,
  skillRegistry,
} from '@borradh-workspace/features/assistant';
import {
  buildBusinessProfileContext,
  buildDisagreementNote,
} from '@borradh-workspace/features/claire';
import {
  type PromptOverrides,
  formatExtraDirectives,
  toOrchestratorOverrides,
} from './prompt-overrides.js';

/** Request body accepted by `POST assistant/prompt-preview`. */
export interface PromptPreviewBody {
  conversationId?: string;
  overrides?: PromptOverrides;
}

export interface PromptPreviewParams {
  body: PromptPreviewBody;
  organizationId: string;
  userId: string;
}

/** Status + JSON body the controller writes verbatim. */
export interface PromptPreviewResult {
  status: number;
  body: unknown;
}

/**
 * Build the per-turn system block array from the orchestrator builder.
 *
 * Moved verbatim off the controller (it was a private helper, which Gate 5
 * forbids regardless of size). Block 4 (business context, uncached) gets the
 * per-turn dynamic segments appended to its text — folding them into earlier
 * blocks would defeat their cache breakpoints. The orchestrator builder leaves
 * Block 4 uncached for exactly this reason.
 */
export function buildPreviewSystemBlocks(
  orgContext: AssistantContext,
  loadedSkillIds: string[],
  knowledgeContext: string,
  activeContextText?: string,
  draftClipsText?: string | null,
  claireProfileText?: string | null,
  claireDisagreementText?: string | null,
  extraDirectivesText?: string | null,
  orchestratorOverrides?: OrchestratorOverrides,
  // Skill registry (v30/v31) the conversation is pinned to. Sources the
  // skill-index + loaded-skill-fragment blocks. Defaults to the current
  // (v31) registry when omitted.
  registrySkills?: ResolvedSkillRegistry['skills']
): Anthropic.TextBlockParam[] {
  const { systemBlocks } = buildOrchestratorPrompt(
    orgContext,
    loadedSkillIds,
    orchestratorOverrides,
    registrySkills
  );
  // All per-turn dynamic segments append to Block 4 (uncached) so they
  // don't defeat the cache breakpoints on Blocks 1–3.
  const appended = [
    knowledgeContext,
    activeContextText,
    draftClipsText,
    claireProfileText,
    claireDisagreementText,
    // Operator tuning directives go last so they're the most recent (and
    // highest-priority) instruction the model reads (local dev tool).
    extraDirectivesText,
  ]
    .filter((segment): segment is string => !!segment)
    .join('\n\n');
  if (!appended) {
    return systemBlocks;
  }
  const blocks = [...systemBlocks];
  const last = blocks[blocks.length - 1];
  blocks[blocks.length - 1] = {
    ...last,
    text: `${last.text}\n\n${appended}`,
  };
  return blocks;
}

/**
 * Local prompt-inspector use case (uncommitted dev tool).
 *
 * Reassembles the exact system prompt `chat` would send for this org —
 * persona, skill index, loaded-skill fragments, business context, and the
 * Claire-engine enrichment — plus the operator's draft tuning directives,
 * and returns it as plain text so the chat UI can render it read-only.
 *
 * Per-turn/query-dependent segments (knowledge-base RAG hits, active
 * context, draft-clip tray) are omitted — they vary per message and aren't
 * meaningful for prompt tuning.
 */
export async function buildPromptPreview(
  params: PromptPreviewParams
): Promise<PromptPreviewResult> {
  const { body, organizationId, userId } = params;

  if (!organizationId) {
    return {
      status: 400,
      body: {
        error: 'No active organization selected',
        code: 'NO_ACTIVE_ORG',
      },
    };
  }

  const ctxResult = await getAssistantContext(db, { organizationId });
  if (!ctxResult.success) {
    return { status: 404, body: { error: 'Organization not found' } };
  }

  // Mirror the loaded-skill state for the conversation when one is open so
  // the preview shows the same Block 3 the live turn would carry.
  let loadedSkillIds: string[] = [];
  const previewRegistry: ResolvedSkillRegistry = skillRegistry;
  if (body.conversationId) {
    const convResult = await getConversation(db, {
      id: body.conversationId,
      organizationId,
      userId,
    });
    if (convResult.success) {
      loadedSkillIds = convResult.data.loadedSkillIds;
    }
  }

  let claireProfileText: string | null = null;
  let claireDisagreementText: string | null = null;
  try {
    const profile = await buildBusinessProfileContext(db, organizationId);
    if (profile.success) claireProfileText = profile.data;
  } catch {
    /* best-effort — preview is a dev tool */
  }
  try {
    const disagreement = await buildDisagreementNote(db, organizationId);
    if (disagreement.success) claireDisagreementText = disagreement.data;
  } catch {
    /* best-effort — preview is a dev tool */
  }

  const blocks = buildPreviewSystemBlocks(
    ctxResult.data,
    loadedSkillIds,
    '', // knowledge is per-query; omitted from the preview
    undefined,
    null,
    claireProfileText,
    claireDisagreementText,
    formatExtraDirectives(body.overrides?.extraDirectives),
    toOrchestratorOverrides(body.overrides),
    previewRegistry.skills
  );

  const prompt = blocks
    .map((b) => b.text)
    .join('\n\n────────────────────────────────────────\n\n');

  return {
    status: 200,
    body: {
      prompt,
      blockCount: blocks.length,
      loadedSkillIds,
      skillRegistryVersion: previewRegistry.version,
    },
  };
}
