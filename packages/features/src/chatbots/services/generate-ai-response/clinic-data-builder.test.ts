import type { ChatbotSettings } from '@borradh-workspace/database';
import { describe, expect, it } from 'vitest';
import {
  type ClinicDataParams,
  buildClinicData,
  buildConsultationPhrases,
  buildDepositInstructions,
  buildTreatmentResultsSection,
  describeServiceFees,
  formatBusinessHours,
  isConsultationFree,
} from './clinic-data-builder.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeSettings = (
  overrides: Partial<ChatbotSettings> = {}
): ChatbotSettings =>
  ({
    ownerName: 'Dr Sarah',
    toneRegion: 'ie',
    ...overrides,
  }) as ChatbotSettings;

const makeService = (
  overrides: Partial<ClinicDataParams['services'][number]> = {}
): ClinicDataParams['services'][number] => ({
  name: 'Lip Filler',
  pricingDescription: null,
  bookingFormUrl: null,
  requiresDeposit: false,
  depositAmountCents: null,
  depositLink: null,
  appointmentDuration: null,
  description: null,
  ...overrides,
});

// ---------------------------------------------------------------------------
// buildDepositInstructions
// ---------------------------------------------------------------------------

describe('buildDepositInstructions', () => {
  it('returns empty string when settings are null', () => {
    expect(buildDepositInstructions(null)).toBe('');
  });

  it('quotes the resolved fee and points at the booking flow', () => {
    // The figure comes from the same resolver the booking charges from, and
    // there is no static payment link to hand out any more.
    const result = buildDepositInstructions('€50');
    expect(result).toContain('€50');
    expect(result).toContain('booking link');
    expect(result).not.toContain('http');
  });
});

describe('describeServiceFees', () => {
  it('names the figure when every service charges the same', () => {
    expect(
      describeServiceFees([{ depositCents: 5000 }, { depositCents: 5000 }])
    ).toBe('€50');
  });

  it('says "from" the lowest when they differ', () => {
    expect(
      describeServiceFees([{ depositCents: 5000 }, { depositCents: 3000 }])
    ).toBe('from €30');
  });

  it('returns null when nothing is due, so Claire says nothing at all', () => {
    // Rather than inventing "a small fee" for a clinic that takes none.
    expect(describeServiceFees([{ depositCents: null }])).toBeNull();
    expect(describeServiceFees([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildTreatmentResultsSection
// ---------------------------------------------------------------------------

describe('buildTreatmentResultsSection', () => {
  it('returns empty string when undefined', () => {
    expect(buildTreatmentResultsSection(undefined)).toBe('');
  });

  it('returns empty string when empty object', () => {
    expect(buildTreatmentResultsSection({})).toBe('');
  });

  it('formats treatment results', () => {
    const result = buildTreatmentResultsSection({
      'Lip Filler': 'Immediate results, lasts 6-12 months',
      Botox: 'Results in 3-5 days',
    });
    expect(result).toContain('Treatment Results Knowledge');
    expect(result).toContain('Lip Filler: Immediate results');
    expect(result).toContain('Botox: Results in 3-5 days');
  });
});

// ---------------------------------------------------------------------------
// isConsultationFree
// ---------------------------------------------------------------------------

describe('isConsultationFree', () => {
  it('returns false when explicitly set to paid', () => {
    const settings = makeSettings({
      consultation: { type: 'paid' } as ChatbotSettings['consultation'],
    });
    expect(isConsultationFree(settings, [])).toBe(false);
  });

  it('returns true when explicitly set to free', () => {
    const settings = makeSettings({
      consultation: { type: 'free' } as ChatbotSettings['consultation'],
    });
    expect(isConsultationFree(settings, [])).toBe(true);
  });

  it('returns false when any service requires deposit', () => {
    const services = [
      { requiresDeposit: true, depositAmountCents: 5000 },
      { requiresDeposit: false, depositAmountCents: null },
    ];
    expect(isConsultationFree(null, services)).toBe(false);
  });

  it('defaults to free when no explicit setting and no deposits', () => {
    expect(isConsultationFree(null, [])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildConsultationPhrases
// ---------------------------------------------------------------------------

describe('buildConsultationPhrases', () => {
  it('returns free consultation phrases when isFree', () => {
    const result = buildConsultationPhrases(true, 'Dr Sarah', []);
    expect(result.article).toBe('a consultation');
    expect(result.rule).toContain('low pressure');
  });

  it('returns paid consultation phrases with single fee', () => {
    const services = [{ requiresDeposit: true, depositCents: 5000 }];
    const result = buildConsultationPhrases(false, 'Dr Sarah', services);
    expect(result.rule).toContain('€50');
    expect(result.rule).toContain('consultation fee');
  });

  it('returns range when multiple different fees', () => {
    const services = [
      { requiresDeposit: true, depositCents: 3000 },
      { requiresDeposit: true, depositCents: 5000 },
    ];
    const result = buildConsultationPhrases(false, 'Dr Sarah', services);
    expect(result.rule).toContain('from €30');
  });

  it('uses generic text when no fee info at all', () => {
    const result = buildConsultationPhrases(false, 'Dr Sarah', []);
    expect(result.rule).toContain('a small fee');
  });
});

// ---------------------------------------------------------------------------
// formatBusinessHours
// ---------------------------------------------------------------------------

describe('formatBusinessHours', () => {
  it('formats hours correctly', () => {
    const hours = {
      1: { from: 540, to: 1020 }, // Monday 09:00-17:00
      0: { from: 0, to: 0 }, // Sunday closed
    };
    const result = formatBusinessHours(hours);
    expect(result).toContain('Monday: 09:00 - 17:00');
    expect(result).toContain('Sunday: Closed');
  });

  it('handles unknown day numbers', () => {
    const hours = { 8: { from: 540, to: 1020 } };
    const result = formatBusinessHours(hours);
    expect(result).toContain('Day 8');
  });
});

// ---------------------------------------------------------------------------
// buildClinicData
// ---------------------------------------------------------------------------

describe('buildClinicData', () => {
  const baseParams: ClinicDataParams = {
    organizationName: 'Glow Clinic',
    chatbotSettings: null,
    services: [],
    defaultBookingLink: null,
  };

  it('includes clinic name', () => {
    const result = buildClinicData(baseParams);
    expect(result).toContain('Glow Clinic');
    expect(result).toContain('CLINIC DATA');
  });

  it('includes optional fields when provided', () => {
    const result = buildClinicData({
      ...baseParams,
      businessType: 'Aesthetics',
      tagline: 'Look your best',
      websiteUrl: 'https://glow.ie',
    });
    expect(result).toContain('Business Type: Aesthetics');
    expect(result).toContain('Tagline: Look your best');
    expect(result).toContain('Website: https://glow.ie');
  });

  it('includes services with pricing', () => {
    const result = buildClinicData({
      ...baseParams,
      services: [
        makeService({
          name: 'Botox',
          pricingDescription: '€200',
          appointmentDuration: 30,
        }),
      ],
    });
    expect(result).toContain('- Botox');
    expect(result).toContain('Pricing: €200');
    expect(result).toContain('Duration: 30 min');
  });

  it('falls back to default booking link when service has none', () => {
    const result = buildClinicData({
      ...baseParams,
      defaultBookingLink: 'https://book.example.com',
      services: [makeService({ name: 'Botox' })],
    });
    expect(result).toContain('Book: https://book.example.com');
  });

  it('uses service-specific booking URL when available', () => {
    const result = buildClinicData({
      ...baseParams,
      defaultBookingLink: 'https://default.com',
      services: [
        makeService({ name: 'Botox', bookingFormUrl: 'https://botox.com' }),
      ],
    });
    expect(result).toContain('Book: https://botox.com');
    expect(result).not.toContain('Book: https://default.com');
  });

  it('includes owner info from settings', () => {
    const result = buildClinicData({
      ...baseParams,
      chatbotSettings: makeSettings({
        ownerName: 'Dr Sarah',
        ownerCredentials: 'MBBS',
        ownerAwards: 'Best Clinic 2024',
      }),
    });
    expect(result).toContain('Specialist: Dr Sarah');
    expect(result).toContain('(MBBS)');
    expect(result).toContain('Best Clinic 2024');
  });

  it('includes FAQs from settings', () => {
    const result = buildClinicData({
      ...baseParams,
      chatbotSettings: makeSettings({
        faqs: [{ question: 'Does it hurt?', answer: 'Not really' }],
      }),
    });
    expect(result).toContain('Q: Does it hurt?');
    expect(result).toContain('A: Not really');
  });

  it('includes locations', () => {
    const result = buildClinicData({
      ...baseParams,
      locations: [
        {
          name: 'Main',
          addressLine1: '1 Main St',
          addressLine2: null,
          city: 'Dublin',
          county: 'Dublin',
          postalCode: 'D01',
          country: 'IE',
        },
      ],
    });
    expect(result).toContain('Main: 1 Main St');
    expect(result).toContain('Dublin');
  });

  it('includes knowledge base as string', () => {
    const result = buildClinicData({
      ...baseParams,
      knowledgeBase: 'Custom info about treatments.',
    });
    expect(result).toContain('Knowledge Base');
    expect(result).toContain('Custom info about treatments.');
  });

  it('shows default booking link when no services', () => {
    const result = buildClinicData({
      ...baseParams,
      defaultBookingLink: 'https://book.example.com',
    });
    expect(result).toContain('Default booking link: https://book.example.com');
  });
});
