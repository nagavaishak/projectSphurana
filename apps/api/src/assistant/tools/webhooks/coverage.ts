import { defineCoverage } from '../coverage.types.js';

/**
 * WEBHOOKS — 14 endpoints, 0 tools. The cleanest "not a capability" area on
 * the surface, and worth stating precisely rather than waving at.
 *
 * Every route here has exactly ONE legitimate caller, and it is a third-party
 * platform. Two mechanisms enforce that, and both make an agent caller a
 * contradiction rather than a policy question:
 *
 *   - The three GETs are subscription HANDSHAKES. Meta and WhatsApp call them
 *     once with a `hub.challenge` and a verify token, and the correct response
 *     is to echo the challenge back as a bare string. They answer the
 *     platform, not a user, and they carry no information.
 *   - The eleven POSTs are DELIVERIES, authenticated by a signature over the
 *     exact raw request body (X-Hub-Signature for Meta and WhatsApp,
 *     Stripe-Signature for both Stripe surfaces, Svix headers for Resend, and
 *     Telnyx's Ed25519 header for voice). A payload Claire composed would fail
 *     that check; one that passed would mean the signing secret had leaked,
 *     at which point the webhook is the least of the problems.
 *
 * The real risk they guard is FABRICATED EVIDENCE. These handlers are how the
 * system learns that money moved, that a lead arrived, that a customer wrote
 * in. An agent able to originate them could manufacture business facts, and
 * every downstream number would inherit the fiction.
 */
export const webhooksCoverage = defineCoverage('webhooks', {
  // ---- subscription handshakes ------------------------------------------
  'GET /webhooks/meta/leadgen': {
    notExposed:
      'Meta’s one-time verification for the leadgen subscription — echoes hub.challenge when the token matches. It returns a bare string to Meta and tells a user nothing.',
  },
  'GET /webhooks/meta/messaging': {
    notExposed:
      'The same hub.challenge handshake for the Messenger and Instagram messaging subscription. Called once at registration, by Meta.',
  },
  'GET /webhooks/whatsapp': {
    notExposed:
      'WhatsApp Business subscription verification handshake. Identical mechanics; the only caller that can satisfy it is Meta’s webhook registrar.',
  },

  // ---- signed deliveries: leads and conversations ------------------------
  'POST /webhooks/meta/leadgen': {
    notExposed:
      'Signed Meta delivery announcing a new lead-form submission; the handler fetches the answers and creates the lead. If Claire could originate these, she could invent leads that no customer ever submitted.',
  },
  'POST /webhooks/meta/messaging': {
    notExposed:
      'Signed delivery of an inbound Messenger or Instagram message, which drives the chatbot pipeline. Fabricating one would put words in a customer’s mouth and a reply in their inbox.',
  },
  'POST /webhooks/whatsapp': {
    notExposed:
      'Signed WhatsApp delivery carrying both inbound messages and delivery-status callbacks. The status half is what campaign reporting counts as delivered, so forged events would corrupt send metrics.',
  },
  'POST /webhooks/twilio/sms': {
    notExposed:
      'Twilio’s inbound SMS callback, validated against the request signature. It is how a customer’s text becomes a conversation — an origin point, not an action.',
  },
  'POST /webhooks/twilio/status': {
    notExposed:
      'Twilio’s signed message-status callback (delivered, undelivered, failed). It is what campaign reporting counts as delivered, so forged events would corrupt send metrics and hide carrier rejections.',
  },
  'POST /webhooks/resend': {
    notExposed:
      'Svix-signed Resend delivery events (delivered, bounced, complained). Bounce and complaint handling is what keeps the sending domain reputable; injected events would suppress real addresses.',
  },

  // ---- signed deliveries: money -----------------------------------------
  'POST /webhooks/billing': {
    notExposed:
      'Stripe platform-billing events, verified against Stripe-Signature. Subscription state and entitlements are written from here, so a forged event grants paid capacity with no payment behind it.',
  },
  'POST /webhooks/stripe-connect': {
    notExposed:
      'Connected-account events (account.updated, payment settlement) on the separately scoped Connect destination. This is the only source of truth for whether an org can take money; nothing else may write it.',
  },

  // ---- signed deliveries: calendar and voice -----------------------------
  'POST /webhooks/google-calendar': {
    notExposed:
      'Google push notification for a watched calendar. It carries a channel id and resource state rather than data, and the handler responds by pulling the changed events itself.',
  },
  'POST /webhooks/voice/telnyx': {
    notExposed:
      'Telnyx call-lifecycle events for the voice agent, verified with the provider’s Ed25519 signature over the raw body. Claire has no part in a live phone call.',
  },
  'POST /webhooks/voice/telnyx/tools': {
    notExposed:
      'The mid-call tool callback the voice agent uses to look up and book. It is another agent’s tool surface; Claire reaches the same operations through the appointments area, and two agents writing one booking is how doubles happen.',
  },
  'POST /webhooks/meta/data-deletion': {
    notExposed:
      'Meta’s data-deletion callback, a compliance obligation with a required signed-request format and a confirmation-code response. Erasure must be provably initiated by the platform on the user’s behalf, never by an agent.',
  },
});
