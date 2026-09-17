import { db } from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import {
  SKILL_REGISTRY_VERSION,
  buildBusinessContextBlock,
  buildPersonaBlock,
  buildSkillIndexBlock,
  getAssistantContext,
  getConversation,
  skills,
} from '@borradh-workspace/features/assistant';
import { buildToolCatalogue } from '../lib/build-claire-turn-inputs.js';
import {
  type AssistantToolsContext as LegacyAssistantToolsContext,
  createContentTools,
  legacyToolsToFactoryShape,
} from '../tools/index.js';
import { metaTools } from '../tools/meta/index.js';

/** One row of the editable tool surface returned to the tuning panel. */
export interface PromptConfigTool {
  name: string;
  feature: string;
  action: string;
  description: string;
  inputSchema: unknown;
}

export interface PromptConfigResponse {
  blocks: { persona: string; skillIndex: string; businessContext: string };
  skills: Array<{
    id: string;
    oneLineDescription: string;
    promptFragment: string;
  }>;
  tools: PromptConfigTool[];
  loadedSkillIds: string[];
  skillRegistryVersion: number;
}

export interface PromptConfigParams {
  organizationId: string;
  userId: string;
  conversationId?: string;
  logger: { error: (...args: unknown[]) => void };
}

/**
 * Local prompt-tuning config use case (uncommitted dev tool).
 *
 * Returns the full editable surface seeded with current defaults so the
 * in-chat tuning panel can render editors for every prompt piece and tool
 * description:
 *   - `blocks`: persona, skill index, and (org-specific) business context.
 *   - `skills`: every registered skill with its one-line description and
 *     prompt fragment (Block 3 source).
 *   - `tools`: the full tool catalogue (canonical name, feature, action,
 *     description, JSON input schema) — descriptions are editable, schemas
 *     shown read-only.
 *   - `loadedSkillIds`: what the open conversation currently has loaded.
 *
 * Tool *descriptions* steer when/how the model calls a tool; the execution
 * logic itself still lives in code. The panel surfaces that boundary.
 */
export async function buildPromptConfig(
  params: PromptConfigParams
): Promise<PromptConfigResponse> {
  const { organizationId, userId, conversationId, logger } = params;

  const ctxResult = await getAssistantContext(db, { organizationId });
  const businessContext = ctxResult.success
    ? buildBusinessContextBlock(ctxResult.data)
    : '';

  let loadedSkillIds: string[] = [];
  if (conversationId) {
    const convResult = await getConversation(db, {
      id: conversationId,
      organizationId,
      userId,
    });
    if (convResult.success) {
      loadedSkillIds = convResult.data.loadedSkillIds;
    }
  }

  // Build the catalogue with a throwaway content-tools context — only the
  // tool metadata (name/description/schema) is read here, never executed.
  const noopLegacyCtx: LegacyAssistantToolsContext = {
    organizationId,
    userId,
    apiFetch: () => {
      throw new Error('prompt-config: tools are not executed');
    },
    cdnUrl: apiEnv.CDN_URL,
    appUrl: apiEnv.APP_URL,
  };
  const contentShimmed = legacyToolsToFactoryShape(
    createContentTools(noopLegacyCtx)
  );
  const catalogue = buildToolCatalogue(contentShimmed, logger);

  // De-alias: keep only entries stored under their canonical name.
  const seen = new Set<string>();
  const tools: PromptConfigTool[] = [];
  // Meta tools (`meta_loadSkill`, …) are always loaded by `buildToolMap`
  // rather than via the catalogue, so list them explicitly here.
  for (const tool of [...catalogue.values(), ...metaTools]) {
    if (seen.has(tool.name)) continue;
    seen.add(tool.name);
    tools.push({
      name: tool.name,
      feature: tool.feature,
      action: tool.action,
      description: tool.description,
      inputSchema: tool.inputSchema,
    });
  }
  tools.sort((a, b) => a.name.localeCompare(b.name));

  return {
    blocks: {
      persona: buildPersonaBlock(),
      skillIndex: buildSkillIndexBlock(),
      businessContext,
    },
    skills: skills.map((s) => ({
      id: s.id,
      oneLineDescription: s.oneLineDescription,
      promptFragment: s.promptFragment,
    })),
    tools,
    loadedSkillIds,
    skillRegistryVersion: SKILL_REGISTRY_VERSION,
  };
}
