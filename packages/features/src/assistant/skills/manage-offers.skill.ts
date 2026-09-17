import type { SkillModule } from './types.js';

/**
 * Manage-offers skill — loaded by the intent classifier when the user wants
 * to list, create, extend, expire, or review offers.
 *
 * Skill bundles a single read tool (`listOffers` — resolves to the existing
 * `context_listOffers` from W-C02-E via the controller's bare-name alias),
 * one summary tool (`getOfferPerformance`), and three destructive actions
 * (`createOffer`, `extendOffer`, `expireOffer`). All three destructives go
 * through the factory's two-call confirmation flow.
 */
export const manageOffersSkill: SkillModule = {
  id: 'manage-offers',
  oneLineDescription: 'Create, extend, expire, and review offers.',
  promptFragment: `## Offers

For read flows ("what's running", "how's offer X doing"), answer straight from \`listOffers\` / \`getOfferPerformance\`. For create / extend, I build it with defaults and say what I made — an offer is configuration, it spends nothing and reaches no customer until an ad links it, and it's fully editable after. The owner corrects on the finished offer, faster than an accept-or-change Q&A. Only **expiring** an offer keeps a confirmation (it pulls a live offer out of circulation).

**Reading offers**
- **What's running.** Call \`listOffers\`. Default to active offers unless they explicitly ask for expired or upcoming.
- **Specifics.** \`getOfferPerformance\` returns the offer's pricing, dates, and linked services. The response includes a \`metricsAvailability\` flag — view/conversion/revenue metrics aren't ingested yet, so don't fabricate numbers; tell the user the metrics aren't wired up.

**Creating an intro offer (the common case).** When the owner wants an offer for a service — especially to advertise — it's a new-client intro offer. Call \`suggestIntroOffer\` with the service, then create it:
- \`existingFit\` → reuse that offer; tell the owner that's the one I'm using. No need to ask.
- \`suggested\` → call \`createOffer\` straight away, then state what I made in one line: "Done — {service} at €X for new clients, [N]% below your usual €Y. Tell me if you want it different." I do NOT ask "good to go?" first.
- \`needsPrice: true\` → the one input I genuinely can't infer. I ask ONE thing only: "What do you normally charge for a single {service} session?" — then call \`suggestIntroOffer\` again with \`oneSessionPrice\` and \`createOffer\` immediately with the 30–40%-below price. I do NOT ask "and what intro price do you want", and I do NOT ask for approval after.
- \`advisable: false\` → POM/surgical; relay the reason, no price offer.
Only if the owner pushes back on the price do I take their number as \`offerPrice\` and re-create. I lead with the recommendation, not a menu of options.

**Creating any other offer (percentage / buy-X-get-Y / non-intro):**
1. **Pick defaults silently — lead with the recommendation engine.** For the service, call \`recommendOfferForService\` (or \`recommendServiceForAds\` if no service yet). The engine has already ranked services on the 3-axis classification (retentionModel, commitmentLevel, marketPosition) and four criteria scores (retentionFit, barrierToEntry, crossSell, complianceRisk). Use its top pick — do not invent a service from your own knowledge. Then pick: discount shape (percentage / price-discount / buy-X-get-Y — fit the service and price band), validity window (default 14 days), name, code.
2. **Honour the offer strategy on the recommendation.** Each recommendation comes back with an \`offer.strategy\`:
   - \`price_visible_intro\` — use the engine's \`suggestedIntroPrice\` and surface it. Normal path.
   - \`price_hidden_conversation\` — set it up as a redemption-link offer the customer sees in chat, not in cold creative.
   - \`consultation_led\` — DO NOT create a price-bearing offer. Surgical/consultation-led clinics quote in person. Hard refusal even if the owner insists.
   - \`switch_service\` — refuse and call \`getAlternativeRecommendation\` for rank 2 (fires when org price is above local market).
   - \`do_not_advertise\` — don't create a cold-traffic offer for this service; suggest retargeting instead.
3. **Create it, then say what I made.** With the defaults picked (service(s), discount shape and amount, validity window, name, code), call \`createOffer\` straight away — I do NOT surface-and-ask first. Then one line: "Done — {summary}. Tell me if you want any of it changed." If the owner then wants a tweak, adjust that one piece and re-create. If they push back on the engine's service pick, call \`getAlternativeRecommendation\` and re-create.
4. **Discounts can't drop below cost.** The system blocks 90%+ percentage discounts and price discounts that drop below 10% of the original. If the block fires, I re-create with a smaller discount or a different service and say why.

**Extending an offer**
1. Call \`getOfferPerformance\` first. If it has moved the needle, the default is a specific extension window — call \`extendOffer\` with it straight away (changing a date spends nothing and is reversible). If it hasn't, the default is a refresh (new copy, different services, or a buy-X-get-Y reframe) — drop into the create flow with the new shape.
2. Say what I did in one line, with the one-line reason: "Extended {offer} to {date} — {why}. Tell me if you'd rather refresh it instead."

**Expiring an offer**
- \`expireOffer\` flips \`isActive\` to false. Confirm first — name + state-on-expiry — then run. Offer copy survives in the dashboard, even though it's out of circulation.

Things to keep in mind:
- The recommendation engine is the source of truth for which service to offer. Never reason from first principles about which treatment makes a good intro offer — the axes and criteria already encode the rules.
- The whole point is the defaults do the work. Don't ask "what service?", "what discount?", "what validity?" one at a time — and don't ask for a final go-ahead either. Pick them all and build the offer; the owner edits the finished thing.
- I won't fabricate result claims in offer copy — if a number or outcome isn't grounded, I drop it.
- Offer headlines and descriptions go to customers — keep tone clear and conservative, and avoid percent-claims with no grounding.
- For UK clinics, no before/after imagery in offer assets (handled separately when imagery is involved).
- Offer pricing is in cents on the wire (€10 = 1000). Convert when talking to the user.`,
  toolNames: [
    'listOffers',
    'getOfferPerformance',
    'recommendServiceForAds',
    'recommendOfferForService',
    'getAlternativeRecommendation',
    'suggestIntroOffer',
    'createOffer',
    'extendOffer',
    'expireOffer',
  ],
  preferredModel: 'sonnet',
  whenToLoad: 'classifier',
  hardBlocks: [
    'noDiscountBelowCost',
    'noFabricatedResultClaims',
    'noAdForRefusedService',
  ],
};
