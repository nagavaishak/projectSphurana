import {
  parseJsonResponse,
  safeGet,
  safeGetStringArray,
} from '@borradh-workspace/ai';
import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import {
  buildAnalysisPrompt,
  parseAnalysisResponse,
  resolveScanSections,
} from './ai-analysis.js';
import { analysisSectionValues } from './analyze-website.schema.js';

const mockParseJsonResponse = vi.mocked(parseJsonResponse);

// `safeGet` / `safeGetStringArray` are pure transformation helpers that
// `parseAnalysisResponse` calls internally; restore their real-ish behaviour
// on the canonical (behaviour-free) AI mock before each test.
beforeEach(() => {
  vi.mocked(safeGet).mockImplementation(
    (obj: Record<string, unknown>, key: string, fallback: string) =>
      typeof obj[key] === 'string' ? obj[key] : fallback
  );
  vi.mocked(safeGetStringArray).mockImplementation(
    (obj: Record<string, unknown>, key: string, _max: number) =>
      Array.isArray(obj[key]) ? obj[key] : []
  );
});

describe('buildAnalysisPrompt', () => {
  it('includes website text', () => {
    const prompt = buildAnalysisPrompt('Website content here');
    expect(prompt).toContain('Website content here');
  });

  it('includes facebook text when provided', () => {
    const prompt = buildAnalysisPrompt('Website', 'Facebook data');
    expect(prompt).toContain('Facebook page content:\nFacebook data');
  });

  it('includes extracted colors when provided', () => {
    const prompt = buildAnalysisPrompt('Website', undefined, [
      '#ff0000',
      '#00ff00',
    ]);
    expect(prompt).toContain('#ff0000, #00ff00');
  });

  it('includes JSON-LD locations when provided', () => {
    const prompt = buildAnalysisPrompt(
      'Website',
      undefined,
      undefined,
      'Structured data location: Dublin'
    );
    expect(prompt).toContain('Structured location data found:');
    expect(prompt).toContain('Dublin');
  });

  it('includes location page text', () => {
    const prompt = buildAnalysisPrompt(
      'Website',
      undefined,
      undefined,
      undefined,
      'Location page text here'
    );
    expect(prompt).toContain('Location/contact page content:');
    expect(prompt).toContain('Location page text here');
  });

  it('includes team page text', () => {
    const prompt = buildAnalysisPrompt(
      'Website',
      undefined,
      undefined,
      undefined,
      undefined,
      'Team page text'
    );
    expect(prompt).toContain('Team/about page content:');
  });

  it('includes subpage texts', () => {
    const prompt = buildAnalysisPrompt(
      'Website',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'Subpage text'
    );
    expect(prompt).toContain('Additional website pages:');
  });

  it('includes booking system text', () => {
    const prompt = buildAnalysisPrompt(
      'Website',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'Booking content'
    );
    expect(prompt).toContain('Booking system page content');
    expect(prompt).toContain('Booking content');
  });

  it('omits optional sections when not provided', () => {
    const prompt = buildAnalysisPrompt('Website only');
    expect(prompt).not.toContain('Facebook page content');
    expect(prompt).not.toContain('Colors found');
    expect(prompt).not.toContain('Structured location data');
    expect(prompt).not.toContain('Location/contact page');
    expect(prompt).not.toContain('Team/about page');
    expect(prompt).not.toContain('Additional website pages');
    expect(prompt).not.toContain('Booking system');
  });

  it('contains JSON response instructions', () => {
    const prompt = buildAnalysisPrompt('Test');
    expect(prompt).toContain('"services"');
    expect(prompt).toContain('"targetAudienceDescription"');
    expect(prompt).toContain('"brandVoice"');
    expect(prompt).toContain('"primaryColor"');
    expect(prompt).toContain('"locations"');
    expect(prompt).toContain('"practitioners"');
    expect(prompt).toContain('Return ONLY valid JSON');
  });

  it('bounds crawled source material while retaining curated service evidence', () => {
    const oversized = 'x'.repeat(200_000);
    const prompt = buildAnalysisPrompt(
      oversized,
      oversized,
      undefined,
      oversized,
      oversized,
      oversized,
      oversized,
      oversized,
      oversized,
      'CURATED SERVICE: Laser Facial — £120\n'.repeat(2_000)
    );

    // The prior implementation forwarded every source verbatim. This proves a
    // pathological crawl cannot create an unbounded OpenAI request anymore.
    expect(prompt.length).toBeLessThan(110_000);
    expect(prompt).toContain('CURATED SERVICE: Laser Facial');
    expect(prompt).toContain('remaining content was omitted');
  });
});

describe('parseAnalysisResponse', () => {
  it('parses a complete valid response', () => {
    mockParseJsonResponse.mockReturnValueOnce({
      success: true,
      data: {
        services: [
          { name: 'Botox', pricingDescription: 'From £200' },
          { name: 'Facial' },
        ],
        targetAudienceDescription: 'Women 30-55',
        brandVoice: ['professional', 'warm'],
        suggestedCredibilityLines: ['Award-winning'],
        primaryColor: '#ff0000',
        secondaryColor: '#f0f0f0',
        locations: [
          {
            addressLine1: '123 Main St',
            city: 'Dublin',
            country: 'IE',
          },
        ],
        businessHours: {
          '1': { from: 540, to: 1020 },
          '2': { from: 540, to: 1020 },
        },
        practitioners: [{ name: 'Dr. Smith', title: 'Clinic Director' }],
      },
    });

    const result = parseAnalysisResponse('{}', 'https://logo.png');
    expect(result.services).toHaveLength(2);
    expect(result.services[0].name).toBe('Botox');
    expect(result.services[0].pricingDescription).toBe('From £200');
    expect(result.targetAudienceDescription).toBe('Women 30-55');
    expect(result.brandVoice).toEqual(['professional', 'warm']);
    expect(result.primaryColor).toBe('#ff0000');
    expect(result.logoUrl).toBe('https://logo.png');
    expect(result.locations).toHaveLength(1);
    expect(result.locations?.[0].country).toBe('ie'); // lowercased
    expect(result.businessHours).toEqual({
      '1': { from: 540, to: 1020 },
      '2': { from: 540, to: 1020 },
    });
    expect(result.practitioners).toHaveLength(1);
    expect(result.practitioners?.[0].name).toBe('Dr. Smith');
  });

  it('throws when JSON parsing fails', () => {
    mockParseJsonResponse.mockReturnValueOnce({
      success: false,
      data: null,
    });

    expect(() => parseAnalysisResponse('not json', null)).toThrow(
      'Failed to parse AI response as JSON'
    );
  });

  it('handles string-only services (legacy format)', () => {
    mockParseJsonResponse.mockReturnValueOnce({
      success: true,
      data: {
        services: ['Botox', 'Fillers'],
        targetAudienceDescription: 'Customers',
        brandVoice: [],
        suggestedCredibilityLines: [],
      },
    });

    const result = parseAnalysisResponse('{}', null);
    expect(result.services).toEqual([{ name: 'Botox' }, { name: 'Fillers' }]);
  });

  it('filters out services with empty names', () => {
    mockParseJsonResponse.mockReturnValueOnce({
      success: true,
      data: {
        services: [{ name: 'Botox' }, { name: '' }, { name: '  ' }, null, 42],
        targetAudienceDescription: '',
        brandVoice: [],
        suggestedCredibilityLines: [],
      },
    });

    const result = parseAnalysisResponse('{}', null);
    expect(result.services).toHaveLength(1);
    expect(result.services[0].name).toBe('Botox');
  });

  it('filters out locations missing addressLine1 or city', () => {
    mockParseJsonResponse.mockReturnValueOnce({
      success: true,
      data: {
        services: [],
        targetAudienceDescription: '',
        brandVoice: [],
        suggestedCredibilityLines: [],
        locations: [
          { addressLine1: '123 Main', city: 'Dublin', country: 'ie' },
          { addressLine1: '', city: 'Cork', country: 'ie' },
          { addressLine1: '456 Elm', city: '', country: 'ie' },
          { city: 'Galway' }, // missing addressLine1 entirely
        ],
      },
    });

    const result = parseAnalysisResponse('{}', null);
    expect(result.locations).toHaveLength(1);
    expect(result.locations?.[0].city).toBe('Dublin');
  });

  it('validates business hours range', () => {
    mockParseJsonResponse.mockReturnValueOnce({
      success: true,
      data: {
        services: [],
        targetAudienceDescription: '',
        brandVoice: [],
        suggestedCredibilityLines: [],
        businessHours: {
          '1': { from: 540, to: 1020 }, // valid
          '7': { from: 540, to: 1020 }, // invalid key (>6)
          '2': { from: 1020, to: 540 }, // invalid (from > to)
          '3': { from: -1, to: 1020 }, // invalid (negative)
          '4': { from: 540, to: 1500 }, // invalid (>1440)
        },
      },
    });

    const result = parseAnalysisResponse('{}', null);
    expect(result.businessHours).toEqual({
      '1': { from: 540, to: 1020 },
    });
  });

  it('returns undefined for businessHours when none are valid', () => {
    mockParseJsonResponse.mockReturnValueOnce({
      success: true,
      data: {
        services: [],
        targetAudienceDescription: '',
        brandVoice: [],
        suggestedCredibilityLines: [],
        businessHours: { '7': { from: 0, to: 100 } },
      },
    });

    const result = parseAnalysisResponse('{}', null);
    expect(result.businessHours).toBeUndefined();
  });

  it('filters out practitioners with empty names', () => {
    mockParseJsonResponse.mockReturnValueOnce({
      success: true,
      data: {
        services: [],
        targetAudienceDescription: '',
        brandVoice: [],
        suggestedCredibilityLines: [],
        practitioners: [
          { name: 'Dr. Smith', title: 'Director' },
          { name: '', title: 'Nurse' },
          { name: '  ' },
          null,
        ],
      },
    });

    const result = parseAnalysisResponse('{}', null);
    expect(result.practitioners).toHaveLength(1);
    expect(result.practitioners?.[0].name).toBe('Dr. Smith');
  });

  it('uses fallback values for missing fields', () => {
    mockParseJsonResponse.mockReturnValueOnce({
      success: true,
      data: {},
    });

    const result = parseAnalysisResponse('{}', null);
    expect(result.targetAudienceDescription).toBe(
      'Your ideal customers seeking quality services.'
    );
    expect(result.primaryColor).toBe('#7c3aed');
    expect(result.secondaryColor).toBe('#f5f5f5');
    expect(result.services).toEqual([]);
    expect(result.locations).toEqual([]);
    expect(result.practitioners).toEqual([]);
    expect(result.logoUrl).toBeNull();
  });

  it('omits pricingDescription when empty string', () => {
    mockParseJsonResponse.mockReturnValueOnce({
      success: true,
      data: {
        services: [{ name: 'Botox', pricingDescription: '' }],
        targetAudienceDescription: '',
        brandVoice: [],
        suggestedCredibilityLines: [],
      },
    });

    const result = parseAnalysisResponse('{}', null);
    expect(result.services[0]).toEqual({ name: 'Botox' });
    expect(result.services[0]).not.toHaveProperty('pricingDescription');
  });
});

describe('scan scoping', () => {
  describe('resolveScanSections', () => {
    it('defaults to every section', () => {
      // Order is the prompt's, not the vocabulary's — compare as sets.
      expect([...resolveScanSections()].sort()).toEqual(
        [...analysisSectionValues].sort()
      );
    });

    it('pulls services in whenever packages are asked for', () => {
      // A package names its items by service name; without services those
      // items could never resolve, so the bundle would always be blocked.
      expect(resolveScanSections(['packages'])).toEqual([
        'services',
        'packages',
      ]);
    });

    it('keeps a narrow request narrow', () => {
      expect(resolveScanSections(['hours'])).toEqual(['hours']);
    });
  });

  describe('buildAnalysisPrompt', () => {
    it('asks only for the requested sections', () => {
      const prompt = buildAnalysisPrompt(
        'Website',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ['hours']
      );

      expect(prompt).toContain('"businessHours"');
      // A prompt that never mentions packages cannot hallucinate one.
      expect(prompt).not.toContain('"packages"');
      expect(prompt).not.toContain('"practitioners"');
      expect(prompt).not.toContain('"primaryColor"');
    });

    it('numbers the blocks it does include with no gaps', () => {
      const prompt = buildAnalysisPrompt(
        'Website',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ['hours', 'team']
      );

      expect(prompt).toContain('1. "businessHours"');
      expect(prompt).toContain('2. "practitioners"');
      expect(prompt).not.toContain('3. ');
    });

    it('drops the colour hint when brand was not requested', () => {
      const prompt = buildAnalysisPrompt(
        'Website',
        undefined,
        ['#ff0000'],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ['services']
      );

      expect(prompt).not.toContain('#ff0000');
    });
  });

  describe('parseAnalysisResponse', () => {
    it('extracts the venue description, packages and staff emails', () => {
      mockParseJsonResponse.mockReturnValueOnce({
        success: true,
        data: {
          services: [{ name: 'Laser' }],
          targetAudienceDescription: 'Women 30-55',
          businessDescription: '  A calm clinic in the city centre.  ',
          brandVoice: [],
          suggestedCredibilityLines: [],
          practitioners: [
            { name: 'Aoife', email: 'AOIFE@Clinic.ie' },
            { name: 'Niamh', email: 'not-an-email' },
          ],
          packages: [
            {
              name: 'Course of 6',
              priceAmount: 1425,
              serviceNames: ['Laser'],
              validityDays: 365,
            },
          ],
        },
      });

      const result = parseAnalysisResponse('{}', null);

      expect(result.businessDescription).toBe(
        'A calm clinic in the city centre.'
      );
      expect(result.practitioners[0].email).toBe('aoife@clinic.ie');
      // An unusable address is dropped so apply falls back to its placeholder.
      expect(result.practitioners[1].email).toBeUndefined();
      expect(result.packages).toEqual([
        {
          name: 'Course of 6',
          description: undefined,
          priceAmount: 1425,
          serviceNames: ['Laser'],
          validityDays: 365,
        },
      ]);
    });

    it('drops a package with no price or no items', () => {
      mockParseJsonResponse.mockReturnValueOnce({
        success: true,
        data: {
          services: [],
          targetAudienceDescription: '',
          brandVoice: [],
          suggestedCredibilityLines: [],
          packages: [
            { name: 'No price', serviceNames: ['Laser'] },
            { name: 'No items', priceAmount: 100, serviceNames: [] },
          ],
        },
      });

      expect(parseAnalysisResponse('{}', null).packages).toEqual([]);
    });

    it('omits the description rather than inventing one', () => {
      mockParseJsonResponse.mockReturnValueOnce({
        success: true,
        data: {
          services: [],
          targetAudienceDescription: '',
          businessDescription: '   ',
          brandVoice: [],
          suggestedCredibilityLines: [],
        },
      });

      expect(
        parseAnalysisResponse('{}', null).businessDescription
      ).toBeUndefined();
    });

    it('never fabricates brand defaults for a scan that skipped brand', () => {
      mockParseJsonResponse.mockReturnValue({
        success: true,
        data: { services: [{ name: 'Laser' }] },
      });

      const scoped = parseAnalysisResponse(
        '{}',
        'https://logo.png',
        undefined,
        ['services']
      );

      // The hard-coded purple/grey are right when we ASKED and got nothing —
      // they would be a fabrication when we never asked.
      expect(scoped.primaryColor).toBeUndefined();
      expect(scoped.secondaryColor).toBeUndefined();
      expect(scoped.targetAudienceDescription).toBe('');
      expect(scoped.brandVoice).toEqual([]);
      expect(scoped.logoUrl).toBeNull();

      const full = parseAnalysisResponse('{}', 'https://logo.png');
      expect(full.primaryColor).toBe('#7c3aed');
      expect(full.logoUrl).toBe('https://logo.png');
    });
  });
});
