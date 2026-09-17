import { defineCoverage } from '../coverage.types.js';

/**
 * TESTING — 40 endpoints, 0 tools, and the one area where a blanket withhold
 * is the correct answer rather than a lazy one.
 *
 * Every route here exists to let the E2E suite reach a state the product will
 * not let a real user reach: mint a verification token without an inbox, force
 * an organization past review, fabricate a subscription, deliver a webhook
 * nobody sent. The whole controller is guarded on `NODE_ENV !== 'production'`
 * and is absent from the production surface — so an `exposed` here would name
 * a capability that does not exist where Claire actually runs.
 *
 * The reasons below are still individual, because the FAILURE MODES differ and
 * that is the interesting part: some of these would forge credentials, some
 * would destroy other suites' data, and some would make Claire fabricate
 * evidence of work she never did. That last class is the dangerous one — a
 * simulate-* route lets an agent produce a convincing artefact of a message
 * that was never sent.
 */
export const testingCoverage = defineCoverage('testing', {
  // ---- credential and identity forgery ----------------------------------
  'GET /testing/verification-token': {
    notExposed:
      'Hands back the email-verification token for any address without proving control of the inbox. That is account takeover with extra steps; it exists only because the suite has no mailbox.',
  },
  'GET /testing/reset-password-token': {
    notExposed:
      'Same shape as the verification token, for password reset. Reading it for an arbitrary email is exactly the attack the reset flow is designed to prevent.',
  },
  'POST /testing/create-session': {
    notExposed:
      'Mints a signed session cookie for an arbitrary user, bypassing sign-in entirely. There is no legitimate agent use for a credential factory.',
  },
  'POST /testing/force-verify': {
    notExposed:
      'Marks a user verified without them ever seeing the email. Verification is the only proof we hold that an address belongs to the person claiming it.',
  },
  'POST /testing/force-verify-org': {
    notExposed:
      'Skips organization review, which is the manual check standing between a signup and the ability to advertise and message the public under a business name.',
  },
  'POST /testing/manage-booking-link': {
    notExposed:
      'Issues a signed manage-booking token for someone else’s appointment. That token is the only thing authorising a cancel or reschedule from the public site.',
  },

  'POST /testing/patient-otp': {
    notExposed:
      'Mints a live patient-portal sign-in OTP (E2E helper). A sign-in credential for someone else’s account — never an assistant capability.',
  },

  // ---- state fabrication -------------------------------------------------
  'POST /testing/force-subscription': {
    notExposed:
      'Writes a paid subscription row with no payment behind it. Entitlements gate real spend on ads and messaging, so a fabricated plan hands out chargeable capacity for free.',
  },
  'POST /testing/create-org': {
    notExposed:
      'Creates an organization outside signup and onboarding, skipping the currency, country and Stripe-customer setup those flows perform. The result is an org that looks real and bills wrongly.',
  },
  'POST /testing/provision-org': {
    notExposed:
      'The heavyweight suite fixture — creates an org plus users, services, shifts and integrations in one call. Nothing in a conversation should be able to conjure a whole business.',
  },
  'POST /testing/seed-platform-admin': {
    notExposed:
      'Mints a platform administrator with a known password and hands back its TOTP secret in plaintext. That is total control of every organization on the estate, and the second factor along with it — the one endpoint in this file that must never be reachable from a conversation.',
  },
  'POST /testing/seed': {
    notExposed:
      'Bulk-inserts fixture rows across many tables. Seeded records are indistinguishable from real ones once written, which is how a suite fixture becomes a customer’s data.',
  },
  'POST /testing/seed-appointment': {
    notExposed:
      'Inserts an appointment bypassing availability, overlap and deposit rules. Claire has appointments_bookAppointment precisely so bookings go through those checks.',
  },
  'POST /testing/seed-asset': {
    notExposed:
      'Registers a media asset without an upload, pointing at a fixture object. Downstream render jobs would then reference storage that no owner ever provided.',
  },
  'POST /testing/clone-fixture': {
    notExposed:
      'Copies bytes into the public assets bucket — the same bucket that serves organisation logos. A write primitive into public storage is not a conversational capability; the suite is its only legitimate caller.',
  },
  'POST /testing/seed-video': {
    notExposed:
      'Writes a video row in a terminal state without rendering anything. Claire reporting a video as ready when no file exists is worse than her saying it failed.',
  },
  'POST /testing/seed-meta-ads': {
    notExposed:
      'Attaches a fixture Meta integration with the suite’s shared token. It would make checkMetaIntegration report a connection the owner never authorised.',
  },
  'POST /testing/seed-stripe-connect': {
    notExposed:
      'Points the org at a pre-onboarded Stripe test account. Payments would then read as enabled while no real account can settle money.',
  },
  'POST /testing/seed-whatsapp': {
    notExposed:
      'Attaches a fixture WhatsApp Business account, which would make campaigns_checkChannels green a channel that cannot actually deliver.',
  },

  // ---- fabricated evidence: the sharpest risk ---------------------------
  'POST /testing/simulate-lead-first-touch': {
    notExposed:
      "Sends Claire's opening message to a real lead over WhatsApp or SMS. An agent able to call this could cold-message any lead in the org, repeatedly and outside the 4h/24h sequence, under the clinic's own sender identity.",
  },
  'POST /testing/simulate-webhook': {
    notExposed:
      'Injects a message as if a customer sent it, driving the full chatbot pipeline. An agent able to invent inbound customer messages can manufacture a conversation history that never happened.',
  },
  'POST /testing/simulate-assistant-message': {
    notExposed:
      'Pushes a turn into an assistant thread out of band. Letting Claire write into her own transcript makes the transcript useless as a record of what she did.',
  },
  'POST /testing/simulate-claire-whatsapp-turn': {
    notExposed:
      'Runs a headless Claire WhatsApp turn for the eval harness. Its output is a fixture, not a delivered message, and reporting it as delivery would be a lie to the owner.',
  },
  'POST /testing/simulate-stripe-webhook': {
    notExposed:
      'Fires a forged Stripe event, which can mark an invoice paid or a payment settled with no money moved. Financial state must only ever come from a signature-verified Stripe delivery.',
  },
  'POST /testing/force-delivery-failure': {
    notExposed:
      'Forces a message to fail delivery so the retry path can be observed. Deliberately breaking a real send is not something to offer conversationally.',
  },

  // ---- destructive suite housekeeping ------------------------------------
  'POST /testing/cleanup': {
    notExposed:
      'Deletes test data namespace-wide. The preview database is shared across suites, so a mistimed call has already been observed wiping sibling runs — an unguarded caller would be far worse.',
  },
  'POST /testing/cleanup-content-batch': {
    notExposed:
      'Removes a content batch and its generated children. Same destructive shape as the general cleanup, scoped to the batch tables.',
  },
  'POST /testing/delete-user-orgs': {
    notExposed:
      'Deletes every organization belonging to a user. Cascades through appointments, leads and sales; there is no undo short of a database restore.',
  },

  // ---- suite readbacks ---------------------------------------------------
  'GET /testing/active-organization': {
    notExposed:
      'Echoes the org id on the current session so the suite can assert against it. Claire always operates within a known org context, so this answers a question she never has.',
  },
  'GET /testing/organization-by-email': {
    notExposed:
      'Cross-tenant lookup that resolves any email to its organization. It deliberately ignores the org boundary every other read enforces.',
  },
  'GET /testing/conversation-messages': {
    notExposed:
      'Unscoped conversation transcript dump for assertions. The customer-conversations area exposes the same content with org scoping and redaction applied.',
  },
  'GET /testing/conversation-status': {
    notExposed:
      'Raw conversation state field for polling in tests. Meaningful only to an assertion, not to an owner asking about a customer.',
  },
  'GET /testing/conversation-intent': {
    notExposed:
      'Returns the classifier’s internal intent label. It is an implementation detail of the chatbot that changes with every prompt revision.',
  },
  'GET /testing/campaign-conversation-intents': {
    notExposed:
      'Batch version of the intent readback across a campaign’s conversations, used to assert classifier behaviour in the eval suite.',
  },
  'GET /testing/open-sale': {
    notExposed:
      'Finds the current open POS sale for assertion purposes, ignoring the till and location scoping the sales area applies.',
  },
  'GET /testing/health': {
    notExposed:
      'Confirms the testing controller itself is mounted on this deployment. It answers "is the suite wired up", not anything about the business.',
  },

  // ---- job and worker triggers -------------------------------------------
  'POST /testing/trigger-monthly-content-batch': {
    notExposed:
      'Fires the scheduled monthly content generation on demand. Off-schedule it spends real model budget and floods the owner with drafts they did not ask for.',
  },
  'POST /testing/trigger-voice-ingest': {
    notExposed:
      'Kicks the voice-cloning ingest worker outside its schedule, spending ElevenLabs quota against a fixture recording.',
  },
  'POST /testing/trigger-health-alerts': {
    notExposed:
      'Forces the health-alert sweep, which can page on-call and post to alerting channels. Fake incidents are how real ones stop being believed.',
  },
  'POST /testing/db-pool-hold': {
    notExposed:
      'Deliberately holds database connections to reproduce the pool-exhaustion wedge. It is a load-bearing outage simulator and will take the API down if misused.',
  },
  'POST /testing/ensure-chatbot-enabled': {
    notExposed:
      'Flips the chatbot on as a test precondition, skipping the settings screen where an owner sees what enabling it means for their customers.',
  },

  // ---- settings shortcuts ------------------------------------------------
  'PATCH /testing/update-org-settings': {
    notExposed:
      'Arbitrary patch over organization settings with none of the validation the real settings endpoints apply. A blank-cheque write, which is exactly what a suite fixture needs and an agent must not have.',
  },
  'PUT /testing/update-chatbot-settings': {
    notExposed:
      'Overwrites chatbot configuration wholesale, including the tone and guardrail fields that shape what customers are told on the business’s behalf.',
  },
});
