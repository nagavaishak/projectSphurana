import { defineCoverage } from '../coverage.types.js';

/**
 * CAMPAIGNS — 25 endpoints, 9 tools. Bulk email / SMS / WhatsApp sends to the
 * org's own lead list. The area where the coverage decision is dominated by one
 * fact: a launch is IRREVERSIBLE and metered. Once the batch is handed to
 * Resend or Twilio, nothing here un-sends it, and the org pays per recipient.
 *
 * So the shape is: Claire may compose freely — create a draft, define a
 * segment, preview the audience, set the message body, check which channels the
 * org is actually entitled to — and exactly one tool crosses the line into
 * spending, `campaigns_launch`, which is `destructive: true` and asks first.
 *
 * The endpoints left out cluster into two groups. Provisioning (buying an SMS
 * number, searching available numbers) is a purchase with a recurring bill and
 * a regulatory footprint. Post-send administration (cancel, resume, delete,
 * recipient lists, per-recipient analytics) is either PII-heavy or an operation
 * on a send already in flight, where a model's mental model of "current state"
 * is a guess against a queue that moves faster than the conversation.
 */
export const campaignsCoverage = defineCoverage('campaigns', {
  // ---- reads: composition ------------------------------------------------
  'GET /campaigns': { exposed: 'campaigns_list' },
  'GET /campaigns/:id': { exposed: 'campaigns_showCampaignPreview' },
  'GET /campaigns/entitlements': { exposed: 'campaigns_checkChannels' },
  'GET /campaigns/sms-number': { exposed: 'campaigns_checkChannels' },
  'GET /campaigns/whatsapp-templates': {
    exposed: 'campaigns_listWhatsappTemplates',
  },
  'GET /campaigns/segments': { exposed: 'campaigns_segments_list' },
  'GET /campaigns/segments/:id': { exposed: 'campaigns_previewAudience' },

  'GET /campaigns/:id/analytics': {
    undecided: 'ENG-CLAIRE-CAMPAIGNS',
  },
  'GET /campaigns/:id/recipients': {
    notExposed:
      'The full per-recipient delivery ledger — name, email, phone, and per-message bounce/complaint state for every lead in the send. Thousands of rows of contact PII that would swamp the context window to answer a question campaign analytics answers in one line.',
  },
  'GET /campaigns/suppressions': {
    notExposed:
      'The unsubscribe and hard-bounce list: contact details of people who asked not to be contacted. Reading it into a conversation is exactly the wrong direction for a consent record, and Claire never needs it — the send path already honours it server-side.',
  },
  'GET /campaigns/sms-number/available': {
    notExposed:
      'Searches the Twilio inventory for purchasable phone numbers. Only meaningful as the first half of a purchase Claire is not allowed to make, and the results are a volatile inventory listing that is stale by the time she quotes it.',
  },

  // ---- writes: composition (cheap, reversible, sends nothing) ------------
  'POST /campaigns': { exposed: 'campaigns_create', confirm: false },
  'POST /campaigns/:id/messages': {
    exposed: 'campaigns_setMessage',
    confirm: false,
  },
  'POST /campaigns/segments': {
    exposed: 'campaigns_createSegment',
    confirm: false,
  },
  'POST /campaigns/segments/preview': {
    exposed: 'campaigns_previewAudience',
    confirm: false,
  },
  'POST /campaigns/segments/sample-recipients': {
    notExposed:
      'A read-shaped POST returning a few sample lead rows to drive the composer’s live mail-merge preview. Pure UI plumbing — Claire answers audience questions with previewAudience counts — and it carries per-recipient contact PII that should not flow into a conversation.',
  },
  'POST /campaigns/whatsapp-templates/ensure': {
    notExposed:
      'Idempotent first-run provisioning that registers the canonical bulk-message template on the org’s WABA when the composer first opens WhatsApp. A one-time setup step the UI performs, not something Claire composes — she uses the already-approved template via campaigns_listWhatsappTemplates + campaigns_setMessage.',
  },

  // ---- writes: spending --------------------------------------------------
  'POST /campaigns/:id/launch': { exposed: 'campaigns_launch', confirm: true },

  // ---- writes: withheld --------------------------------------------------
  'PUT /campaigns/:id': {
    undecided: 'ENG-CLAIRE-CAMPAIGNS',
  },
  'DELETE /campaigns/:id': {
    notExposed:
      "Destroys the campaign along with its send history and delivery receipts, which are the org's record of what was sent to whom. Recoverable only from a backup, so it stays a deliberate click in the UI.",
  },
  'POST /campaigns/:id/cancel': {
    notExposed:
      'Halts a send already in flight. The outcome depends on how far the queue has drained in the seconds since Claire last read status, so she would be reporting a partial result she cannot actually know — and a wrongly cancelled campaign cannot be resumed into the same batch.',
  },
  'POST /campaigns/:id/resume': {
    notExposed:
      'Restarts a paused send. Same in-flight-state problem as cancel, with the added risk that a resume against a stale view double-sends to the recipients already processed.',
  },
  'PUT /campaigns/segments/:id': {
    notExposed:
      'Editing a segment silently changes the audience of every draft campaign pointing at it. Claire builds a fresh segment per campaign via campaigns_createSegment, which makes the blast radius of a mistake exactly one campaign.',
  },
  'DELETE /campaigns/segments/:id': {
    notExposed:
      'Deleting a segment orphans the campaigns referencing it, and segments are cheap enough that an unused one costs nothing. There is no owner problem that deletion solves and re-creating one does not.',
  },
  'POST /campaigns/sms-number': {
    notExposed:
      "Purchases a Twilio phone number: a recurring charge plus a sender-registration obligation in most jurisdictions. Provisioning telecom identity on the org's behalf is not a decision to reach by conversation.",
  },
  'POST /campaigns/draft-content': {
    notExposed:
      "The UI's own copy-generation helper — it asks an LLM for campaign body text. Claire IS the LLM; routing her through a second model to write a sentence adds a hop, a cost, and a second voice to reconcile.",
  },
  'POST /campaigns/draft-content/stream': {
    notExposed:
      'The SSE-streaming variant of draft-content, built so the composer can type into a textarea live. A token stream is not something a tool call can consume, and the non-streaming twin is already declined for the same reason.',
  },
});
