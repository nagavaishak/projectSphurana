/**
 * Capability manifest — the single, generated statement of what Claire can and
 * cannot do, sourced from the `coverage.ts` files (Gate 6) rather than from
 * free prose scattered across twenty skills.
 *
 * WHY THIS EXISTS (Claire reliability overhaul, Phase 8, findings #4 #9 #66).
 * The audit's "capability-lie" class had two symmetric shapes:
 *
 *   - Denying a capability she HAS. #4 (collected a whole campaign brief, then
 *     "I can't create campaigns"), #66 (denied tone control that
 *     `meta_remember` provides). The truth lived in the tool registry; the
 *     prose in the prompt disagreed with it and drifted.
 *   - Marketing a capability she LACKS. #9 (sold a nurture sequence she cannot
 *     build — the sequences tools were switched off).
 *
 * Both become drift-impossible when the "can do" list is GENERATED from the
 * same coverage files the reachability gate already grades, and the short
 * "can't do" list is guarded so it can never name something that in fact
 * exists. When a tool is added or removed, the manifest changes with it; the
 * staleness spec (`capability-manifest.spec.ts`) fails CI until the committed
 * artifact is regenerated.
 *
 * The rendered string is committed to
 * `packages/features/src/assistant/skills/capability-manifest.generated.ts`
 * (the prompt lives in `packages/features`, which cannot import `apps/api`).
 * Regenerate with `pnpm --filter @borradh-workspace/api gen:capability-manifest`.
 */

import { collectCoverageFiles } from './tool-coverage.js';

/**
 * A capability commonly ASKED FOR that Claire genuinely cannot perform because
 * no tool backs it. Curated (an absence has no endpoint to generate from), but
 * guarded: `contradictedBy` is matched against every exposed tool name, and the
 * builder throws if it matches — so the day sequences (or anything else here)
 * ship a tool, this list cannot keep lying about their absence.
 */
export interface KnownAbsence {
  /** One honest line the model is told to say plainly, never work around. */
  text: string;
  /**
   * If any EXPOSED tool name matches this, the absence claim is false and the
   * builder throws. Keep it specific to the capability, not a broad word.
   */
  contradictedBy: RegExp;
}

/**
 * The honest "can't" list. Deliberately short: it earns its place only when
 * owners actually ask for the thing and Claire has historically lied about it.
 */
export const KNOWN_ABSENCES: readonly KnownAbsence[] = [
  {
    text: 'Create, edit, or assign lead nurture sequences — the sequences tools are switched off. I do not offer to build a follow-up sequence, and I never say I have set one up.',
    // `leads_assignLeadsToSequence` was switched off; if any *Sequence* tool
    // returns, this line is wrong and CI forces its removal.
    contradictedBy: /sequence/i,
  },
  {
    text: 'Connect or disconnect an integration (Meta, Instagram, WhatsApp, Stripe, Google) — connecting is done by the owner in Settings, in a browser. I can check whether something is connected, and turn the customer chatbot on or off, but I cannot perform the OAuth connect myself.',
    // Only the OAuth *connect*/*disconnect* is absent; the chatbot toggle IS a
    // tool, so guard on a name that would only exist if connect itself shipped.
    contradictedBy: /_(connect|disconnect|oauth)/i,
  },
] as const;

/** One feature's exposed actions, for the "I can" section. */
export interface CapabilityGroup {
  /** The tool feature, e.g. `chatbots`, `meta_ads`, `campaigns`. */
  feature: string;
  /** Bare action names (the segment after the last underscore), sorted. */
  actions: string[];
}

export interface CapabilityData {
  groups: CapabilityGroup[];
  absences: string[];
}

/**
 * Split a canonical tool name into feature + action. `defineTool` builds the
 * name as `feature.replace(/-/g,'_') + '_' + action`, and actions are single
 * camelCase tokens with no underscore, so the action is everything after the
 * LAST underscore.
 */
function splitToolName(name: string): { feature: string; action: string } {
  const idx = name.lastIndexOf('_');
  if (idx === -1) return { feature: name, action: name };
  return { feature: name.slice(0, idx), action: name.slice(idx + 1) };
}

/**
 * Collect every exposed tool name from the coverage files, grouped by feature.
 * Throws if a `KNOWN_ABSENCES` entry is contradicted by an exposed tool — that
 * is the guard that keeps the "can't" list honest.
 */
export function buildCapabilityData(): CapabilityData {
  const files = collectCoverageFiles();
  const exposed = new Set<string>();
  for (const file of files) {
    for (const entry of Object.values(file.entries)) {
      if ('exposed' in entry) exposed.add(entry.exposed);
    }
  }

  for (const absence of KNOWN_ABSENCES) {
    const clash = [...exposed].find((name) =>
      absence.contradictedBy.test(name)
    );
    if (clash) {
      throw new Error(
        `Capability manifest: the "can't do" line ${JSON.stringify(
          absence.text.slice(0, 60)
        )}… is contradicted by exposed tool "${clash}". A tool for this now exists — remove or rewrite the KNOWN_ABSENCES entry.`
      );
    }
  }

  const byFeature = new Map<string, Set<string>>();
  for (const name of exposed) {
    const { feature, action } = splitToolName(name);
    if (!byFeature.has(feature)) byFeature.set(feature, new Set());
    byFeature.get(feature)?.add(action);
  }

  const groups: CapabilityGroup[] = [...byFeature.entries()]
    .map(([feature, actions]) => ({ feature, actions: [...actions].sort() }))
    .sort((a, b) => a.feature.localeCompare(b.feature));

  return { groups, absences: KNOWN_ABSENCES.map((a) => a.text) };
}

/**
 * Render the manifest into the prompt string. Deterministic (sorted) so the
 * committed artifact only changes when the capability set actually changes.
 */
export function renderCapabilityManifest(
  data: CapabilityData = buildCapabilityData()
): string {
  const lines: string[] = [
    '## What I can and can’t do',
    '',
    'This is generated from my actual tool registry, not a guess. If a request maps to something in "I can", I do it — loading the matching skill first if it isn’t loaded. If it maps to "I can’t", I say so plainly in one line and never claim I did it, and never offer to build it.',
    '',
    '### I can (tools that exist, grouped by feature)',
  ];
  for (const group of data.groups) {
    lines.push(`- ${group.feature}: ${group.actions.join(', ')}`);
  }
  lines.push('', '### I can’t (no tool exists — say so, don’t work around it)');
  for (const absence of data.absences) {
    lines.push(`- ${absence}`);
  }
  return lines.join('\n');
}
