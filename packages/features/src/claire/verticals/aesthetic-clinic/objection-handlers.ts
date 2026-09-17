import type { ObjectionHandler } from '../types.js';

export const aestheticClinicObjectionHandlers: Record<
  string,
  ObjectionHandler
> = {
  too_cheap: {
    id: 'too_cheap',
    trigger: 'Owner says intro pricing devalues their brand.',
    response:
      "This isn't your price — it's what it costs to add a lifelong client to your base. " +
      'Your regular price stays the same. This is a first-visit offer only. Think of it as ' +
      'your customer acquisition cost. The goal is that the customer pays for their own ' +
      'acquisition, and every rebooking after that is pure profit on the marketing cost.',
    appliesTo: { strategies: ['price_visible_intro'] },
  },
  want_to_advertise_premium: {
    id: 'want_to_advertise_premium',
    trigger:
      'Owner wants to advertise a premium upgrade (filler, polynucleotides) instead of the recommended trust-builder.',
    response:
      'Lip filler brings people back once a year. Microneedling brings them back every month ' +
      "for 5 months. Once they trust you with their skin, they'll book lips themselves. " +
      "Let's build the base first.",
    appliesTo: { strategies: ['price_visible_intro'] },
  },
  want_to_promote_everything: {
    id: 'want_to_promote_everything',
    trigger: 'Owner asks to advertise multiple services at once.',
    response:
      "Spreading budget across 5 treatments means none of them exit Meta's learning phase. " +
      'The clients we bring in for one service will see everything else you offer when they ' +
      "walk through your door. Your job is to look after them — they'll come back for the rest.",
  },
  surgical_price_demand: {
    id: 'surgical_price_demand',
    trigger:
      'In conversation, a lead asks about pricing for a surgical clinic.',
    response:
      'Pricing depends on the area and your goals — the best next step is a consultation with ' +
      '{{practitionerName}} so they can give you an accurate quote.',
    appliesTo: { strategies: ['consultation_led'] },
  },
  body_contouring_word_of_mouth: {
    id: 'body_contouring_word_of_mouth',
    trigger: 'Owner expects body-contouring clients to bring referrals.',
    response:
      "Body contouring is sensitive — people don't tell their friends they got fat dissolving. " +
      'Organic referrals will be weaker than skin or injectables, which is normal. Your growth ' +
      'comes from paid acquisition + upsells to higher-value treatments, not word-of-mouth.',
  },
  hold_off_advertising: {
    id: 'hold_off_advertising',
    trigger:
      'Owner asks why Claire is telling them not to run cold-traffic ads.',
    response:
      "Cold-traffic ads work when there's a low-priced entry treatment that opens future bookings. " +
      "If everything you offer is above market and there's no cheaper trust-builder, the maths on " +
      'a first-visit ad rarely works. Retargeting recent visitors and warm audiences gets you ' +
      "better return until pricing or service mix changes. Let's set that up instead.",
    appliesTo: { strategies: ['do_not_advertise'] },
  },
};
