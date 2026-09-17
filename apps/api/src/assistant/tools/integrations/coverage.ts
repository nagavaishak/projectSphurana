import { defineCoverage } from '../coverage.types.js';

/**
 * INTEGRATIONS — 72 endpoints, 2 tools. The largest area, and the one most
 * likely to be mis-graded, because three unrelated classes of route share a
 * prefix:
 *
 *   1. OAUTH PLUMBING (~20 routes). `/auth/*` starts a redirect and sets a
 *      signed state cookie; `/callback/*` is the URL the provider redirects
 *      the owner's BROWSER to, carrying a `code` only the provider can mint.
 *      Neither is a capability: Claire has no browser and no cookie jar, and
 *      calling one out of band produces a state mismatch, not a connection.
 *      These are `notExposed` on mechanics, not on policy.
 *   2. CONNECTION STATUS (~10 routes). These ARE capabilities, and the
 *      important finding of this file. "Is Meta connected?" gates every ads
 *      flow; "is Stripe onboarded?" gates every deposit and POS answer; "is a
 *      calendar linked?" gates booking-destination. Claire already has the
 *      Meta one and it is the tool she calls most before acting. The rest are
 *      the same shape and are parked `undecided` rather than withheld.
 *   3. DISCONNECTS AND CONFIG WRITES (~25 routes). Severing an integration is
 *      the most destructive thing in the product that is not a delete: killing
 *      Meta stops every running ad, killing Stripe stops taking money, and
 *      neither is undone by re-clicking connect (tokens, page subscriptions
 *      and webhook registrations must all be rebuilt). These stay in the UI.
 *
 * Do not read the volume of `notExposed` here as caution. Most of it is class
 * 1 — routes that are not addressable by anyone who is not the OAuth provider.
 */
export const integrationsCoverage = defineCoverage('integrations', {
  'GET /integrations/stripe/tax-codes': {
    notExposed:
      'Supplies the Stripe-owned tax-code list to the staff product and service picker. It is form plumbing, not a business question Claire should independently classify or answer.',
  },

  // ---- connection status: the genuine capabilities ------------------------
  // Both `meta_ads_checkMetaIntegration` and `context_checkConnectedPages`
  // read this one endpoint; it is the single most-called read in the tool set,
  // because almost every ads or social flow has to know the answer first.
  'GET /integrations/meta-ads/integration': {
    exposed: 'meta_ads_checkMetaIntegration',
  },
  // `campaigns_checkChannels` reads this to decide whether WhatsApp is a
  // usable send channel before a campaign is composed.
  'GET /integrations/whatsapp/accounts': { exposed: 'campaigns_checkChannels' },

  'GET /integrations/stripe/account-status': {
    undecided: 'ENG-CLAIRE-INTEGRATIONS-STATUS',
  },
  'GET /integrations/calendar/accounts': {
    undecided: 'ENG-CLAIRE-INTEGRATIONS-STATUS',
  },
  'GET /integrations/booking/accounts': {
    undecided: 'ENG-CLAIRE-INTEGRATIONS-STATUS',
  },
  'GET /integrations/email/accounts': {
    undecided: 'ENG-CLAIRE-INTEGRATIONS-STATUS',
  },
  'GET /integrations/google-my-business/accounts': {
    undecided: 'ENG-CLAIRE-INTEGRATIONS-STATUS',
  },
  'GET /integrations/instagram/integration': {
    undecided: 'ENG-CLAIRE-INTEGRATIONS-STATUS',
  },

  // Organic page reach/impressions for the connected Facebook Page. This is a
  // reporting capability, not plumbing — Claire reports on paid performance
  // and has nothing to say about organic, which is the other half of the
  // question owners actually ask.
  'GET /integrations/meta-ads/page-insights': {
    undecided: 'ENG-CLAIRE-INTEGRATIONS-PAGE-INSIGHTS',
  },
  // The Google review link is the payload of a review-request message. Claire
  // drafts those messages today and cannot fill in the link.
  'GET /integrations/google-my-business/accounts/:id/review-link': {
    undecided: 'ENG-CLAIRE-INTEGRATIONS-REVIEW-LINK',
  },
  // Refreshes the stored Google reviews. A repeatable, idempotent pull rather
  // than a state change, so it is a plausible "check for new reviews" tool.
  'POST /integrations/google-my-business/accounts/:id/sync': {
    undecided: 'ENG-CLAIRE-INTEGRATIONS-GMB-SYNC',
  },

  // Turning the chatbot on or off per channel is a real owner intent ("stop
  // Claire replying on Instagram tonight" — register finding #65 was exactly
  // this, urgently, with the bot live on customers). All three endpoints are
  // one tool: `chatbots_setEnabled` (channel + optional target id + enabled),
  // destructive with an explicit confirmation (ADR-004), reporting the
  // PERSISTED flag from the endpoint's response rather than echoing the
  // request.
  'PUT /integrations/instagram/chatbot': {
    exposed: 'chatbots_setEnabled',
    confirm: true,
  },
  'PUT /integrations/meta-ads-pages/:pageId/chatbot': {
    exposed: 'chatbots_setEnabled',
    confirm: true,
  },
  'PUT /integrations/whatsapp/:accountId/chatbot': {
    exposed: 'chatbots_setEnabled',
    confirm: true,
  },

  // ---- OAuth initiation: 302s that set a signed state cookie -------------
  'GET /integrations/booking/auth/calendly': {
    notExposed:
      'Redirects the browser to Calendly and sets a signed state cookie that the callback verifies. Claire holds no cookie jar, so calling it yields a redirect she cannot follow and a state she cannot present.',
  },
  'GET /integrations/booking/auth/timely': {
    notExposed:
      'Same redirect-plus-state-cookie handshake as the Calendly starter, against Timely. Connecting is an owner action taken in Settings, in a browser.',
  },
  'GET /integrations/calendar/auth/google': {
    notExposed:
      'Starts the Google Calendar consent screen. The scopes granted here are the owner-facing security decision of the whole integration and must be seen and approved by a human, not requested on their behalf.',
  },
  'GET /integrations/email/auth/gmail': {
    notExposed:
      'Google OAuth consent redirect for mailbox access. Reading a mailbox is the most sensitive grant in the product; the consent screen is the point at which the owner sees exactly what they are granting.',
  },
  'GET /integrations/email/auth/outlook': {
    notExposed:
      'Microsoft OAuth consent redirect for the same mailbox grant. Browser-bound handshake with a state cookie; nothing here is invocable server-side.',
  },
  'GET /integrations/google-my-business/auth': {
    notExposed:
      'Google Business Profile consent redirect. Grants the right to publish and reply as the business on its public listing — an owner decision made at the consent screen.',
  },
  'GET /integrations/instagram/auth': {
    notExposed:
      'Redirect into the Meta login dialog for the Instagram (Facebook Login for Business) flow. Only meaningful inside a browser session that will come back to the callback.',
  },
  'GET /integrations/meta-ads/auth': {
    notExposed:
      'Redirect into the Meta OAuth dialog for ad-account access. Claire consumes the RESULT of this handshake through checkMetaIntegration; she has no role in performing it.',
  },
  'GET /integrations/stripe/auth': {
    notExposed:
      'Redirect into Stripe Connect onboarding. Stripe requires the account holder personally to supply identity and bank details, so the flow is human-only by regulation as well as by mechanics.',
  },
  'GET /integrations/instagram/authorize-url': {
    notExposed:
      'Returns the authorize URL for the frontend to open, bound to a state value stored for this browser session. A URL handed to Claire is a URL nobody will complete, and it expires unused.',
  },

  // ---- OAuth callbacks: the provider redirects here ----------------------
  'GET /integrations/booking/callback/calendly': {
    notExposed:
      'Calendly redirects the browser here with a single-use authorization code. Only Calendly can produce a valid code, so this route has exactly one legitimate caller and it is not Claire.',
  },
  'GET /integrations/booking/callback/timely': {
    notExposed:
      'Timely redirect target carrying a single-use code plus the state cookie set by the auth route. Not addressable without both halves of the handshake.',
  },
  'GET /integrations/calendar/callback/google': {
    notExposed:
      'Google redirect target that exchanges the code for calendar tokens and then bounces the browser back into the app. There is no response body a tool could use.',
  },
  'GET /integrations/email/callback/gmail': {
    notExposed:
      'Gmail OAuth redirect target. Exchanges a provider-minted code for mailbox tokens; returns a browser redirect rather than data.',
  },
  'GET /integrations/email/callback/outlook': {
    notExposed:
      'Outlook OAuth redirect target, same code-for-tokens exchange and same browser redirect response.',
  },
  'GET /integrations/google-my-business/callback': {
    notExposed:
      'Google Business Profile redirect target. Completing it out of band would attach a location to the wrong org, since the org identity travels in the state cookie.',
  },
  'GET /integrations/instagram/callback': {
    notExposed:
      'Meta redirect target for the Instagram connect flow; it exchanges the code, subscribes webhooks, and redirects the browser to a settings page.',
  },
  'GET /integrations/meta-ads/callback': {
    notExposed:
      'Meta redirect target for the ads connect flow. Its whole output is a redirect plus a persisted token record, which Claire then reads via the integration status endpoint.',
  },
  'GET /integrations/stripe/callback': {
    notExposed:
      'Stripe Connect return URL. Stripe decides when onboarding is complete; hitting this without a real Stripe redirect tells us nothing.',
  },
  'GET /integrations/facebook/webhook': {
    notExposed:
      'Meta webhook verification handshake — echoes hub.challenge when the subscription is registered. It answers Meta, not a user, and returns a bare token string.',
  },
  'POST /integrations/facebook/webhook': {
    notExposed:
      'Inbound Meta webhook receiver for page events, authenticated by an X-Hub signature over the raw body. Nothing a model can construct, and it is a delivery endpoint rather than an action.',
  },

  // ---- connect-wizard writes: consume short-lived handshake material -----
  'POST /integrations/meta-ads/initiate': {
    notExposed:
      'Finalises a Facebook Login for Business popup by exchanging a one-time code the browser just received. There is no session-independent way to obtain that code, so an agent has nothing it could call this with.',
  },
  'POST /integrations/meta-ads/connect': {
    notExposed:
      'Exchanges the short-lived token the browser just received from Meta for a long-lived one. The token is not something Claire can hold or obtain.',
  },
  'POST /integrations/meta-ads/ad-accounts': {
    notExposed:
      'POST-shaped read: lists ad accounts visible to a token supplied in the body by the connect wizard. Once connected, the chosen account is already in the integration status Claire can read.',
  },
  'POST /integrations/meta-ads/pages#getMetaPages': {
    notExposed:
      'The other POST-shaped read on the same path — enumerates Facebook Pages for the wizard token so the owner can pick one. Superseded for Claire by the pages already on the integration record.',
  },
  'POST /integrations/meta-ads/pages#addOrgMetaAdsPage': {
    notExposed:
      'Attaches a Facebook Page to the org and subscribes its webhooks. Choosing which Page speaks for the business is an identity decision, and a wrong pick sends the chatbot to strangers.',
  },
  'POST /integrations/meta-ads/configure': {
    notExposed:
      'Writes the ad account, page and pixel selection that every subsequent ad spends against. Getting it wrong bills the wrong account, so it stays a deliberate selection in Settings.',
  },
  'POST /integrations/booking/connect/phorest': {
    notExposed:
      'Connects Phorest using an API key and branch id typed by the owner. Claire has no way to obtain credentials, and should never be a place credentials are typed.',
  },
  'POST /integrations/whatsapp/finalize': {
    notExposed:
      'Completes WhatsApp Embedded Signup by exchanging the code Meta handed the browser and registering the phone number. Browser-bound and single-use.',
  },
  'POST /integrations/stripe/account-link': {
    notExposed:
      'Mints a one-time Stripe onboarding link scoped to a browser session. Handing it to a model produces a link that expires unused.',
  },
  'GET /integrations/meta/self-serve/callback': {
    notExposed:
      'The unauthenticated landing point of the shareable Meta link. It is a browser redirect target that exchanges a one-time code Meta issued to a person mid-authorisation — there is no session to act for, and nothing an agent could usefully call it with.',
  },
  'GET /integrations/stripe/self-serve/callback': {
    notExposed:
      'The public landing leg of the shareable Stripe onboarding link. It is addressable only by a browser Stripe just redirected, carrying a single-use code Stripe minted for that merchant — nobody else can produce one, and calling it out of band produces an error page, not a connection.',
  },
  'POST /integrations/stripe/link-account': {
    notExposed:
      'Binds a Stripe account id, read off the Stripe dashboard by a human during onboarding, to this workspace — the destination every future payout lands in. The id is not derivable from anything Claire can see, and a wrong one points a merchant\u2019s money at someone else\u2019s account. Human-entered, human-confirmed.',
  },
  'POST /integrations/stripe/account-refresh': {
    notExposed:
      'Re-mints an expired onboarding link when Stripe bounces the owner back. Pure continuation of the browser flow.',
  },
  'POST /integrations/stripe/account-session': {
    notExposed:
      'Issues a client secret for the embedded Stripe Connect components to render in the dashboard. It is a credential for a UI widget, not information.',
  },
  'POST /integrations/facebook/subscribe-page': {
    notExposed:
      'Re-subscribes a Page to our webhook fields. Operational repair for when Meta drops a subscription, invoked from the integrations screen after a diagnostic.',
  },
  'POST /integrations/instagram/subscribe-webhooks': {
    notExposed:
      'Same webhook re-subscription for Instagram. Internal plumbing repair with no owner-visible outcome to report.',
  },
  'POST /integrations/instagram/fix-user-ids': {
    notExposed:
      'One-off repair that rewrites stored Instagram-scoped user ids after the Facebook-Login-for-Business migration. A maintenance script exposed as a route, not a product capability.',
  },
  'POST /integrations/voice/book': {
    notExposed:
      'The tool endpoint the Telnyx voice agent calls mid-call to place a booking. It is another agent’s tool surface; Claire books through the appointments area instead, and two agents writing the same booking is how doubles happen.',
  },

  // ---- selection / catalogue reads tied to a wizard step ------------------
  'GET /integrations/booking/accounts/:id/team-members': {
    notExposed:
      'Lists staff as the external booking system sees them, so the import wizard can map them onto practitioners. The mapped result is what matters and it is readable from the practitioners area.',
  },
  'GET /integrations/calendar/accounts/:id/calendars': {
    notExposed:
      'Enumerates every calendar on the Google account so the owner can tick which ones count as busy. A picker list, and the chosen selection is what downstream availability actually uses.',
  },
  'GET /integrations/meta-ads/pages': {
    notExposed:
      'Duplicates the pages array already embedded in the integration status Claire reads through checkMetaIntegration. Two reads of one fact is how a model ends up quoting the stale one.',
  },
  'GET /integrations/stripe/integration': {
    notExposed:
      'Thin connection row (account id, connected-at). Everything Claire would act on — charges enabled, payouts enabled, outstanding requirements — lives on /stripe/account-status, which is the one worth exposing.',
  },
  'GET /integrations/meta-ads/lead-forms': {
    notExposed:
      'Lists Meta-native lead forms on the ad account. Claire works with our own lead forms through the lead-forms area, which owns the nurture wiring; mixing the two vocabularies is how a form gets built that nothing follows up.',
  },
  'GET /integrations/whatsapp/accounts/:id/templates': {
    notExposed:
      'Superseded for Claire by campaigns/whatsapp-templates, which campaigns_listWhatsappTemplates reads and which returns templates already shaped for campaign composition.',
  },

  // ---- config writes -----------------------------------------------------
  'POST /integrations/meta-ads/lead-forms': {
    notExposed:
      'Creates a lead form directly on Meta with no nurture sequence attached. lead_forms_createLeadForm is the path that builds the form AND the follow-up; a bare Meta form collects leads nobody contacts.',
  },
  'PUT /integrations/meta-ads/default-lead-form': {
    notExposed:
      'Changes which form every future ad attaches by default. A silent one-field write with fleet-wide consequences and no obvious symptom when it is wrong.',
  },
  'PUT /integrations/meta-ads/pages/:pageId/default': {
    notExposed:
      'Changes which Page the business posts and advertises as. An identity change the owner should make where they can see both Pages side by side.',
  },
  'PUT /integrations/calendar/accounts/:id': {
    notExposed:
      'Changes which Google calendars block availability. Ticking one more calendar can empty the booking grid, and the failure is invisible until customers cannot book.',
  },
  'POST /integrations/booking/accounts/:id/import-team-members': {
    notExposed:
      'Bulk-creates practitioners from the external system. A partial or duplicated import leaves shadow staff attached to real appointments and is tedious to unwind by hand.',
  },
  'POST /integrations/whatsapp/accounts/:id/templates': {
    notExposed:
      'Submits a message template to Meta for review. Approval takes days, rejected templates count against the account, and the text becomes a fixed asset — not a thing to generate speculatively.',
  },

  // ---- disconnects: the destructive end ----------------------------------
  'DELETE /integrations/meta-ads/integration': {
    notExposed:
      'Severs Meta entirely: every running ad stops delivering and page webhooks are dropped. Reconnecting is a fresh OAuth plus reconfiguration, so this is never a step in a conversation.',
  },
  'DELETE /integrations/stripe/integration': {
    notExposed:
      'Disconnects Stripe Connect, which stops deposits and every POS card payment. The business loses the ability to take money mid-day; strictly a human decision.',
  },
  'DELETE /integrations/instagram/integration': {
    notExposed:
      'Drops the Instagram connection along with its webhook subscription, silently ending DM handling. Re-authorising requires the owner to complete Meta login again.',
  },
  'DELETE /integrations/meta-ads/pages/:pageId': {
    notExposed:
      'Detaches a Facebook Page, which unsubscribes its webhooks and orphans any ad or scheduled post pointing at it. Partial breakage is harder to notice than a full disconnect.',
  },
  'DELETE /integrations/whatsapp/accounts/:id': {
    notExposed:
      'Removes the WhatsApp Business account, killing the channel every nurture sequence and campaign sends on. Re-provisioning goes back through Meta Embedded Signup.',
  },
  'DELETE /integrations/whatsapp/accounts/:id/templates/:templateName': {
    notExposed:
      'Deletes a Meta-approved template. Re-approval takes days, and any campaign or nurture step referencing it starts failing to send in the meantime.',
  },
  'DELETE /integrations/calendar/accounts/:id': {
    notExposed:
      'Unlinks the Google Calendar that supplies external busy times. Availability silently widens and customers get booked over the owner’s real commitments.',
  },
  'DELETE /integrations/booking/accounts/:id': {
    notExposed:
      'Disconnects the external booking system and stops appointment sync. Bookings taken on the other side stop arriving, with no error anyone will see.',
  },
  'DELETE /integrations/email/accounts/:id': {
    notExposed:
      'Revokes mailbox access and stops email send/receive for the org. Re-granting requires the full OAuth consent screen again.',
  },
  'DELETE /integrations/google-my-business/accounts/:id': {
    notExposed:
      'Disconnects the Business Profile, ending review sync and the ability to reply publicly as the business. Reconnect is a fresh consent flow.',
  },
});
