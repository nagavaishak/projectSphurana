import type { ToolDefinition } from '../tool-factory/index.js';
import { adsTools } from './ads/index.js';
import { appointmentsTools } from './appointments/index.js';
import { campaignsTools } from './campaigns/index.js';
import { chatbotsTools } from './chatbots/index.js';
import { claireTools } from './claire/index.js';
import { contentBatchesTools } from './content-batches/index.js';
import { contentTools } from './content/index.js';
import { contextTools } from './context/index.js';
import { customerConversationsTools } from './customer-conversations/index.js';
import { leadFormsTools } from './lead-forms/index.js';
import { leadsTools } from './leads/index.js';
import { metaTools } from './meta/index.js';
import { offersTools } from './offers/index.js';
import { orgDefaultsTools } from './org-defaults/index.js';
import { packagesTools } from './packages/index.js';
import { practitionersTools } from './practitioners/index.js';
import { salesTools } from './sales/index.js';
import { shiftsTools } from './shifts/index.js';
import { socialPostsTools } from './social-posts/index.js';
import { supportTools } from './support/index.js';
import { videosTools } from './videos/index.js';

/**
 * THE tool registry. One list. Everything that dispatches a Claire tool reads it.
 *
 * There used to be three copies of this list — one in `build-claire-turn-inputs.ts`
 * (the only one that serves real web and WhatsApp turns), one in
 * `run-headless-turn.ts` (the eval and E2E), and one in the controller's dev-tuning
 * endpoint. Two of them carried comments claiming they were "identical" and "moved
 * verbatim". They were not:
 *
 *   - `campaignsTools` was in the eval and dev lists and MISSING from prod, so the
 *     entire messaging-campaigns skill was dead in production while the eval — which
 *     read a different list — stayed green. Works in test, broken in prod.
 *   - `socialPostsTools` was in NO list, so `schedulePost` / `publishPostNow` /
 *     `deleteSocialPostDraft` resolved to nothing. Production logs show Claire being
 *     told to call them, on real user turns, for over a month.
 *
 * A tool now exists in exactly one place, and "registered in prod but not in the
 * eval" (or the reverse) is unspellable. `tool-registry.spec.ts` enforces the other
 * half: every tool a skill asks for must resolve against THIS list — not against a
 * hand-typed mirror, which is what let the drift hide.
 *
 * ORDER IS LOAD-BEARING. `buildToolCatalogue` keys each tool by its canonical name
 * (`social_posts_schedulePost`) AND by its bare action (`schedulePost`), and the
 * FIRST registration of an action wins. `contentShimmed` (the legacy `ToolSet`) is
 * therefore kept ahead of `socialPostsTools`, so the five actions they share keep
 * resolving to the legacy implementation exactly as they do today, while the three
 * that only exist in the new factory tools finally resolve. Reordering these two
 * silently swaps Claire's posting implementation — don't, except deliberately.
 */
export function buildToolRegistry(
  /**
   * The legacy `createContentTools()` set, shimmed to factory shape. It is built
   * per-request because it closes over the org context, so it cannot be a
   * module-level constant like the rest.
   */
  contentShimmed: ToolDefinition[]
): ToolDefinition[] {
  return [
    ...adsTools,
    ...videosTools,
    ...contentBatchesTools,
    ...contentTools,
    ...contentShimmed,
    ...contextTools,
    ...leadsTools,
    ...leadFormsTools,
    ...appointmentsTools,
    ...campaignsTools,
    ...offersTools,
    ...customerConversationsTools,
    ...orgDefaultsTools,
    ...metaTools,
    ...claireTools,
    ...shiftsTools,
    ...practitionersTools,
    ...salesTools,
    ...packagesTools,
    ...socialPostsTools,
    ...supportTools,
    ...chatbotsTools,
  ];
}

/**
 * Every key a skill's `toolNames` may legitimately resolve to: the canonical
 * `feature_action` name and the bare `action` alias, for every registered tool.
 *
 * This is what the gate checks against, and it is DERIVED — never typed by hand.
 * The list it replaces (`KNOWN_TOOL_NAMES`, 265 lines in a spec file) vouched for
 * four tools that resolve to nothing, which is exactly what a hand-written list
 * does: it cannot fail to mention the thing that is missing.
 */
export function resolvableToolNames(registry: ToolDefinition[]): Set<string> {
  const names = new Set<string>();
  for (const tool of registry) {
    names.add(tool.name);
    names.add(tool.action);
  }
  return names;
}
