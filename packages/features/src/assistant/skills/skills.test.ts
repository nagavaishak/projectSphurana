import { describe, expect, it } from '@borradh-workspace/testing';
import {
  SKILL_REGISTRY_VERSION,
  buildToolListForSkills,
  getSkillById,
  skills,
} from './index.js';
import type { SkillModule } from './types.js';
import {
  type ToolDescriptor,
  resolvableToolNames,
  validateSkillToolNames,
} from './wiring.js';

describe('skills registry', () => {
  it('registers all 22 expected skills', () => {
    expect(skills.map((s) => s.id)).toEqual([
      'default',
      'create-campaign',
      'manage-campaigns',
      'manage-messaging-campaigns',
      'create-ad',
      'optimise-ads',
      'pause-ad',
      'update-budget',
      'schedule-post',
      'generate-video',
      'generate-graphic',
      'review-content',
      'manage-leads',
      'manage-lead-forms',
      'manage-services',
      'manage-appointments',
      'manage-offers',
      'manage-customer-chats',
      'manage-defaults',
      'create-offer-and-promote-v1',
      'weekly-marketing-review',
      'respond-to-low-cpl',
    ]);
  });

  /**
   * DELETED: the mirror-based wiring test.
   *
   * It validated skill `toolNames` against `KNOWN_TOOL_NAMES` — a hand-typed list in
   * THIS file. Its docstring claimed it "would have caught the createCampaign drift
   * bug". It did not. It vouched for seven tools that resolved to nothing at runtime,
   * so CI was green while, in production, Claire was being handed a prompt telling her
   * to call tools that had never been registered. BetterStack logged
   * `Skill references unknown tool "..."` on real user turns for over a month.
   *
   * A hand-written list cannot fail to mention the thing that is missing.
   *
   * The real gate is `apps/api/src/assistant/tools/tool-registry.spec.ts`, which
   * checks skills against the ACTUAL registry (`tools/registry.ts`) — the same list
   * the runtime catalogues are built from. It lives on the api side because
   * `packages/features` cannot import `apps/api`; that constraint is exactly why the
   * mirror existed, and inverting the dependency is what let it be deleted.
   */

  it('rejects a synthetic skill that references a non-existent tool (safety-net sanity)', () => {
    // Proves the validator actually catches drift — without this, a silent
    // regression in `validateSkillToolNames` (e.g. returning early on
    // failure) wouldn't be detectable from the main test.
    const syntheticSkill: SkillModule = {
      id: 'synthetic-drift-fixture',
      oneLineDescription: 'test fixture — never registered',
      promptFragment: '',
      toolNames: ['definitely_not_a_real_tool'],
      preferredModel: 'sonnet',
      whenToLoad: 'classifier',
    };
    // An arbitrary known-set: this test exercises the HELPER's error message, not
    // the registry. The registry itself is checked by the api-side gate (see above).
    const failures = validateSkillToolNames(
      [syntheticSkill],
      new Set(['listLeads', 'createLead'])
    );
    expect(failures).toHaveLength(1);
    expect(failures[0].skillId).toBe('synthetic-drift-fixture');
    expect(failures[0].toolName).toBe('definitely_not_a_real_tool');
    // Message tells the engineer the two ways to fix the drift.
    expect(failures[0].message).toContain('synthetic-drift-fixture');
    expect(failures[0].message).toContain('definitely_not_a_real_tool');
    expect(failures[0].message).toContain(
      'apps/api/src/assistant/tools/{feature}/index.ts'
    );
    expect(failures[0].message).toContain('remove it from the skill');
  });

  it('resolvableToolNames includes both canonical and bare-action forms', () => {
    // Mirrors how the controller's tool catalogue keys both
    // `meta_ads_createCampaign` and `createCampaign` — the test for the
    // helper itself, since the wiring test above depends on it producing
    // the right shape.
    const descriptors: ToolDescriptor[] = [
      { name: 'meta_ads_createCampaign', action: 'createCampaign' },
      { name: 'context_listServices', action: 'listServices' },
    ];
    const names = resolvableToolNames(descriptors);
    expect(names.has('meta_ads_createCampaign')).toBe(true);
    expect(names.has('createCampaign')).toBe(true);
    expect(names.has('context_listServices')).toBe(true);
    expect(names.has('listServices')).toBe(true);
    expect(names.size).toBe(4);
  });

  it('every skill has a unique ID', () => {
    const ids = new Set<string>();
    for (const skill of skills) {
      expect(ids.has(skill.id)).toBe(false);
      ids.add(skill.id);
    }
  });

  it('default skill is loaded always; others on classifier', () => {
    const def = getSkillById('default');
    expect(def?.whenToLoad).toBe('always');

    for (const skill of skills) {
      if (skill.id === 'default') continue;
      expect(skill.whenToLoad).toBe('classifier');
    }
  });

  it('opus skills enable extended thinking; sonnet skills do not', () => {
    for (const skill of skills) {
      if (skill.preferredModel === 'opus') {
        expect(skill.extendedThinking?.enabled).toBe(true);
      } else {
        expect(skill.extendedThinking).toBeUndefined();
      }
    }
  });

  it('all classifier-loaded manage-* skills are filled (no remaining stubs)', () => {
    // Post-W-C09-tools: every `manage-*` skill ships content.
    // `manage-appointments` (W-C07), `manage-leads` (W-C06), `manage-offers`
    // (W-C08), `manage-customer-chats` (W-C09-tools) all have non-empty
    // fragments + toolNames.
    const filled = [
      'manage-appointments',
      'manage-leads',
      'manage-offers',
      'manage-customer-chats',
    ];
    for (const id of filled) {
      const skill = getSkillById(id);
      expect(skill).toBeDefined();
      expect(skill?.promptFragment.length).toBeGreaterThan(0);
      expect(skill?.toolNames.length).toBeGreaterThan(0);
    }
  });

  it('manage-customer-chats is filled (W-C09-tools) with prompt fragment + 11 tool names + hard blocks', () => {
    const skill = getSkillById('manage-customer-chats');
    expect(skill).toBeDefined();
    expect(skill?.promptFragment.length).toBeGreaterThan(0);
    expect(skill?.toolNames).toEqual([
      // The chatbot kill switch (Claire reliability overhaul Phase 8 / #65)
      // rides in this operator-facing skill: turning the customer chatbot off
      // is a "manage my customer chats" intent. `chatbots_setDirective` sits
      // beside it — editing the bot's top-level override is the same intent.
      'chatbots_setEnabled',
      'chatbots_setDirective',
      'listOpenConversations',
      'summariseConversation',
      'summariseConversationsThisWeek',
      'draftReply',
      'sendReply',
      'confirmEscalateToHuman',
      'executeEscalateToHuman',
      'confirmAssignConversation',
      'executeAssignConversation',
    ]);
    expect(skill?.hardBlocks).toEqual(['noSurgicalPricingInChat']);
  });

  it('manage-appointments is filled (W-C07) with prompt fragment + tool names', () => {
    const skill = getSkillById('manage-appointments');
    expect(skill).toBeDefined();
    expect(skill?.promptFragment.length).toBeGreaterThan(0);
    expect(skill?.toolNames).toEqual([
      // `listTeam` first: it is the only source of a `practitionerId`, which
      // both explainAvailability and bookAppointment take and neither can
      // invent. Then explainAvailability — "why can't customers book?" is
      // answered by it, not by findOpenSlots returning an empty list.
      'listTeam',
      'explainAvailability',
      'findOpenSlots',
      'listAppointments',
      'summariseUpcomingDay',
      'bookAppointment',
      'rescheduleAppointment',
      'cancelAppointment',
      'setAppointmentStatus',
      'markNoShow',
    ]);
  });

  it('manage-leads is filled (W-C06) with prompt fragment + tool names', () => {
    const skill = getSkillById('manage-leads');
    expect(skill).toBeDefined();
    expect(skill?.promptFragment.length).toBeGreaterThan(0);
    expect(skill?.toolNames).toEqual([
      'listLeads',
      'searchLeads',
      'getLeadStats',
      'summariseRecentLeads',
      'createLead',
      'updateLead',
      // NO assignLeadsToSequence: the tool was switched off with the rest of the
      // sequences feature but stayed in the skill's toolNames AND its prompt, so
      // prod logged `Skill references unknown tool` on real turns for a month while
      // CI stayed green against a hand-typed mirror. See tool-registry.spec.ts.
    ]);
  });

  it('create-offer-and-promote-v1 is registered as an opus-routed composite skill (W-C15-promote-flow)', () => {
    const skill = getSkillById('create-offer-and-promote-v1');
    expect(skill).toBeDefined();
    expect(skill?.preferredModel).toBe('opus');
    expect(skill?.whenToLoad).toBe('classifier');
    // Composite skill carries no tool fan-out of its own — meta tools are
    // always loaded by the controller, child-skill tools come in dynamically
    // via meta_loadSkill.
    expect(skill?.toolNames).toEqual([]);
    expect(skill?.hardBlocks ?? []).toEqual([]);
    expect(skill?.extendedThinking?.enabled).toBe(true);
    // Prompt fragment references the three child skills it orchestrates.
    expect(skill?.promptFragment).toContain("load_skill('manage-offers')");
    expect(skill?.promptFragment).toContain("load_skill('generate-video')");
    expect(skill?.promptFragment).toContain("load_skill('schedule-post')");
  });

  it('weekly-marketing-review is registered as an opus-routed composite skill (W-C15-weekly-review)', () => {
    const skill = getSkillById('weekly-marketing-review');
    expect(skill).toBeDefined();
    expect(skill?.preferredModel).toBe('opus');
    expect(skill?.whenToLoad).toBe('classifier');
    // Composite skill carries no tool fan-out of its own — meta tools are
    // always loaded by the controller, child-skill tools come in dynamically
    // via meta_loadSkill.
    expect(skill?.toolNames).toEqual([]);
    expect(skill?.hardBlocks ?? []).toEqual([]);
    expect(skill?.extendedThinking?.enabled).toBe(true);
    // Prompt fragment references the four child skills it orchestrates.
    expect(skill?.promptFragment).toContain("load_skill('manage-leads')");
    expect(skill?.promptFragment).toContain("load_skill('optimise-ads')");
    expect(skill?.promptFragment).toContain(
      "load_skill('manage-customer-chats')"
    );
    expect(skill?.promptFragment).toContain(
      "load_skill('manage-appointments')"
    );
  });

  it('respond-to-low-cpl is registered as an opus-routed composite skill (W-C15-cpl-response)', () => {
    const skill = getSkillById('respond-to-low-cpl');
    expect(skill).toBeDefined();
    expect(skill?.preferredModel).toBe('opus');
    expect(skill?.whenToLoad).toBe('classifier');
    // Composite skill carries no tool fan-out of its own — meta tools are
    // always loaded by the controller, child-skill tools come in dynamically
    // via meta_loadSkill. Hard blocks are enforced by the underlying ad
    // tools (W-C05) — this composite reinforces them at the prompt layer
    // but doesn't declare validators of its own.
    expect(skill?.toolNames).toEqual([]);
    expect(skill?.hardBlocks ?? []).toEqual([]);
    expect(skill?.extendedThinking?.enabled).toBe(true);
    // Prompt fragment references the diagnose-then-act child skills it
    // routes between based on the data.
    expect(skill?.promptFragment).toContain("load_skill('optimise-ads')");
    expect(skill?.promptFragment).toContain("load_skill('pause-ad')");
    expect(skill?.promptFragment).toContain("load_skill('update-budget')");
    expect(skill?.promptFragment).toContain("load_skill('generate-video')");
  });

  it('persona content lives in the default skill and uses the Claire identity', () => {
    const def = getSkillById('default');
    expect(def?.promptFragment).toContain("I'm Claire");
    expect(def?.promptFragment).not.toContain('Borradh AI');
  });

  it('default persona has no exclamation marks (tone rule)', () => {
    const def = getSkillById('default');
    expect(def?.promptFragment).not.toContain('!');
  });

  it('generate-video skill advertises organic formats and drops the two-format restriction', () => {
    const skill = getSkillById('generate-video');
    expect(skill).toBeDefined();
    const prompt = skill?.promptFragment ?? '';
    // Organic formats are now offered to Claire.
    for (const fmt of [
      'caption_tease',
      'ins_outs',
      'question_cta',
      'improves',
    ]) {
      expect(prompt).toContain(fmt);
    }
    // The old hard restriction text must be gone.
    expect(prompt).not.toContain('only two formats');
    // before_after / offer stay wizard-only, so the prompt must still steer
    // users away from creating them through chat.
    expect(prompt).toContain('wizard');
  });

  it('skill prompt fragments avoid "just" as a softener', () => {
    // The default persona explains the rule by quoting "just" — exclude the
    // self-referential line. Outside of that meta-mention, no skill should
    // use "just" as a standalone word.
    const offenders: string[] = [];
    for (const skill of skills) {
      const lines = skill.promptFragment.split('\n');
      for (const [idx, line] of lines.entries()) {
        // Skip the persona's self-explaining line about the rule.
        if (line.includes('"just"')) continue;
        // Skip QUOTED text. A markdown blockquote in a skill is a verbatim
        // example of output — and the ones worth quoting are the bad ones, so
        // a rule against softeners firing on them would forbid showing the
        // model the exact turn it must not repeat. The rule governs what the
        // skill INSTRUCTS, not what it exhibits.
        if (line.trimStart().startsWith('>')) continue;
        if (/\bjust\b/i.test(line)) {
          offenders.push(`${skill.id} L${idx + 1}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('SKILL_REGISTRY_VERSION is a positive integer', () => {
    expect(Number.isInteger(SKILL_REGISTRY_VERSION)).toBe(true);
    expect(SKILL_REGISTRY_VERSION).toBeGreaterThan(0);
  });
});

describe('buildToolListForSkills', () => {
  it('returns the deduped union of tool names across loaded skills', () => {
    const tools = buildToolListForSkills(['default', 'create-ad']);
    // default contributes getOrganizationContext, listServices.
    // create-ad contributes checkMetaIntegration, listRecentVideos, listServices, generateAdCopy, listCampaigns, createDraftAd, confirmLaunchAd, executeLaunchAd.
    // Expect dedup of listServices.
    expect(tools).toContain('getOrganizationContext');
    expect(tools).toContain('listServices');
    expect(tools).toContain('checkMetaIntegration');
    expect(tools).toContain('createDraftAd');
    // Dedup check: listServices appears once.
    const listServicesCount = tools.filter((t) => t === 'listServices').length;
    expect(listServicesCount).toBe(1);
  });

  it('silently drops unknown skill IDs', () => {
    const tools = buildToolListForSkills(['default', 'no-such-skill']);
    expect(tools).toContain('getOrganizationContext');
    // No throw.
  });

  it('returns [] for empty input', () => {
    expect(buildToolListForSkills([])).toEqual([]);
  });

  it('preserves first-occurrence order across skills', () => {
    const tools = buildToolListForSkills(['default', 'pause-ad']);
    // default's tools (getOrganizationContext, listServices) come first;
    // then pause-ad's (listCampaigns, confirmPauseAd, executePauseAd).
    expect(tools[0]).toBe('getOrganizationContext');
    expect(tools[1]).toBe('listServices');
  });
});
