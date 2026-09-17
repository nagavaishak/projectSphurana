/**
 * Resolve the lead-form nurturing channel (the post-submit "chat with us"
 * button on a Meta instant form) from the clinic's country.
 *
 * Borradh's acquisition default is a lead form whose thank-you screen drops the
 * lead into a messaging thread that Claire then works. WHICH thread is
 * country-driven, matching where people actually message businesses:
 *
 *   - US        → Messenger (WhatsApp has low business-messaging penetration)
 *   - UK / IE   → WhatsApp  (the default consumer channel)
 *   - elsewhere → WhatsApp when connected, else Messenger (legacy behaviour)
 *
 * WhatsApp can only be used when the org actually has a usable WhatsApp account
 * (active + token not `needs_reconnect`). When a UK/IE org has none, we fall
 * back to Messenger and FLAG it so Claire tells the owner ("WhatsApp isn't
 * connected, so leads will land in Messenger instead").
 *
 * Pure function, no I/O. Country codes are the lowercase ISO-3166 alpha-2
 * values stored on `organizationLocation.country` (see `countryCodeLabels`
 * in @borradh-workspace/labels: `us`, `gb`, `ie`, …).
 */

export type NurtureChannel = 'messenger' | 'whatsapp';

export interface ResolveNurtureChannelInput {
  /**
   * The org primary location's country code (lowercase ISO alpha-2). May be
   * null/undefined when the org has no location on file.
   */
  countryCode?: string | null;
  /** Whether the org has a usable (active + valid token) WhatsApp account. */
  hasUsableWhatsApp: boolean;
}

export interface ResolveNurtureChannelResult {
  channel: NurtureChannel;
  /**
   * True when the country prefers WhatsApp but it isn't usable, so we fell
   * back to Messenger. The skill surfaces this to the owner.
   */
  flagged: boolean;
  /** Human-readable note for the flagged case, else undefined. */
  reason?: string;
}

/** Countries where WhatsApp is the default consumer messaging channel. */
const WHATSAPP_FIRST_COUNTRIES = new Set(['gb', 'ie']);
/** Countries where Messenger is the right default over WhatsApp. */
const MESSENGER_FIRST_COUNTRIES = new Set(['us']);

export function resolveNurtureChannel(
  input: ResolveNurtureChannelInput
): ResolveNurtureChannelResult {
  const code = input.countryCode?.trim().toLowerCase() ?? '';

  // US (and any explicit Messenger-first country): Messenger regardless of
  // whether WhatsApp is connected.
  if (MESSENGER_FIRST_COUNTRIES.has(code)) {
    return { channel: 'messenger', flagged: false };
  }

  // UK / Ireland: WhatsApp is the default — but only if it's connected. If not,
  // fall back to Messenger and flag it so the owner knows why.
  if (WHATSAPP_FIRST_COUNTRIES.has(code)) {
    if (input.hasUsableWhatsApp) {
      return { channel: 'whatsapp', flagged: false };
    }
    return {
      channel: 'messenger',
      flagged: true,
      reason:
        "WhatsApp isn't connected, so leads will land in Messenger instead.",
    };
  }

  // Everywhere else (and unknown country): keep the legacy behaviour —
  // WhatsApp when it's connected, else Messenger. Not flagged: no country
  // preference was overridden.
  return {
    channel: input.hasUsableWhatsApp ? 'whatsapp' : 'messenger',
    flagged: false,
  };
}
