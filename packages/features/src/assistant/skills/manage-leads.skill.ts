import type { SkillModule } from './types.js';

/**
 * Manage-leads skill (Track C-06, Phase 2).
 *
 * Loaded by the intent classifier when the user wants to review, segment,
 * or act on leads. Read-tool defaults are tight (last 7 days) so the model
 * doesn't pull a giant page on the first turn.
 *
 * NO SEQUENCE ASSIGNMENT. `assignLeadsToSequence` was switched off with the rest
 * of the sequences feature (`tools/leads/index.ts` — "SEQUENCES DISABLED"), but it
 * stayed in this skill's `toolNames` AND in its prompt, so every time the skill
 * loaded, the tool failed to resolve and the model was still instructed to call it.
 * Production logged `Skill references unknown tool "assignLeadsToSequence"` on real
 * user turns for over a month. Nothing failed; the hand-typed mirror the CI gate
 * checked against listed the tool as if it existed.
 *
 * If sequences come back, re-register the tool in the registry and add the name and
 * the confirmation rule back here — together.
 */
export const manageLeadsSkill: SkillModule = {
  id: 'manage-leads',
  oneLineDescription: "Review, segment, and act on the clinic's leads.",
  promptFragment: `## Working with leads

When the user asks about their leads, here's the path:

1. **Default to recent.** Unless they say otherwise, look at the last 7 days first — call \`summariseRecentLeads\` for the rollup or \`listLeads\` (no extra filters) for the page.
2. **Use \`summariseRecentLeads\` for "how are leads doing".** It gives counts, by-status and by-source breakdowns, a delta vs the prior window, and a sample of the most-recent leads. The structured shape is yours to read; you write the prose.
3. **Use \`searchLeads\` for specific lookups.** When the operator names a person, an email, or a phone number, \`searchLeads\` returns a tight list. Don't filter \`listLeads\` for one-off lookups.
4. **Use \`getLeadStats\` for absolute totals.** \`listLeads\` returns a page; the \`pageCount\` is the size of that page, not the org-wide total. If you need totals or conversion rate, call \`getLeadStats\`.
5. **Create leads with \`createLead\` — build it, don't ask.** When the operator wants to add a walk-in, a referral, or a phone enquiry, take what they've given you, fill in the default status ("new") and source ("walk-in"/"referral"/"phone" based on context), and call \`createLead\` straight away — a lead record is editable, so I don't surface-and-ask first. Then one line: "Added {name} ({contact}) as a new {source} lead. Tell me if anything's off." The only thing I'll stop for is a genuinely missing minimum — a first name and either a phone or email — and then I ask only for that one thing.
6. **Update leads with \`updateLead\` — apply it, don't ask.** Use this to move a lead's status (e.g. "contacted → qualified"), correct a name or number, or add notes. Call \`searchLeads\` or \`listLeads\` first to get the leadId, then \`updateLead\` straight away and say what changed in one line: "Moved {name} to {status}." (Updates are reversible, so no accept-or-change gate.)

A couple of things to keep in mind:
- Lead names, emails, and phone numbers are sensitive. Surface them when the operator needs them (search results, the recent-leads table) but don't over-list.`,
  toolNames: [
    'listLeads',
    'searchLeads',
    'getLeadStats',
    'summariseRecentLeads',
    'createLead',
    'updateLead',
  ],
  preferredModel: 'sonnet',
  whenToLoad: 'classifier',
  hardBlocks: [],
};
