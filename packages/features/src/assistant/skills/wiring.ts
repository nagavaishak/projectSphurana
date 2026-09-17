/**
 * Skill→tool wiring helpers.
 *
 * Pure functions that take the registered tool descriptors and return:
 *   - The full set of resolvable tool names (canonical `{feature}_{action}`
 *     plus the bare-action alias the controller registers in its catalogue
 *     map, see `apps/api/src/assistant/assistant-chat.controller.ts`).
 *   - A list of skill→tool wiring failures, with prescriptive error messages
 *     so a CI fail tells the engineer exactly what to do.
 *
 * Why a pure helper instead of importing from `apps/api`:
 *   - `@borradh-workspace/features` cannot depend on the API app (one-way
 *     dependency: api → features, never the reverse).
 *   - The controller's catalogue is assembled inside a Nest provider that
 *     pulls Postgres + env + auth context. Reimplementing the registration
 *     contract (`name` + `action`) here keeps the test hermetic.
 *
 * The test file mirrors the registered tool list in `KNOWN_TOOL_NAMES`. When
 * a new tool is registered in `apps/api/src/assistant/tools/*`, the mirror
 * must be updated in the same PR — the runtime check in the controller
 * (`logger.error("Skill references unknown tool ...")`) is the safety net for
 * drift between the test mirror and reality.
 *
 * This is the build-time check that would have caught the `createCampaign`
 * drift bug that prompted the Claire Creation Redesign — see
 * `docs/implementations/claire-creation-redesign.md`.
 */

import type { SkillModule } from './types.js';

/**
 * Minimal structural shape of a registered tool descriptor — matches the
 * `name` and `action` fields on `ToolDefinition` over in `apps/api`. Kept as
 * an interface here so tests can construct fixtures without importing from
 * the API package.
 */
export interface ToolDescriptor {
  /** Canonical name, e.g. `meta_ads_createCampaign`. */
  name: string;
  /** Bare action name, e.g. `createCampaign`. */
  action: string;
}

/**
 * Returns every tool name a skill's `toolNames` array is allowed to
 * reference — i.e. the union of the canonical name and the bare action alias
 * for every registered tool. Mirrors the controller's `toolCatalogue` keys.
 *
 * In the controller, the alias slot can be lost if a later tool registers
 * under the same bare name (the `if (!toolCatalogue.has(tool.action))` guard
 * in `assistant-chat.controller.ts`). For the build-time check we assume
 * every alias is reachable — duplicate-action collisions are caught by the
 * controller's `Duplicate tool name` log at startup.
 */
export function resolvableToolNames(tools: ToolDescriptor[]): Set<string> {
  const names = new Set<string>();
  for (const tool of tools) {
    names.add(tool.name);
    names.add(tool.action);
  }
  return names;
}

/**
 * A single skill→tool drift. The `message` is intentionally verbose so a CI
 * fail tells the engineer exactly what to do.
 */
export interface SkillToolWiringFailure {
  skillId: string;
  toolName: string;
  message: string;
}

/**
 * Walks every skill in the given list and returns a failure entry for each
 * `toolNames` reference that doesn't resolve in the known-name set.
 *
 * Empty `toolNames` is allowed — composite skills (`weekly-marketing-review`,
 * `create-offer-and-promote-v1`, `respond-to-low-cpl`) intentionally
 * delegate tool selection to child skills via `meta_loadSkill`.
 */
export function validateSkillToolNames(
  skillsToCheck: SkillModule[],
  knownToolNames: ReadonlySet<string>
): SkillToolWiringFailure[] {
  const failures: SkillToolWiringFailure[] = [];
  for (const skill of skillsToCheck) {
    for (const toolName of skill.toolNames) {
      if (knownToolNames.has(toolName)) continue;
      failures.push({
        skillId: skill.id,
        toolName,
        message: `Skill "${skill.id}" references tool "${toolName}" but no such tool is registered. Either register the tool in apps/api/src/assistant/tools/{feature}/index.ts (and add it to the KNOWN_TOOL_NAMES mirror in packages/features/src/assistant/skills/skills.test.ts), or remove it from the skill's toolNames in packages/features/src/assistant/skills/${skill.id}.skill.ts.`,
      });
    }
  }
  return failures;
}
