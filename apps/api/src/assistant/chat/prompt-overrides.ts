import type { OrchestratorOverrides } from '@borradh-workspace/features/assistant';

/** Cap operator tuning directives so a runaway paste can't blow the prompt. */
export const MAX_EXTRA_DIRECTIVES_BYTES = 16 * 1024;

/**
 * Live prompt-tuning override bundle (uncommitted dev tool). Sent with each
 * chat / prompt-preview request from the in-chat tuning panel. Every field is
 * optional; absent fields fall back to the registered defaults.
 *
 * - `persona` / `skillIndex` / `businessContext`: replace those system blocks.
 * - `skillFragments`: per-skill-id replacements for Block 3 fragments (and
 *   the persona when keyed `default`).
 * - `toolDescriptions`: per-tool-name replacement descriptions — changes when
 *   and how the model reaches for a tool (e.g. the recommend-service tool).
 * - `extraDirectives`: free text appended last, highest priority.
 */
export interface PromptOverrides {
  persona?: string;
  skillIndex?: string;
  businessContext?: string;
  skillFragments?: Record<string, string>;
  toolDescriptions?: Record<string, string>;
  extraDirectives?: string;
}

/** Project a PromptOverrides bundle onto the orchestrator's block overrides. */
export function toOrchestratorOverrides(
  overrides?: PromptOverrides
): OrchestratorOverrides | undefined {
  if (!overrides) return undefined;
  return {
    persona: overrides.persona,
    skillIndex: overrides.skillIndex,
    businessContext: overrides.businessContext,
    skillFragments: overrides.skillFragments,
  };
}

/**
 * Local prompt-tuning hook (uncommitted dev tool). Wraps free-text operator
 * directives in a clearly-labelled, high-priority block appended to the end
 * of the system prompt. Returns null for empty/whitespace input so the
 * caller skips the block entirely.
 */
export function formatExtraDirectives(raw?: string | null): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const capped =
    Buffer.byteLength(trimmed, 'utf8') > MAX_EXTRA_DIRECTIVES_BYTES
      ? trimmed.slice(0, MAX_EXTRA_DIRECTIVES_BYTES)
      : trimmed;
  return [
    '## Operator Tuning Directives',
    "The following directives were supplied by the operator to tune Claire's behaviour for this session. Treat them as high-priority instructions that override earlier guidance where they conflict.",
    '',
    capped,
  ].join('\n');
}
