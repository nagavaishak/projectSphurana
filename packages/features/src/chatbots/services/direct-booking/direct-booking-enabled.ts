import { usesNativeCalendar } from '../../../shared/native-calendar.js';

/**
 * Booking systems we know orgs use. Matched against an org's booking link and
 * its custom prompt to detect "this clinic actually takes bookings somewhere
 * else". Derived from what production bots were observed sending.
 */
const EXTERNAL_BOOKING_HOSTS =
  /(fresha|cliniko|phorest|treatwell|glossgenius|calendly|vagaro|zenoti|pabau|acuity|squareup|setmore|podium|booksolo|barespace|aesthetidocs|myaestheticrecord|floathelm|mindbodyonline|facesconsent|that-time|bookmenow)/i;

/**
 * Is this URL one of our own booking pages?
 *
 * Matches the host rather than a substring: "borradh.io.evil.com" and
 * "notborradh.io" must not qualify. Any borradh.io subdomain counts, which
 * covers www/app and the staging/dev hosts.
 */
export function isBorradhBookingUrl(url: string): boolean {
  try {
    const host = new URL(url.trim()).hostname.toLowerCase();
    return host === 'borradh.io' || host.endsWith('.borradh.io');
  } catch {
    // Unparseable link — treat as external, i.e. disqualifying.
    return false;
  }
}

export interface DirectBookingEligibilityInput {
  /** Field of record for where the org books (ENG-500). */
  bookingDestination?: string | null;
  /** @deprecated Fallback until ENG-500 PR 2 drops the column. */
  primaryCalendarType?: string | null;
  defaultBookingLink: string | null;
  chatbotSystemPrompt: string | null;
}

/**
 * Why this org must NOT be booked in-chat, or `null` when it is safe.
 *
 * This is the ONLY gate. In-chat booking is on for every organization whose
 * `bookingDestination` is `borradh` — no rollout flag, no allowlist. The
 * remaining checks are about data integrity rather than rollout: an org that
 * still points customers at another booking system would end up with two
 * systems accepting appointments for the same chair, which neither can see.
 *
 * Production evidence (audit 2026-07-18): 3 chatbot-active orgs still carry a
 * stale external booking link (CResultsBeauty → Vagaro, Aphros → Cliniko,
 * nafi → own site) and one carries a Fresha URL in its custom prompt
 * (Flawless Faces), injected as "HIGHEST PRIORITY — OVERRIDES ALL OTHER
 * RULES" and sent to customers 45 times. Choosing "Borradh booking system" in
 * Settings now clears the link, so this resolves itself as orgs are tidied.
 */
export function directBookingBlockedReason(
  org: DirectBookingEligibilityInput
): string | null {
  if (!usesNativeCalendar(org)) {
    return 'org does not take bookings in the Borradh booking system';
  }

  // ANY booking link that is not our own means the clinic's real diary lives
  // elsewhere, whatever the calendar type says.
  //
  // This deliberately does NOT match on known booking SaaS. An earlier version
  // did, and the prod dry run showed four orgs sailing through it because they
  // book through their own domain rather than a recognisable vendor —
  // americanaestheticmc.com, primaldallas.com, go.souldelana.com,
  // nafiaesthetics.com/booking-calendar. A hostname allowlist fails open, and
  // failing open here means two systems booking the same chair. Anything that
  // is not demonstrably our booking page disqualifies the org.
  if (org.defaultBookingLink && !isBorradhBookingUrl(org.defaultBookingLink)) {
    return 'org has an external booking link — its real diary is in another system';
  }

  // The custom directive outranks every rule in the prompt, so a booking URL
  // in there will be sent alongside whatever slots we offer. No code change
  // can suppress it; the only safe response is not to offer slots at all.
  if (
    org.chatbotSystemPrompt &&
    EXTERNAL_BOOKING_HOSTS.test(org.chatbotSystemPrompt)
  ) {
    return 'custom prompt contains an external booking link, which overrides all other rules';
  }

  return null;
}
