import type { ChatbotSettings } from '@borradh-workspace/database';
import { countryCodeLabels } from '@borradh-workspace/labels';

// =============================================================================
// DEPOSIT INSTRUCTIONS
// =============================================================================

/**
 * What Claire says about deposits.
 *
 * `feeDescription` comes from the SAME resolver the booking charges from, so
 * the figure she quotes is the figure the customer is asked for. It used to be
 * derived from a separate copy of the settings in chatbot JSONB, which is how
 * she could quote one number while the booking took another.
 *
 * No link: deposits are collected in the booking flow, not by pasting a static
 * payment URL into a chat.
 */
export function buildDepositInstructions(
  feeDescription: string | null
): string {
  if (!feeDescription) return '';

  return (
    `\n=== DEPOSIT ===\nWe take ${feeDescription} deposit to secure the booking.` +
    `\nSay: "there's just ${feeDescription} deposit to secure your spot — I'll send you the booking link to sort it"`
  );
}

// =============================================================================
// TREATMENT RESULTS SECTION
// =============================================================================

export function buildTreatmentResultsSection(
  treatmentResults?: Record<string, string>
): string {
  if (!treatmentResults || Object.keys(treatmentResults).length === 0)
    return '';

  const lines = Object.entries(treatmentResults)
    .map(([treatment, results]) => `${treatment}: ${results}`)
    .join('\n');

  return `\n--- Treatment Results Knowledge ---\nUse these to sell with results when discussing these treatments:\n${lines}`;
}

// =============================================================================
// CONSULTATION TYPE HELPERS
// =============================================================================

/**
 * Determine whether consultations are free or paid based on:
 * 1. chatbotSettings.consultation.type (explicit setting)
 * 2. Per-service requiresDeposit flags (if any service requires deposit → not free)
 */
/**
 * Turn the resolved per-service deposits into the phrase Claire says.
 *
 * One distinct figure → that figure. Several → "from €X", the lowest, which is
 * honest without committing to a number that varies by treatment. None → null,
 * and the caller says nothing about deposits at all rather than inventing "a
 * small fee".
 */
export function describeServiceFees(
  services: { depositCents: number | null }[]
): string | null {
  const fees = [
    ...new Set(
      services
        .map((s) => s.depositCents)
        .filter((v): v is number => v !== null && v > 0)
    ),
  ].sort((a, b) => a - b);

  if (fees.length === 0) return null;
  const money = (cents: number) => `€${(cents / 100).toFixed(0)}`;
  return fees.length === 1 ? money(fees[0]) : `from ${money(fees[0])}`;
}

export function isConsultationFree(
  chatbotSettings: ChatbotSettings | null,
  services: { requiresDeposit: boolean; depositCents: number | null }[]
): boolean {
  // Explicit setting takes priority
  if (chatbotSettings?.consultation?.type === 'paid') return false;
  if (chatbotSettings?.consultation?.type === 'free') return true;

  // If any service has a paid consultation, don't default to "free"
  if (services.some((s) => s.requiresDeposit)) return false;

  // Default: free
  return true;
}

export function buildConsultationPhrases(
  isFree: boolean,
  _ownerName: string,
  services: { requiresDeposit: boolean; depositCents: number | null }[]
) {
  if (isFree) {
    return {
      article: 'a consultation',
      qualifier: '',
      rule: 'Consultation is low pressure: "there\'s no pressure at all"',
      objectionLine:
        "\"Ah honestly for what you get it's unreal value, our specialist has years of experience and most clients say they wish they'd done it sooner. The results really do speak for themselves. Why not pop in for a consultation and see for yourself, our team can go through everything with you and there's no pressure at all\"",
      healthLine:
        'See the MEDICAL SAFETY QUESTIONS section above. Give a direct, honest answer for known contraindications (pregnancy, breastfeeding, accutane, blood thinners). For complex medical history, suggest a consultation with our specialist.',
    };
  }

  // Paid consultation — the figure comes from the resolved deposits, so it is
  // the one the booking will actually ask for.
  const feeDescription = describeServiceFees(services) ?? 'a small fee';

  return {
    article: 'a consultation',
    qualifier: '',
    rule: `Some consultations have a fee (check each service's consultation fee in the clinic data). When the consultation has a fee, mention it upfront: "there's a ${feeDescription} consultation fee which goes toward your treatment"`,
    objectionLine:
      "\"Ah honestly for what you get it's unreal value, our specialist has years of experience and most clients say they wish they'd done it sooner. The results really do speak for themselves. Why not pop in for a consultation and see for yourself, our team can go through everything with you and there's no pressure at all\"",
    healthLine:
      'See the MEDICAL SAFETY QUESTIONS section above. Give a direct, honest answer for known contraindications (pregnancy, breastfeeding, accutane, blood thinners). For complex medical history, suggest a consultation with our specialist.',
  };
}

// =============================================================================
// LAYER 2: CLINIC DATA BUILDER
// =============================================================================

export interface ClinicDataParams {
  organizationName: string;
  chatbotSettings: ChatbotSettings | null;
  services: {
    name: string;
    pricingDescription?: string | null;
    bookingFormUrl: string | null;
    requiresDeposit: boolean;
    depositCents: number | null;
    appointmentDuration: number | null;
    description: string | null;
  }[];
  defaultBookingLink: string | null;
  businessType?: string | null;
  tagline?: string | null;
  credibilityLine?: string | null;
  businessHours?: Record<number, { from: number; to: number }> | null;
  /**
   * The branch this conversation is about, when one is known.
   *
   * The prices below are THAT branch's. Without naming it, the prompt lists
   * every branch's address beside a single price list, and the model
   * reasonably concludes the price is org-wide — observed saying "€220 in both
   * Cork and Dublin" when Dublin is €250, and quoting Cork's price for a
   * customer who explicitly asked about Dublin.
   */
  activeLocationName?: string | null;
  locations?: {
    name: string | null;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    county: string | null;
    postalCode: string | null;
    country: string;
  }[];
  websiteUrl?: string | null;
  knowledgeBase?: unknown;
  customSystemPrompt?: string | null;
  calendarConnected?: boolean;
}

export function formatBusinessHours(
  hours: Record<number, { from: number; to: number }>
): string {
  const dayNames = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];

  const formatTime = (minutes: number): string => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  };

  return Object.entries(hours)
    .map(([day, slot]) => {
      const dayName = dayNames[Number(day)] ?? `Day ${day}`;
      if (slot.from === 0 && slot.to === 0) return `${dayName}: Closed`;
      return `${dayName}: ${formatTime(slot.from)} - ${formatTime(slot.to)}`;
    })
    .join('\n');
}

export function buildClinicData(params: ClinicDataParams): string {
  const {
    organizationName,
    chatbotSettings,
    services,
    defaultBookingLink,
    businessType,
    tagline,
    credibilityLine,
    businessHours,
    activeLocationName,
    locations,
    websiteUrl,
    knowledgeBase,
  } = params;

  const parts: string[] = [];

  // Basic clinic info
  parts.push('\n=== CLINIC DATA ===');
  parts.push(`Clinic Name: ${organizationName}`);
  if (businessType) parts.push(`Business Type: ${businessType}`);
  if (tagline) parts.push(`Tagline: ${tagline}`);
  if (credibilityLine) parts.push(`Credibility: ${credibilityLine}`);
  if (websiteUrl) parts.push(`Website: ${websiteUrl}`);

  // Owner info
  if (chatbotSettings?.ownerName) {
    let ownerLine = `Specialist: ${chatbotSettings.ownerName}`;
    if (chatbotSettings.ownerCredentials)
      ownerLine += ` (${chatbotSettings.ownerCredentials})`;
    if (chatbotSettings.ownerAwards)
      ownerLine += ` | ${chatbotSettings.ownerAwards}`;
    parts.push(ownerLine);
  }

  // Clinic contact
  if (chatbotSettings?.clinicPhone)
    parts.push(`Phone: ${chatbotSettings.clinicPhone}`);
  if (chatbotSettings?.clinicEmail)
    parts.push(`Email: ${chatbotSettings.clinicEmail}`);

  // Differentiators
  const diff = chatbotSettings?.differentiators;
  if (diff) {
    const diffLines: string[] = [];
    if (diff.machine) diffLines.push(`Equipment: ${diff.machine}`);
    if (diff.certs) diffLines.push(`Qualifications: ${diff.certs}`);
    if (diff.years) diffLines.push(`Experience: ${diff.years} years`);
    if (diff.reviews) diffLines.push(`Reviews: ${diff.reviews}`);
    if (diff.usps && diff.usps.length > 0)
      diffLines.push(`USPs: ${diff.usps.join(', ')}`);
    if (diffLines.length > 0) {
      parts.push(`\n--- Differentiators ---\n${diffLines.join('\n')}`);
    }
  }

  // Consultation info
  const consultation = chatbotSettings?.consultation;
  if (consultation) {
    const consultType =
      consultation.type === 'free' ? 'consultation' : 'paid consultation';
    let consultLine = `Consultation: ${consultType}`;
    if (consultation.duration) consultLine += ` (${consultation.duration} min)`;
    parts.push(consultLine);
  }

  // Availability
  const availability = chatbotSettings?.availability;
  if (availability) {
    const availLines: string[] = [];
    if (availability.evening) availLines.push('Evening appointments available');
    if (availability.nextSlot)
      availLines.push(`Next available: ${availability.nextSlot}`);
    if (availLines.length > 0) {
      parts.push(`Availability: ${availLines.join(', ')}`);
    }
  }

  // Parking
  if (chatbotSettings?.parkingInfo) {
    parts.push(`Parking: ${chatbotSettings.parkingInfo}`);
  }

  // Links
  if (chatbotSettings?.galleryLink)
    parts.push(`Gallery: ${chatbotSettings.galleryLink}`);
  if (chatbotSettings?.instagramLink)
    parts.push(`Instagram: ${chatbotSettings.instagramLink}`);
  if (chatbotSettings?.reviewsLink)
    parts.push(`Reviews: ${chatbotSettings.reviewsLink}`);
  if (chatbotSettings?.specialOffers)
    parts.push(`Special Offers: ${chatbotSettings.specialOffers}`);

  // Escalation contacts
  if (chatbotSettings?.escalationEmail || chatbotSettings?.escalationPhone) {
    const contacts: string[] = [];
    if (chatbotSettings.escalationEmail)
      contacts.push(`Email: ${chatbotSettings.escalationEmail}`);
    if (chatbotSettings.escalationPhone)
      contacts.push(`Phone: ${chatbotSettings.escalationPhone}`);
    parts.push(`\n--- Escalation Contacts ---\n${contacts.join('\n')}`);
  }

  // Business hours
  if (businessHours) {
    parts.push(
      `\n--- Opening Hours ---\n${formatBusinessHours(businessHours)}`
    );
  }

  // Locations
  if (locations && locations.length > 0) {
    const locationLines = locations.map((loc) => {
      const countryName =
        countryCodeLabels[loc.country as keyof typeof countryCodeLabels] ??
        loc.country;
      const namePart = loc.name ? `${loc.name}: ` : '';
      const addressParts = [
        loc.addressLine1,
        loc.addressLine2,
        loc.city,
        loc.county,
        loc.postalCode,
        countryName,
      ].filter(Boolean);
      return `${namePart}${addressParts.join(', ')}`;
    });
    parts.push(
      `\n--- Location${locations.length > 1 ? 's' : ''} ---\n${locationLines.join('\n')}`
    );

    // Pin the prices to the branch in scope.
    //
    // Only when there is more than one branch — a single-branch business has no
    // such concept and the line would be noise. Phrased as a prohibition
    // because the observed failure was not silence but CONFIDENCE: asked
    // whether the facial was cheaper in Cork or Dublin, the model volunteered
    // that it was "€220 in both", and told a customer asking specifically about
    // Dublin that prices were "the same there". Both were wrong, and both read
    // as helpful.
    if (activeLocationName && locations.length > 1) {
      parts.push(
        `\nThe prices and durations below are for ${activeLocationName} ONLY. Other branches may charge differently. Never state or imply another branch's price, and never say prices are the same everywhere. If the customer asks about a different branch, say you will check that branch's price rather than repeating this one.`
      );
    }
  }

  // Treatments / Services
  if (services.length > 0) {
    const serviceLines = services.map((s) => {
      let line = `- ${s.name}`;
      if (s.pricingDescription) line += ` | Pricing: ${s.pricingDescription}`;
      if (s.appointmentDuration)
        line += ` | Duration: ${s.appointmentDuration} min`;
      if (s.description) line += ` | ${s.description}`;
      const bookingUrl = s.bookingFormUrl ?? defaultBookingLink;
      if (bookingUrl) line += ` | Book: ${bookingUrl}`;
      if (s.depositCents) {
        line += ` | Consultation fee: €${(s.depositCents / 100).toFixed(2)}`;
      } else if (s.requiresDeposit) {
        line += ' | Paid consultation';
      } else {
        line += ' | Consultation included';
      }
      return line;
    });
    parts.push(`\n--- Treatments ---\n${serviceLines.join('\n')}`);
  } else if (defaultBookingLink) {
    parts.push(`\nDefault booking link: ${defaultBookingLink}`);
  }

  // FAQs
  const faqs = chatbotSettings?.faqs;
  if (faqs && faqs.length > 0) {
    const faqLines = faqs
      .slice(0, 20)
      .map((f) => `Q: ${f.question}\nA: ${f.answer}`);
    parts.push(`\n--- FAQs ---\n${faqLines.join('\n\n')}`);
  }

  // Deposit instructions
  // Same figures Claire quotes elsewhere, and the same the booking charges.
  parts.push(buildDepositInstructions(describeServiceFees(services)));

  // NOTE: customSystemPrompt is now injected in buildBorradhSystemPrompt()
  // before clinic data, so it gets higher priority in the prompt.

  // Knowledge base
  if (knowledgeBase) {
    const kbText =
      typeof knowledgeBase === 'string'
        ? knowledgeBase
        : JSON.stringify(knowledgeBase, null, 2);
    if (kbText.length > 0) {
      parts.push(
        `\n--- Knowledge Base ---\nUse this information to answer customer questions. Only fetch from the website if the question is NOT covered here.\n${kbText.slice(0, 6000)}`
      );
    }
  }

  return parts.join('\n');
}
