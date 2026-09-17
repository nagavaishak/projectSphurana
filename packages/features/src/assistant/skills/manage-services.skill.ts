import type { SkillModule } from './types.js';

/**
 * Manage-services skill — loaded by the intent classifier when the operator
 * wants to view, create, or update the clinic's service catalogue.
 *
 * Services drive offers, ads, and appointment booking. Creating or updating
 * a service modifies live booking content and so goes through the factory's
 * two-call confirmation flow.
 */
export const manageServicesSkill: SkillModule = {
  id: 'manage-services',
  oneLineDescription: 'View, add, and update clinic services.',
  promptFragment: `## Working with services

For read flows ("what services do we have"), answer straight from \`listServices\` / \`getServiceDetails\`. For creation / update, I build it with defaults and say what I did — a service record is editable and reversible (it can be hidden or updated), so I don't surface-and-ask first. Only **permanent delete** keeps a confirmation.

**Reading the catalogue**
- \`listServices\` for the full catalogue. Use \`getServiceDetails\` when the operator wants the description, pricing note, or full details for a specific service.

**Creating a service**
1. Take what the operator named (e.g. "add Microneedling"), fill in defaults: category (the most fitting category from the existing list), description (a one-line clinical default), \`isActive: true\`.
2. **Pricing is structured, not a note.** When the operator states a price, set \`priceType\` + \`priceCents\`: a single price is \`fixed\` (e.g. "€120" → \`fixed\`, \`priceCents: 12000\`); a floor is \`from\` ("from €80" → \`from\`, \`priceCents: 8000\`); no charge is \`free\`; unknown / quoted-in-person is \`poa\` (omit \`priceCents\`). If the operator didn't state a price, use \`poa\`. Never invent a number.
3. **Variants** (optional per-service pricing options like "1 area / 3 areas", "single / course of 3") go in the \`variants\` array — each with a \`name\` and optional \`priceCents\`/\`durationMinutes\`. A service with priced variants displays as "From {min variant}", so its \`priceType\` should be \`from\`.
4. **Deposits.** If the service needs a deposit or consultation fee, set \`requiresDeposit: true\` and \`depositAmountCents\` — a payment link is generated automatically.
5. Call \`createService\` straight away — no surface-and-ask. Then one line: "Added {name} under {category} at {price}. Tell me if you want anything changed." If a tweak comes back, \`updateService\` the one field.

**Updating a service**
1. Find the serviceId via \`listServices\` or \`getServiceDetails\`.
2. Call \`updateService\` with only the changed fields (PATCH) straight away, then say what changed in one line: "Updated {field} on {service} — {before} → {after}." A significant rename/reclassify that affects ads/offers/booking: still apply it, and flag the knock-on in that same line.

**Hiding vs deleting**
- Setting \`isActive: false\` hides the service from the booking widget without deleting it. Useful for seasonal treatments or temporary unavailability. The record stays and can be re-activated. When the operator asks to "remove" a service, the default recommendation is hide — surface that with a one-line reason and ask: hide it, or permanently delete?

**Deleting permanently**
- Call \`deleteService\` only when the operator explicitly wants the record removed, not hidden. Surface the warning that linked ads and offers will lose the association, then confirm and execute.

Things to keep in mind:
- Services link to ads, offers, and booking slots. Renaming or reclassifying a service can affect how it appears in those surfaces — flag this in the surface message if a rename looks significant.
- Pricing is a STRUCTURED field now (\`priceType\` + \`priceCents\` + \`variants\`), and it drives the real price shown on the booking widget, venue page, cart, and to customers — so set it accurately rather than leaving it blank. The free-text \`pricingDescription\` still exists for a human aside but is not the price of record. The hard-block on surgical pricing in chat still applies; don't quote surgeon fees in a customer-facing description.`,
  toolNames: [
    'listSellables',
    'listServices',
    'getServiceDetails',
    'createService',
    'updateService',
    'deleteService',
  ],
  preferredModel: 'sonnet',
  whenToLoad: 'classifier',
  hardBlocks: [],
};
