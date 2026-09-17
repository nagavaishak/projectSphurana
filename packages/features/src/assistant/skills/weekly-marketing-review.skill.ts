import type { SkillModule } from './types.js';

/**
 * Weekly-marketing-review composite skill (Track C-15, Phase 4).
 *
 * Loaded by the intent classifier when the operator asks for a weekly read on
 * the clinic. The skill itself doesn't carry feature tools — instead it
 * orchestrates the four read paths across leads, ads, customer chats, and
 * appointments by loading each child skill in turn and calling its summary
 * tool. The actual data plumbing lives in:
 *   - `summariseRecentLeads`               (manage-leads, W-C06)
 *   - `suggestAdOptimizations`             (optimise-ads, W-C05)
 *   - `summariseConversationsThisWeek`     (manage-customer-chats, W-C09)
 *   - `summariseUpcomingDay` / `listAppointments` (manage-appointments, W-C07)
 *
 * `toolNames` is empty: composite skills carry no tool fan-out of their
 * own. Meta tools (`meta_loadSkill`) are always loaded by the controller
 * regardless of skill set, and child-skill tools come in dynamically as
 * the model fires `meta_loadSkill('manage-leads')` etc. mid-turn.
 *
 * Opus + extended thinking because synthesising across four data sources
 * into a tight, non-padded 4-section read benefits from the deeper
 * reasoning budget. Brevity is the brand: the prompt is explicit about
 * not padding, leading with broken state, and ending with one or two
 * specific moves rather than vague suggestions.
 */
export const weeklyMarketingReviewSkill: SkillModule = {
  id: 'weekly-marketing-review',
  oneLineDescription:
    'A weekly read on the clinic — leads, ads, customer chats, and the week ahead.',
  promptFragment: `## Weekly marketing review

When the user asks for a weekly read or "how did this week go?", here's the path:

1. **Pull the data first.** Load each of these skills in turn, then call the summary tool on each:
   - \`load_skill('manage-leads')\` → \`summariseRecentLeads\` with \`timeframe: 'this_week'\`
   - \`load_skill('optimise-ads')\` → \`suggestAdOptimizations\` (skip if Meta isn't connected — \`checkMetaIntegration\` first if I'm not sure)
   - \`load_skill('manage-customer-chats')\` → \`summariseConversationsThisWeek\`
   - \`load_skill('manage-appointments')\` → \`summariseUpcomingDay\` for tomorrow, or \`listAppointments\` for a week-ahead range if they asked for it
2. **Lead with anything broken.** If Meta's token is expired, the inbox response time is blown out, the operator hasn't replied to anything in 24+ hours, or there were no leads at all this week — that's the headline. Surface it before the four sections so it's the first thing they read.
3. **Lay out a tight four-section read**: Leads, Ads, Customer chats, Appointments. Numbers first, then one or two sentences of observation on each. State what changed; don't editorialise. "Your CPL is up week-over-week" — not "your CPL is unfortunately trending in the wrong direction".
4. **End with one or two specific moves.** Not "consider doing X" — pick the highest-leverage action from the data and say "I'd do X this week because Y." If everything is steady, say so and stop there. One concrete move beats five vague nudges.

A few things to keep in mind:
- The owner reads this every week. Brevity is the brand — no padding, no preamble, no apology phrases.
- Treatments people come back for are the long game. When picking what to suggest, lean toward services with short rebooking cycles over one-off high-margin treatments.
- If a sub-skill returns sparse data (no leads, no ads, no conversations), say so plainly — don't pretend there's more to say.
- The four sub-skills enforce their own hard blocks (no surgical pricing in chat, no fabricated result claims, no live-campaign changes during learning phase). Trust them; don't second-guess.`,
  toolNames: [],
  preferredModel: 'opus',
  whenToLoad: 'classifier',
  extendedThinking: { enabled: true, budgetTokens: 4000 },
  hardBlocks: [],
};
