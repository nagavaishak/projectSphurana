import type { SkillModule } from './types.js';

/**
 * Generate-video skill — two-turn video creation, one chat confirmation.
 *
 * Turn 1: user says "make a video" → Claire calls `createContent`
 * immediately. The returned card IS the proposal — it shows the resolved
 * defaults (format, orientation, narration, script).
 *
 * Turn 2: user confirms in chat ("yes", "render it") → Claire calls
 * `renderVideo` with the item id. No button-based
 * confirmation step. The render queues, and the frontend renderer mounts
 * the `ProcessingStatus` loading card straight off the tool output.
 *
 * `renderVideo` is destructive, so the factory issues a token and mounts the
 * confirmation card itself when Claire proposes a render the owner did not ask
 * for. There is no second tool: one call asks, the same call acts once the
 * token comes back.
 *
 * Iteration happens after the draft exists: "change the script", "swap a
 * clip", "make it portrait" — Claire calls `patchContent` with the item id and
 * the owner's words. Which lever that pulls is decided server-side, where the
 * item's kind, its template fields and its clip list are; nothing renders until
 * the owner approves it on the card.
 *
 * The only allowed clarifying question is the missing-prerequisite case:
 * the org has no services AND the user asked for a service-specific video.
 * Then Claire points them to Services → New Service. That's it.
 */
export const generateVideoSkill: SkillModule = {
  id: 'generate-video',
  oneLineDescription:
    'Create a video in one prompt — partial input, defaults fill in the rest.',
  promptFragment: `## Creating a video

Two turns. Turn 1: the user asks → you create the draft. Turn 2: they confirm → you render. The defaults fill in everything else.

### WhatsApp flow (MANDATORY — overrides everything below for WhatsApp)

On WhatsApp there is no card UI, no QR scanner, no buttons.

**The ONLY question you may ask is "What service is it for?"** — and ONLY if the user didn't already mention one. If you can infer the service (or the org has only one), skip the question entirely and call \`createContent\` in the SAME turn as the user's request.

When you have a service (either they told you, or you picked one):
→ Call \`createContent\` with \`{ kind: 'video', serviceId }\` IMMEDIATELY — plus \`usage: 'organic'\` if they asked for a post rather than an ad, and no \`format\` unless they named one. Do not ask for confirmation first. Do not show a preview. Do not say "here's what I'll create". Call the tool directly.
→ After the tool returns, summarise the draft in a line or two and ask whether to change anything or render it. Word it yourself. There is no fixed sentence here on purpose: the one that used to be quoted in this file kept turning up on WEB, underneath a card that already showed every field it restated and already carried the buttons that answer it. A summary is what you write when the owner cannot see the thing — it is not a greeting to attach to a draft.

**YOU MUST NOT:**
- Ask what kind/type/format of video — always use \`educational\`
- Show a summary or ask "want me to go ahead?" BEFORE calling \`createContent\` — the tool call comes FIRST, ask questions AFTER
- Ask ANY follow-up question before creating the draft
- Call \`generateTalkingHeadQR\` — it does not exist on WhatsApp

After the draft: confirmation → \`renderVideo\`. Change requests → \`patchContent\`.

**Clip changes on WhatsApp: they describe, you search.** No options, no numbered lists, no thumbnails — a wall of clip descriptions is a worse version of a grid of pictures, and reciting one is not a substitute for showing it. "Swap the second clip for something with the treatment room in it" → \`listMedia\` with \`source: 'stock'\` on that description, then \`useStockClips\` to mint what you found, and say which clip you used so they can redirect you. If they gave you no criteria at all ("change the second clip"), ask what they want in it — one short question — rather than picking for them.

### The default path (web only — skip this entire section on WhatsApp)

**Turn 1 — the user asks for a video.**

Ask the user: **"What kind of video would you like to create?"** (WEB ONLY — never ask this on WhatsApp.) Keep the question short and casual. If they already specified a format, service, or style in the same message ("make an educational video about Botox"), skip the question and go straight to creating the draft. Only ask when the request is vague ("create a video", "make me a video", "I want a video").

1. **Pick a format.** Two families — ad formats and organic (social-post) formats.
   - **Ad formats:**
     - \`authority\` / \`talking head\` → \`authority\`.
     - \`educational\` / \`text-on-screen\` → \`educational\`.
     - \`before & after\` / \`transformation\` / \`results reveal\` → \`before_after\`.
     - \`offer\` / \`promo\` / \`deal\` / \`discount\` → \`offer\`.
   - **Organic formats** (pick one of these when the user wants an organic / social post rather than an ad):
     - typewriter headline + caption hook → \`caption_tease\`.
     - "in's & out's" / "do's & don'ts" list → \`ins_outs\`.
     - a question with a "read the caption" CTA → \`question_cta\`.
     - "X improves Y" service-benefit beats → \`improves\`.
     - highlighted-word caption over footage → \`highlight_caption\`.
     - curiosity-gap hook line → \`curiosity_hook\`.
     - numbered treatment steps with a timer → \`step_timer\`.
     - time-lapse / progress-over-time framing → \`time_progress\`.
     - this-or-that audience poll → \`poll\`.
     - myth-busting ("myth vs fact") → \`myth_fact\`.
     - comparing two treatments/options ("X vs Y") → \`versus\`.
     - price breakdown / "what it costs" reveal → \`price_reveal\`.
     - answering a common client question → \`client_question\`.
     - "come with me" behind-the-scenes mini-vlog → \`come_with_me\`.
   - If the user asked for an "organic" or "social post" video without naming a style, pick \`caption_tease\` (the most broadly-applicable organic format).
   - If the user said nothing about format at all → \`educational\`.

   Organic formats need no extra input from you — the server writes the on-screen copy from the service and tags the video as an organic social post. Don't ask the user for the headline / list items / question; the defaults fill them in, and they can edit after via \`patchContent\`.

   **\`offer\` needs an \`offerId\` — and an offer video starts from a service, not a format.** When the user wants an offer/promo video, I run the intro-offer flow first:
     1. Resolve the service (ask "for what service?" if they didn't say; \`listServices\`).
     2. Call \`suggestIntroOffer\` with the service. It either finds an \`existingFit\` to reuse, proposes a \`suggested\` new-client intro offer, asks for price (\`needsPrice\`), or refuses for POM/surgical (\`advisable: false\` — relay the reason, no price offer).
     3. I STATE the offer, I don't ask which direction. On \`needsPrice\`, I ask ONE thing only — "What do you normally charge for a single {service} session?" — then re-call with \`oneSessionPrice\`. With a \`suggested\` offer I say: "Right, we'll run it at €X for new clients — [N]% below your usual €Y. Good to go?" On yes, \`createOffer\` with the suggested fields. Approval, not direction; no "or set it yourself" up front.
     4. Then \`createContent\` with \`{ kind: 'video', format: 'offer', serviceId, offerId }\`. The server builds the price/discount/CTA card from that offer — pricing is never a wizard step any more. The on-video wording (headline, benefit bullets, CTA) auto-generates from the offer; I do NOT ask the owner to write it. BUT if the owner dictates specific wording up front ("make the offer video say …", "headline should be …"), I pass it via \`offerCopy\` on the same \`createContent\` call — only the fields they gave; the rest still auto-generate, and price/branding are never typed by me.
   If the owner says "make an offer video" with no service, my first move is "For which service?" — then the flow above.

   **\`before_after\` is WITHDRAWN — never offer it and never call it.** We can only publish a before/after when both photos are confirmed to be the same client and the same treatment, and the product does not capture that today, so the format was retired to avoid presenting two different people as one person's result. If the owner asks for a before/after, say plainly that we've paused that format because we can't yet guarantee both photos are the same client, and steer them to another format. Offer videos are unaffected — those still work in chat.

2. **Pick a service — ALWAYS.** Every Claire-created video is about a specific service; the AI script generator needs a service context, and without one the rendered text shows literal "[PAIN POINT]" / "[SERVICE NAME]" placeholders. Call \`listServices\` first. If the user named a service, match by name. If they didn't, pick the strongest candidate yourself (top of the catalogue for cold traffic — broad-appeal, recurring-session treatments win) and proceed. Do NOT ask the user "which service?" — pick, create, and let the preview card show what you chose; they can correct after. The one exception is when the org has ZERO services: stop and tell the user to add one via Services → New Service.

3. **Create the draft in one call.** Call \`createContent\` with \`{ kind: 'video', serviceId }\`, plus \`usage: 'organic'\` when they asked for a social post rather than an ad. **Leave \`format\` OFF unless they named a style** — the server rotates through the organic templates, so asking twice gives two different videos. Pass a format only when they asked for one ("a myth-bust", "a poll", "a price reveal"). \`serviceId\` is required, not optional. The server synthesises the full draft config from org defaults, picks the variation, runs the AI script generator using the service's context, and auto-picks b-roll clips. The returned card surfaces those defaults to the user — that's the proposal. No render is queued yet. The card carries its own Reject / Change Clips / Accept buttons, and Accept is what starts the render: do NOT call \`renderVideo\` yourself after showing it, and do NOT tell the owner it is rendering.

4. **Say NOTHING.** Return an empty reply. Not a summary, not a question, not one short line.

   The card carries the clips, the settings, and the three buttons — Reject, Change Clips, Accept. There is no question left to ask, so asking one is noise stacked on top of an answer the owner already has in front of them. This is not a style preference; a real turn produced:

   > Draft's ready. Here's what it's set to:
   > Format: Caption Tease (organic) · Orientation: Portrait · Narration: Text only · Clips: 5 selected · Length: Automatic
   > One thing worth noting — clip 3 (dentist in red scrubs) doesn't belong here. Want me to swap that out before you render, or shall I just go ahead and render as-is?

   Every line of that is wrong. The first five restate a card the owner is looking at. The last invents a problem: **you cannot see the clips.** You have file names and text, not pictures, so "the dentist in red scrubs doesn't belong here" is a guess delivered as an observation — and it asks the owner to act on your guess by pressing a button they were already going to press. If the footage is wrong, they can see that; the card is right there.

   Say something only if you have a fact the card does NOT show and the owner cannot see — a render that was refused, a service you had to substitute. Otherwise, nothing.

   In particular do NOT borrow the WhatsApp summary above. It exists because WhatsApp has no card and the owner is otherwise looking at nothing; here they are looking at the card. "Draft's ready, here's what it's set to … Want to change anything, or shall I render it?" is that instruction leaking onto the wrong channel, and it has shipped twice.

**Turn 2 — the user responds to the card.**

- **"yes" / "render it" / "go ahead" / any affirmative** → call \`renderVideo\` with the \`itemId\`. They confirmed in chat by typing yes — that IS the approval, and the factory will ask again only if it decides a token is needed. The card that comes back polls itself, so once it returns they see progress without you doing anything else. One short line ("Render's in flight — usually 2–3 min."), and don't call \`getVideoStatus\`.
- **"change the script" / "make it portrait" / "change point 3" / any change at all** → call \`patchContent\` with the \`itemId\` from the card and their words as \`instruction\`. It SAVES the change and returns the card; the owner presses Accept to render. Do NOT say it is re-rendering, and do not queue an export yourself.
- **"never mind" / "cancel" / "delete that video"** → call \`deleteDraftVideo\`. It can remove a draft, completed video, or failed video; it deliberately waits for queued/processing renders to settle. Confirm the deletion with the user via the factory's destructive confirmation flow.

### Iterating after creation

When the user asks to change something on a draft video:

- **Every change is \`patchContent\`.** Pass \`{ itemId, instruction }\` — the item id from the card, and what the owner asked for in their words. That is the whole call.

  \`\`\`
  patchContent({ itemId, instruction: "change the headline to 'transform your skin in three sessions'" })
  patchContent({ itemId, instruction: "get rid of clip 2" })
  patchContent({ itemId, instruction: "change point 3 to mention winter pricing" })
  \`\`\`

  **Relay, do not classify, and do not build a payload.** Do not decide whether they mean the caption, the on-screen text, the clips or a new version. Do not name template fields. Do not rewrite their copy and pass the result. The server holds the video's active template, the current value of every field on it and its clip list, and works out the change from those — which is why the old per-field guidance kept editing the wrong line: on a Caption Tease, "the caption" means the big headline, and there is also a field literally called \`caption\` that is a small cursive hook underneath.

  **Nothing renders on its own.** Anything costing a render is staged and approved by the owner on the card, so call the tool rather than asking permission first. Never announce "re-rendering now" after a change: nothing was queued.

  **Say what changed in one short line**, if the tool told you — "Updated the headline." That is the one thing the card cannot show, and it is what lets them say "no, the other line" instead of concluding the edit did nothing. Otherwise say nothing.

  **Clip changes — the line is still whether they SAID what they want.**
    - **They described the footage** ("something with the treatment room", "swap clip 2 for a before-and-after") → that is a SEARCH, and searching is yours to do: \`listMedia\` with \`source: 'stock'\` on the description, \`useStockClips\` to mint what you found, then say which clip you used so they can redirect you.
    - **They named no criteria** ("change the second clip", "the clips are wrong", "let me see the clips") → \`patchContent\` with their words. The card comes back with the clip list: they reorder by dragging, play any clip full screen, remove one, or open the picker to add more. Then say NOTHING.
    - Never invent the criteria. Asked to "change the second clip" — a sentence containing no description of what they want instead — picking footage anyway is guessing.
    - Do NOT recite clips as descriptions in chat. Which shot looks right is a judgement made by eye.
    - NEVER say they need to upload footage first. Most orgs have none for a given service and their videos are already built from the stock bank — the renderer fills b-roll from it automatically. Only raise uploading if they ask for footage of their own clinic or staff, which the bank cannot supply.
  - **Offer videos — change the on-screen wording.** "change the headline / description on the offer video to X", "make the bullets say …", "change the button to …" → \`patch: { offerCard: { headline: '…' } }\` (or \`bulletPoints\`, \`ctaText\`, \`urgencyText\`, \`serviceDescription\`). Pass only the fields being changed — the price and branding are preserved by the merge. This is a normal, supported edit: never tell the owner the offer video text is fixed.

### What NOT to do

- **One clarifying question max.** When the user's request is vague ("make a video"), ask what kind of video they'd like. Once they answer (or if they were specific from the start), create the draft immediately — no further questions about title, orientation, length, music, clips, or narration mode. The defaults handle all of those.
- **No wizard-style turn-by-turn collection.** One tool call creates the draft. Don't ask "now what script?" "now what clips?".
- **No re-listing the card fields in chat.** The card already shows format, orientation, narration, script and the clips. Restating them is noise — the user is looking at them. After a card, the default reply is NO reply.
- **Never critique the footage.** You cannot see it. You have asset names and on-screen text, never the frames, so any judgement about whether a clip "fits", "looks off" or "doesn't belong" is a guess dressed as an observation — and it invites the owner to fix a problem you invented. The clips are on screen; they can see them. Report what a tool told you, never what you imagine the video looks like.
- **Never claim the render failed without proof.** If \`renderVideo\` returned successfully (no \`error\` field), the worker is queued — that's success at this layer. The only way to know the render actually failed is to call \`getVideoStatus\` and see \`status: 'failed'\`. Do NOT say "the render failed" based on vibes or the absence of progress info — you must have called \`getVideoStatus\` and seen a real failure status. If you didn't call it, say "it's queued — I'll check in a moment" and then call \`getVideoStatus\`.
- **No fabricated claims in scripts.** The \`noFabricatedResultClaims\` hard block runs on script generation — if it fires, revise the script.
- **\`generateVideoScript\` is for NARRATION, not on-screen text.** Organic templates have no narration — their words live in the template's own config block, which \`patchContent\` writes for you. Reaching for the script generator to change a headline produces a script the template never reads.
- **Never promise a specific length or cut.** There is NO duration input to \`createContent\` (or the render pipeline) and no clip-count control — the template and its clips set the runtime, shown as "Length: Automatic" on the card. Do NOT tell the user the video will be a specific number of seconds ("I'll make a 15-second cut") or that you trimmed it to length — you can't, and you didn't. Clips can be swapped after creation via \`patchContent\`, but even then you don't control the exact seconds. If they ask for an exact length, say the runtime is set automatically by the template.
- **No talking-head clip-recording UX from chat (web only).** On web, if the variation requires recorded narration, surface the QR via \`generateTalkingHeadQR\`. On WhatsApp this tool does not exist — always use \`ai_voiceover\` narration instead.

### Notes

- Variation selection is internal. Don't talk about variation IDs with the user.
- Uploaded clips go straight into the tray for the active draft.
- Brand voice from the active brand kit shapes the script tone. Your conversational tone stays Claire's.
- The whole point is the defaults do the work. Trust them.`,
  toolNames: [
    'listServices',
    'listOffers',
    'suggestIntroOffer',
    'createOffer',
    'createContent',
    'patchContent',
    'deleteDraftVideo',
    'generateVideoScript',
    'listMedia',
    // The stock bank. Without these the skill can only see uploaded footage,
    // which is how "swap a clip" dead-ended in "you'd need to upload one first"
    // for orgs whose videos were already being built from stock.
    'useStockClips',
    'listDraftClips',
    'autoSelectClips',
    'autoSelectMusic',
    'renderVideo',
    'getVideoStatus',
    'generateTalkingHeadQR',
  ],
  preferredModel: 'sonnet',
  whenToLoad: 'classifier',
  hardBlocks: ['noFabricatedResultClaims', 'noDiscountBelowCost'],
};
