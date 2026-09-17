import type { Anthropic } from '@borradh-workspace/ai';
import { apiEnv } from '@borradh-workspace/env/api';
import {
  type AssistantContext,
  type OrchestratorOverrides,
  type ResolvedSkillRegistry,
  buildOrchestratorPrompt,
  buildToolListForSkills,
} from '@borradh-workspace/features/assistant';
import {
  type AssistantToolsContext,
  type InternalAuthConfig,
  type ToolDefinition,
  buildAssistantToolsContext,
  createApiFetch,
} from '../tool-factory/index.js';
import {
  type AssistantToolsContext as LegacyAssistantToolsContext,
  createContentTools,
  legacyToolsToFactoryShape,
} from '../tools/index.js';
import { metaTools } from '../tools/meta/index.js';
import { buildToolRegistry } from '../tools/registry.js';

/**
 * Shared Claire turn-input builder (WS-5).
 *
 * Extracts the prompt + tool-catalogue + tool-context assembly that was
 * previously inline in `assistant-chat.controller.ts` (the toolMap/orchestrator
 * blocks/toolCtx wiring) into a single reusable function so that BOTH the web
 * chat controller AND the future WhatsApp worker (WS-10) call ONE function.
 *
 * **Web behaviour must not change.** Every block this builder assembles is a
 * verbatim move of the controller's prior inline logic:
 *   - the tool catalogue (`buildToolCatalogue` equivalent),
 *   - `buildToolMap` (skill-driven subset + always-on meta tools + override),
 *   - `buildSystemBlocks` (orchestrator blocks + per-turn appended segments),
 *   - the factory + legacy tool execution contexts.
 *
 * The `channel` param is threaded through now (default `'web'`) so WS-9 can
 * later append a WhatsApp-specific prompt block and WS-10 can pass
 * `channel: 'whatsapp'`. It is currently inert — the prompt is identical for
 * both channels until WS-9 lands.
 */

export type ClaireChannel = 'web' | 'whatsapp';

/** Live prompt-tuning override bundle (uncommitted dev tool). Mirrors the
 *  controller's `PromptOverrides`; redeclared here to avoid a controller
 *  import cycle. */
export interface ClaireTurnPromptOverrides {
  persona?: string;
  skillIndex?: string;
  businessContext?: string;
  skillFragments?: Record<string, string>;
  toolDescriptions?: Record<string, string>;
  extraDirectives?: string;
}

export interface BuildClaireTurnInputsParams {
  /** Resolved org context (caller already fetched via `getAssistantContext`). */
  orgContext: AssistantContext;
  organizationId: string;
  userId: string;
  /**
   * The caller's org role, resolved by the caller via `resolveCallerRole`.
   * Threaded through rather than looked up here because this builder is
   * synchronous. Absent = fail-closed: any tool declaring a `policy` refuses.
   */
  callerRole?: 'member' | 'admin' | 'owner';
  conversationId: string;
  /** Transport channel. Defaults to `'web'`; WS-9/WS-10 use `'whatsapp'`. */
  channel?: ClaireChannel;
  /** WhatsApp only: whether a destructive action is awaiting the owner's
   *  confirmation. When true and `channel === 'whatsapp'`, the appended channel
   *  block reminds the model that an affirmative reply confirms it. Ignored on
   *  the web channel. WS-8/WS-10 set this from the conversation's
   *  `pendingConfirmation` state. */
  hasPendingConfirmation?: boolean;
  /** Persisted loaded-skill ids for this conversation (without `default`,
   *  which is unioned in by `buildToolMap`). */
  loadedSkillIds: string[];

  /** Per-turn dynamic system segments, appended to the uncached final block
   *  in the same order the controller used. All optional / nullable. */
  knowledgeContext?: string;
  activeContextText?: string;
  draftClipsText?: string | null;
  claireProfileText?: string | null;
  claireDisagreementText?: string | null;
  /** Ad-account currency context (ENG-626) — see plan-chat-turn enrichment. */
  currencyContextText?: string | null;
  extraDirectivesText?: string | null;
  /** Orchestrator block overrides (dev tool). */
  orchestratorOverrides?: OrchestratorOverrides;
  /** Per-tool description overrides (dev tool). */
  toolDescriptionOverrides?: Record<string, string>;
  /** Skill registry (v30/v31) this conversation is pinned to. Sources the
   *  skill-index + loaded-skill-fragment prompt blocks AND the per-turn tool
   *  list, so a conversation keeps its pinned skill content + tools end to
   *  end. Defaults to the current (v31) registry when omitted. */
  registry?: ResolvedSkillRegistry;

  /** Request cookie — forwarded into the factory + legacy api-fetch path (web
   *  channel). Mutually exclusive with `internalAuth`. */
  cookie?: string;
  /** Bearer authorization forwarded into loopback tool requests when the web
   *  session is header-authenticated rather than cookie-authenticated. */
  authorization?: string;
  /**
   * Branch this turn is scoped to (`X-Location-Id` on the originating chat
   * request). Forwarded onto every internal tool hop so Claire reads the same
   * branch the user is standing in — see `CreateApiFetchConfig.locationId`.
   */
  locationId?: string;
  /** Internal service-auth (loopback acts-as). The WhatsApp worker passes this
   *  instead of `cookie`; threaded into both the factory + legacy api-fetch
   *  paths so loopback tool calls authenticate as the paired owner. */
  internalAuth?: InternalAuthConfig;

  /** Optional logger for catalogue/skill diagnostics (the controller passes
   *  its NestJS logger). Defaults to a no-op. */
  logger?: {
    error: (...args: unknown[]) => void;
  };
}

export interface ClaireTurnInputs {
  /** Anthropic model for this turn. */
  model: 'claude-sonnet-4-6' | 'claude-opus-4-7';
  /** Max tokens per round. */
  maxTokens: number;
  /** Assembled system blocks for the initial round. */
  system: Anthropic.TextBlockParam[];
  /** Tool dispatch map for the initial round. */
  toolMap: Map<string, ToolDefinition>;
  /** Factory execution context (shared across rounds). */
  toolCtx: AssistantToolsContext;
  /** Rebuild a tool map for an arbitrary loaded-skill set — used by the
   *  `onSkillsChanged` mid-turn rebuild hook. */
  buildToolMap: (loadedSkillIds: string[]) => Map<string, ToolDefinition>;
  /** Rebuild the system blocks for an arbitrary loaded-skill set — used by
   *  the `onSkillsChanged` mid-turn rebuild hook. Re-applies the same per-turn
   *  appended segments the initial `system` carried. */
  buildSystemBlocks: (loadedSkillIds: string[]) => Anthropic.TextBlockParam[];
}

const noopLogger = { error: () => {} };

/**
 * Catalogue every tool the assistant could call, keyed by canonical name
 * (`context_listServices`) and by an unprefixed alias (`listServices`) so
 * skill `toolNames` arrays resolve without migrating.
 *
 * The list itself lives in `tools/registry.ts` — ONE list, read by prod, the eval
 * and the dev panel alike. It used to be three hand-maintained copies that quietly
 * disagreed; see that file for what that cost.
 */
export function buildToolCatalogue(
  contentShimmed: ToolDefinition[],
  logger: { error: (...args: unknown[]) => void }
): Map<string, ToolDefinition> {
  const toolCatalogue = new Map<string, ToolDefinition>();
  const registerTool = (tool: ToolDefinition) => {
    if (toolCatalogue.has(tool.name)) {
      logger.error(
        `Duplicate tool name "${tool.name}"; skipping later definition`
      );
      return;
    }
    toolCatalogue.set(tool.name, tool);
    if (!toolCatalogue.has(tool.action)) {
      toolCatalogue.set(tool.action, tool);
    }
  };
  for (const tool of buildToolRegistry(contentShimmed)) {
    registerTool(tool);
  }
  return toolCatalogue;
}

/**
 * Assemble the per-turn system block array — moved verbatim from the
 * controller's `buildSystemBlocks`. The per-turn dynamic segments append to
 * the last (uncached) block so they don't defeat the cache breakpoints on the
 * stable blocks.
 */
function assembleSystemBlocks(
  orgContext: AssistantContext,
  loadedSkillIds: string[],
  appendSegments: Array<string | null | undefined>,
  orchestratorOverrides: OrchestratorOverrides | undefined,
  channelOptions: { channel?: ClaireChannel; hasPendingConfirmation?: boolean },
  registrySkills: ResolvedSkillRegistry['skills'] | undefined
): Anthropic.TextBlockParam[] {
  const { systemBlocks } = buildOrchestratorPrompt(
    orgContext,
    loadedSkillIds,
    orchestratorOverrides,
    registrySkills,
    channelOptions
  );
  const appended = appendSegments
    .filter((segment): segment is string => !!segment)
    .join('\n\n');
  if (!appended) {
    return systemBlocks as Anthropic.TextBlockParam[];
  }
  const blocks = [...systemBlocks];
  const last = blocks[blocks.length - 1];
  blocks[blocks.length - 1] = {
    ...last,
    text: `${last.text}\n\n${appended}`,
  };
  return blocks as Anthropic.TextBlockParam[];
}

/**
 * Build all inputs `runClaireTurn` (and the SSE-shim `runToolLoop`) needs for
 * a single Claire turn — the prompt blocks, tool dispatch map, factory context,
 * and the closures the `onSkillsChanged` mid-turn rebuild reconstructs from.
 */
export function buildClaireTurnInputs(
  params: BuildClaireTurnInputsParams
): ClaireTurnInputs {
  const {
    orgContext,
    organizationId,
    userId,
    conversationId,
    loadedSkillIds,
    knowledgeContext = '',
    activeContextText,
    draftClipsText,
    claireProfileText,
    claireDisagreementText,
    currencyContextText,
    extraDirectivesText,
    orchestratorOverrides,
    toolDescriptionOverrides,
    cookie,
    authorization,
    locationId,
    internalAuth,
    registry,
  } = params;
  const logger = params.logger ?? noopLogger;
  // Registry-pinned content + tool list. When a pinned registry is supplied
  // (the controller resolves it from the conversation's persisted version),
  // both the orchestrator prompt blocks and the per-turn tool list source
  // from it. Omitted (eval/legacy callers) → current v31 free functions.
  const registrySkills = registry?.skills;
  const resolveToolList =
    registry?.buildToolListForSkills ?? buildToolListForSkills;
  // WS-9: on the WhatsApp channel, an uncached channel block is appended to the
  // final (uncached) orchestrator block. Web (default) is byte-identical to
  // before — `channelOptions.channel === 'web'` adds nothing.
  const channelOptions = {
    channel: params.channel ?? 'web',
    hasPendingConfirmation: params.hasPendingConfirmation ?? false,
  } as const;

  // The per-turn dynamic segments appended to the uncached final block, in the
  // exact order the controller used. Captured here so both the initial system
  // and the `onSkillsChanged` rebuild apply them identically.
  const appendSegments: Array<string | null | undefined> = [
    knowledgeContext,
    activeContextText,
    draftClipsText,
    claireProfileText,
    claireDisagreementText,
    currencyContextText,
    // Operator tuning directives last (highest priority — most recent).
    extraDirectivesText,
  ];

  const buildSystemBlocks = (
    forSkillIds: string[]
  ): Anthropic.TextBlockParam[] =>
    assembleSystemBlocks(
      orgContext,
      forSkillIds,
      appendSegments,
      orchestratorOverrides,
      channelOptions,
      registrySkills
    );

  // ── Tool context (factory + legacy) ──────────────────────────────────────
  const port = apiEnv.PORT;
  // Auth mode is fixed per turn: internal acts-as for workers, or the
  // originating cookie/bearer credentials for web requests.
  const authConfig = internalAuth
    ? { internalAuth }
    : { cookie, authorization };
  const toolCtx = buildAssistantToolsContext({
    organizationId,
    timezone: orgContext.timezone,
    userId,
    callerRole: params.callerRole,
    conversationId,
    locationId,
    ...authConfig,
    port,
    cdnUrl: apiEnv.CDN_URL,
    appUrl: apiEnv.APP_URL,
  });

  const legacyApiFetch = createApiFetch({ ...authConfig, port, locationId });
  const legacyCtx: LegacyAssistantToolsContext = {
    organizationId,
    userId,
    apiFetch: legacyApiFetch,
    cdnUrl: apiEnv.CDN_URL,
    appUrl: apiEnv.APP_URL,
  };

  const contentShimmed = legacyToolsToFactoryShape(
    createContentTools(legacyCtx)
  );

  const toolCatalogue = buildToolCatalogue(contentShimmed, logger);

  const applyToolOverride = (tool: ToolDefinition): ToolDefinition => {
    const desc = toolDescriptionOverrides?.[tool.name];
    return desc?.trim() ? { ...tool, description: desc } : tool;
  };

  // Tools that must never be exposed on certain channels.
  const CHANNEL_EXCLUDED_TOOLS: Partial<Record<ClaireChannel, Set<string>>> = {
    whatsapp: new Set(['generateTalkingHeadQR']),
  };
  const excludedTools = CHANNEL_EXCLUDED_TOOLS[channelOptions.channel ?? 'web'];

  const buildToolMap = (forSkillIds: string[]): Map<string, ToolDefinition> => {
    const effective = ['default', ...forSkillIds];
    const skillToolNames = resolveToolList(effective);
    const map = new Map<string, ToolDefinition>();
    for (const name of skillToolNames) {
      if (excludedTools?.has(name)) continue;
      const tool = toolCatalogue.get(name);
      if (!tool) {
        logger.error(`Skill references unknown tool "${name}"; not loading`);
        continue;
      }
      map.set(tool.name, applyToolOverride(tool));
    }
    // Always include meta tools — independent of loaded skills.
    for (const tool of metaTools) {
      map.set(tool.name, applyToolOverride(tool));
    }
    return map;
  };

  const system = buildSystemBlocks(loadedSkillIds);
  const toolMap = buildToolMap(loadedSkillIds);

  return {
    // Sonnet 4.6 default. Opus 4.7 routing per skill ships in W-C03-D.
    model: 'claude-sonnet-4-6',
    maxTokens: 4096,
    system,
    toolMap,
    toolCtx,
    buildToolMap,
    buildSystemBlocks,
  };
}
