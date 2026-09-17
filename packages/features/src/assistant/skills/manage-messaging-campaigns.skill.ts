import type { SkillModule } from './types.js';

/**
 * Manage-messaging-campaigns skill — loaded by the intent classifier when the
 * user wants to view, create, or send a BULK MESSAGING campaign (an email blast
 * to an audience segment).
 *
 * This is distinct from `manage-campaigns` (Meta Ads campaign containers) and
 * `create-campaign` (the inline ad-creation flow). Those are paid-ad concepts;
 * this skill is the bulk messaging product — direct outbound email to the org's
 * own contacts.
 *
 * **Email and WhatsApp only.** SMS is paused in the product: the UI hides it,
 * so Claire must not offer, promise or attempt it — a campaign she builds on a
 * hidden channel could not be reviewed or edited in the dashboard. Email and
 * WhatsApp are live and mirror `ENABLED_CHANNELS` in the frontend. WhatsApp is
 * business-initiated: outside the 24h customer-service window it can only send
 * a pre-approved Meta template, so a WhatsApp campaign needs an APPROVED
 * template picked via `campaigns_listWhatsappTemplates`.
 *
 * Tool names are the canonical factory names (`campaigns_*`) rather than the
 * bare-action aliases, because the bare actions (`list`, `create`, `launch`)
 * are generic and the Meta-ads tools already own `listCampaigns` /
 * `createCampaign`.
 */
export const manageMessagingCampaignsSkill: SkillModule = {
  id: 'manage-messaging-campaigns',
  oneLineDescription:
    'View, create, and send bulk messaging campaigns (email or WhatsApp to your own contacts), and create/save the audience segments they send to. Use when the user wants to email or WhatsApp their contacts directly OR build an audience segment/list (e.g. "won clients", "quiet 30+ days") — NOT to run Meta paid ads.',
  promptFragment: `## Bulk messaging

A bulk message sends email or WhatsApp to an audience **segment** (a saved group of the org's own contacts). This is different from Meta Ads — there's no ad spend; you're messaging contacts directly.

**Email and WhatsApp are the available channels. SMS is paused** — do not offer, suggest or attempt SMS, and do not describe it as coming soon; if asked, say SMS bulk messaging isn't available yet and offer email or WhatsApp instead. **WhatsApp is business-initiated:** to reach contacts outside WhatsApp's 24-hour window it must send a pre-approved Meta template, so a WhatsApp campaign requires an APPROVED template (see step 4). If the org has no approved template, tell the user to create one in Settings → Message templates and get it approved by Meta first, or send by email instead.

When the user wants to work with bulk messaging:

1. **See what's there.** Call \`campaigns_list\` for existing bulk messages. \`campaigns_checkChannels\` reports what the org can deliver on; act on the email and whatsapp results only — ignore any sms result.
2. **Pick the audience.** Call \`campaigns_segments_list\` to show the saved segments. If none fits, build one with \`campaigns_createSegment\` — describe the audience as filters (lead statuses, sources, tags, created window, or \`lastContactedBefore\` for "quiet for 30+ days" style re-engagement) and give it a clear name. It returns live per-channel reach counts; relay the reach for the channel(s) you'll send on ("that's 42 contacts, 30 reachable by email, 18 by WhatsApp"). For an existing segment, \`campaigns_previewAudience\` reports the same counts. Segments send nothing by themselves.
3. **Create the draft — no confirm.** Call \`campaigns_create\` with a clear name, the chosen channels (\`["email"]\`, \`["whatsapp"]\`, or both), and the \`segmentId\`. It is created as a **draft** and sends nothing, so build it straight away with sensible defaults.
4. **Write the content.** Call \`campaigns_setMessage\` per channel:
   - **email** — needs a subject and a body. Bodies support merge tags like \`{{firstName|there}}\` — always include a fallback.
   - **whatsapp** — call \`campaigns_listWhatsappTemplates\` and pick an APPROVED template, then set the message with its \`whatsappTemplateId\` and one \`whatsappTemplateParams\` value per {{1}}..{{n}} placeholder (params may themselves use merge tags like \`{{firstName|there}}\`). Never try to send free-form WhatsApp text for a bulk campaign — only approved templates deliver outside the 24h window.
5. **Show the preview card.** After building or editing, ALWAYS call \`campaigns_showCampaignPreview\` — it renders an interactive review card in chat (audience reach, the per-channel message, launch blockers). Fix any blockers it reports (e.g. a WhatsApp template that isn't approved) before proposing a launch. The card's "Launch" action routes back to you as a launch request.
6. **Launching SENDS REAL MESSAGES — always confirm.** Call \`campaigns_launch\` with the \`campaignId\`. This materializes the audience and messages every recipient, so it goes through a confirmation step: the first call returns a confirmation card; once the owner approves, the launch runs. Never launch without that explicit confirmation, and never imply a bulk message has sent before the launch is confirmed.

Things to keep in mind:
- "Campaign" can be ambiguous. If the user is talking about Facebook/Instagram **ads** or ad spend, that's the Meta Ads flow — not this skill. This skill is only for direct email/WhatsApp to their own contacts.
- Drafts are harmless and editable; launching is the irreversible, reputation-sensitive boundary. Confirm only there.
- Older bulk messages may show SMS in their history. Report that history accurately if asked, but never offer SMS for a new one.`,
  toolNames: [
    'campaigns_checkChannels',
    'campaigns_list',
    'campaigns_segments_list',
    'campaigns_createSegment',
    'campaigns_previewAudience',
    'campaigns_create',
    'campaigns_setMessage',
    'campaigns_listWhatsappTemplates',
    'campaigns_showCampaignPreview',
    'campaigns_launch',
  ],
  preferredModel: 'sonnet',
  whenToLoad: 'classifier',
};
