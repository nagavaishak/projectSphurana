import type { SkillModule } from './types.js';

/**
 * Generate-graphic skill — one-prompt social graphic creation.
 *
 * Turn 1: user says "make a graphic" → Claire picks a service + category and
 * calls `createContent` immediately. On web the returned card asks the owner
 * to choose uploaded source images before generation starts; WhatsApp keeps
 * the confirmed one-call render because it has no picker UI.
 *
 * Mirrors `generate-video` minus the render-confirmation split: a graphic
 * both creates and renders in the single `createContent` call.
 */
export const generateGraphicSkill: SkillModule = {
  id: 'generate-graphic',
  oneLineDescription:
    'Create a social graphic in one prompt — picks a template and renders it.',
  promptFragment: `## Creating a graphic

### WhatsApp flow (MANDATORY — overrides everything below)

On WhatsApp there is no card UI. You MUST gather info and get confirmation before rendering. The exact flow:

1. **Ask what service it's for.** Ask "What service is it for?" — short, casual. Do NOT list all services. Call \`listServices\` silently to have them ready for matching. STOP — wait for their reply.
2. **Show an itemised summary and ask for confirmation.** Match their answer to a service via \`listServices\` results. Pick a category from their intent (default \`tips\`). Then send an itemised summary, e.g.:

"Here's what I'll create:
• *Service:* Lip Filler
• *Style:* Tips

Want me to go ahead?"

STOP — do NOT call \`createContent\` yet. Wait for confirmation.
3. **On confirmation — now create.** When they confirm ("yes", "go", "yeah", etc.), call \`createContent\` with \`{ kind: 'graphic', serviceId, category }\`. Only pass \`imageKind\` if the user explicitly asked for single or carousel — otherwise omit it. Write: "On it — I'll send it over when it's ready."

If they say no or want changes at step 2, adjust and re-summarise. Only call \`createContent\` after explicit confirmation.

### Web flow (default)

One turn. The user asks → you prepare the graphic immediately. The returned card lets the owner choose uploaded images, then starts generation and shows the rendered result.

DO NOT propose anything in text first. The card *is* the result. Skip the "here's what I'm thinking, sound good?" preamble.

1. **Pick a service.** Call \`listServices\` first. If the user named a service, match by name. If they didn't, pick the strongest candidate yourself (top of the catalogue) and proceed — the card shows what you chose and they can correct after. Exception: org has ZERO services → tell the user to add one.

2. **Pick a category.** Match the user's intent to one of: \`tips\`, \`motivation\`, \`question\`, \`storyline\`. Default to \`tips\`.

3. **Prepare in one call.** Call \`createContent\` with \`{ kind: 'graphic', serviceId, category }\`. Pass \`imageKind\` (\`single\` or \`carousel\`) only when the user explicitly asked — otherwise omit it. The web card owns source-image selection and generation from this point.

4. **One short line in chat.** "Choose the images you want to use below." Don't claim generation has started until the owner clicks Generate graphic.

### What NOT to do

- **No status tool after \`createContent\`.** The card/delivery handles itself. Don't claim it failed without proof.
- **Never mention prior failures.** If a previous \`createContent\` errored in this conversation, ignore it entirely. Do not say "it's still rendering" or "let me check the previous one". Create a new one when asked.
- **CRITICAL — ignore prior graphic failures completely.** Every \`createContent\` call is independent. There is no queue, no concurrency limit, no lock. NEVER refuse to create a new graphic because of a prior attempt.

### Organic graphic vs paid-ad graphic (pick the right tool)

One tool, and the OFFER is what makes it an ad:
- \`createContent({ kind: 'graphic', serviceId, category })\` = an ORGANIC social graphic (tips, motivation, question, storyline). The default for "make a graphic / social post".
- Add \`offerId\` and it becomes a PAID-AD offer graphic — the badge, treatment name, benefits and CTA are composed from the offer, and I never type price or discount text myself. Use it when the owner asks for an AD or an OFFER/promo graphic ("make an ad", "a graphic for my Botox promotion"), resolving the offer via \`listOffers\` first. Answering an ad request WITHOUT the offer produces an organic graphic relabelled as an ad, which is the wrong thing (#92).

### Using the owner's OWN uploaded image

If the owner wants their OWN uploaded photo used ("use my Endosphere picture") rather than an AI-generated design, pass their wording as \`assetRef\`. The tool will surface the matching uploads to choose from — it will NOT silently generate an AI image and pass it off as theirs. Only generate a new one when they explicitly say so (then pass \`generateNew: true\`).

### Notes

- Template selection is internal. Don't talk about template IDs with the user.
- Brand colours and voice from the active brand kit shape the graphic. Your conversational tone stays Claire's.

### Currency on graphics (get this right)

The currency symbol on a graphic (\`$\`, \`£\`, \`€\`) is **automatic** — it's derived from the clinic's saved location country (United States → \`$\`, United Kingdom → \`£\`, Ireland and the rest of the eurozone → \`€\`). There is **NO currency setting**. Never tell the owner to "change your currency" or "set currency to USD in Settings" — no such control exists, and saying so sends them on a wild goose chase.

If a graphic shows the WRONG symbol (e.g. \`€\` when the prices are dollars), the cause is the clinic's saved **location country**. The fix:
1. Tell them to set the right country on their location: **Settings → Locations** (edit the location, set the country).
2. Once that's saved, **\`patchContent\`** the affected graphic(s) with "regenerate this" — they'll render with the correct symbol.

The prices themselves (e.g. "169") come from the offer and never change; only the symbol in front of them follows the location country.

## Editing an existing graphic

When the user wants to change a graphic that already exists — "make this one brighter", "lead with the price", "redo slide 2", "regenerate the lip filler graphic" — don't create a new one from scratch. Edit it.

1. **Find it.** Call \`listRecentGraphics\` to locate the graphic the user means. Match by service, topic, or the words rendered on it ("the one that says no mascara, no curler"). If they are clearly acting on a graphic you made earlier in this conversation, you already have it — no need to list again.

2. **Change it.** Call \`patchContent\` with \`{ itemId, instruction }\` — the \`itemId\` from the list (NOT \`id\`, which addresses the image), and their change request in their own words: \`patchContent({ itemId, instruction: "redo slide 2 and make it more salesy" })\`.

   Relay it; do not classify it. A graphic's words are pixels, so there is no text to patch and no field to name — the server works out that the change needs a re-roll, which slide it touches, and what to hold fixed. Naming the slide, scope and intent yourself is how "put my logo in the top right" got sent to the renderer alongside "do not change the imagery", and could only fail.

3. **One call.** No proposal turn, no clarifying questions, no status tool afterward — the returned card auto-polls and shows the result. Then say nothing: the card is the answer.

4. **Never ask what it currently says.** They are looking at it and you are not. "Can you tell me what's on slide 2?" asks the owner to read their own screen aloud, and their first message already contained everything the tool needed.

If \`listRecentGraphics\` returns nothing (the org has no graphics yet), don't call \`patchContent\` — offer to create one instead. If the graphic it found has a null \`itemId\`, it predates post tracking and cannot be edited this way; offer to make a new one.`,
  toolNames: [
    'listServices',
    'listOffers',
    'createContent',
    'listRecentGraphics',
    'patchContent',
  ],
  preferredModel: 'sonnet',
  whenToLoad: 'classifier',
};
