import type { VideoDraftConfig } from '@borradh-workspace/database';
import { describe, expect, it } from '@borradh-workspace/testing';
import { templateDocSchema } from '@borradh-workspace/video-templates';

import { convertEducational } from './convert-educational.service.js';

// Representative v1 educational draftConfig fixtures. educational-{1,2,3} are
// text-only (narrationMode: 'text_only') — no talking head, no AI voice. They
// share an outro card carrying brand identity, plus a free-form scriptText
// with hook + body + (disclaimer | cta) lines that wave-7 freezes through.

function fixtureOutro() {
  return {
    logoUrl: 'https://cdn.example.com/logo.png',
    businessName: 'Cosmetic Clinic',
    ctaText: 'Book a consultation',
    backgroundOpacity: 0.9,
    backgroundColor: '#0066FF',
    textColor: '#FFFFFF',
    durationSec: 3,
  };
}

function fixtureDraftConfig(
  scriptText: string,
  overrides: Partial<VideoDraftConfig> = {}
): VideoDraftConfig {
  return {
    scriptText,
    narrationType: 'text_only',
    talkingHeadAssetId: null,
    talkingHeadUrl: null,
    bRollClips: [
      { assetId: 'asset-procedure-1', order: 1, clipType: 'bRoll' },
      { assetId: 'asset-procedure-2', order: 2, clipType: 'bRoll' },
    ],
    captions: {
      enabled: false,
      position: 'bottom',
      fontFamily: 'Inter',
      fontSize: 48,
      textColor: '#FFFFFF',
      highlightColor: '#00FF00',
      backgroundColor: '#000000',
      showBackground: false,
    },
    musicTrackId: 'tea-pop',
    musicUrl: 'https://cdn.example.com/audio/tea-pop.mp3',
    musicVolume: 0.5,
    outro: fixtureOutro(),
    orientation: 'portrait',
    ...overrides,
  };
}

describe('convertEducational', () => {
  // v1 educational-1 ("Q&A / Association") script template:
  //   "Struggling with [PAIN POINT]?
  //    [SERVICE NAME] → helps improve [RESULT / OUTCOME]
  //    Results vary • Consultation required
  //    DM to Learn More"
  const ed1Script = [
    'Struggling with dental sensitivity?',
    'Teeth Whitening → helps improve enamel comfort',
    'Results vary • Consultation required',
    'DM to Learn More',
  ].join('\n');

  // v1 educational-2 ("Common Doubts / Worries"):
  //   "Is [SERVICE NAME] actually effective?
  //    Helps with [PAIN POINT / RESULT A]
  //    Can improve [PAIN POINT / RESULT B]
  //    Often used for [PAIN POINT / RESULT C]
  //    Consultation required • Results vary"
  const ed2Script = [
    'Is teeth whitening actually effective?',
    'Helps with discolouration',
    'Can improve enamel-safe brightness',
    'Often used for confidence boosting',
    'Consultation required • Results vary',
  ].join('\n');

  // v1 educational-3 ("How It Works"):
  //   "[SERVICE NAME] is commonly used to help target [PAIN POINT 1] and [PAIN POINT 2].
  //    The treatment works by [HIGH-LEVEL PROCESS]
  //    Helps support [RESULT TYPE] over time
  //    Consultation required • Results vary
  //    DM to Learn More"
  const ed3Script = [
    'Teeth whitening is commonly used to help target discolouration and dullness.',
    'The treatment works by lifting surface stains gently.',
    'Helps support whiter results over time.',
    'Consultation required • Results vary',
    'DM to Learn More',
  ].join('\n');

  it.each([
    ['educational-1', ed1Script],
    ['educational-2', ed2Script],
    ['educational-3', ed3Script],
  ] as const)(
    'returns a TemplateDoc that parses against templateDocSchema (%s)',
    (variationId, script) => {
      const result = convertEducational(
        variationId,
        fixtureDraftConfig(script)
      );
      const parsed = templateDocSchema.safeParse(result.templateDoc);
      if (!parsed.success) {
        throw new Error(
          `templateDocSchema rejected converted ${variationId}: ${JSON.stringify(
            parsed.error.issues,
            null,
            2
          )}`
        );
      }
      expect(parsed.success).toBe(true);
      expect(result.templateId).toBe(variationId);
    }
  );

  it('extracts primary + onPrimary colours from outro', () => {
    const result = convertEducational(
      'educational-1',
      fixtureDraftConfig(ed1Script)
    );
    expect(result.brandFieldsForTheme.colors?.primary).toBe('#0066FF');
    expect(result.brandFieldsForTheme.colors?.onPrimary).toBe('#FFFFFF');
  });

  it('extracts logo URL from outro.logoUrl as the light logo variant', () => {
    const result = convertEducational(
      'educational-2',
      fixtureDraftConfig(ed2Script)
    );
    expect(result.brandFieldsForTheme.logo?.light).toBe(
      'https://cdn.example.com/logo.png'
    );
  });

  it('extracts business name + CTA text into identity', () => {
    const result = convertEducational(
      'educational-3',
      fixtureDraftConfig(ed3Script)
    );
    expect(result.brandFieldsForTheme.identity?.businessName).toBe(
      'Cosmetic Clinic'
    );
    expect(result.brandFieldsForTheme.identity?.ctaText).toBe(
      'Book a consultation'
    );
  });

  it('preserves musicTrackId + musicVolume as per-video overrides', () => {
    const result = convertEducational(
      'educational-1',
      fixtureDraftConfig(ed1Script)
    );
    expect(result.themeOverridesForVideo?.musicTrackId).toBe('tea-pop');
    expect(result.themeOverridesForVideo?.musicVolume).toBe(0.5);
  });

  it('parses the v1 script into hook/body/disclaimer/cta roles (educational-1)', () => {
    const result = convertEducational(
      'educational-1',
      fixtureDraftConfig(ed1Script)
    );
    expect(result.frozenScript?.hook).toBe(
      'Struggling with dental sensitivity?'
    );
    expect(result.frozenScript?.body).toEqual([
      'Teeth Whitening → helps improve enamel comfort',
    ]);
    expect(result.frozenScript?.disclaimer).toBe(
      'Results vary • Consultation required'
    );
    expect(result.frozenScript?.cta).toBe('DM to Learn More');
  });

  it('parses the rebuttal-stack script (educational-2) — three body lines, disclaimer, no CTA', () => {
    const result = convertEducational(
      'educational-2',
      fixtureDraftConfig(ed2Script)
    );
    expect(result.frozenScript?.hook).toBe(
      'Is teeth whitening actually effective?'
    );
    expect(result.frozenScript?.body).toEqual([
      'Helps with discolouration',
      'Can improve enamel-safe brightness',
      'Often used for confidence boosting',
    ]);
    expect(result.frozenScript?.disclaimer).toBe(
      'Consultation required • Results vary'
    );
    expect(result.frozenScript?.cta).toBeUndefined();
  });

  it('parses the walkthrough script (educational-3) — hook + 2 body + disclaimer + cta', () => {
    const result = convertEducational(
      'educational-3',
      fixtureDraftConfig(ed3Script)
    );
    expect(result.frozenScript?.hook).toContain('commonly used');
    expect(result.frozenScript?.body).toEqual([
      'The treatment works by lifting surface stains gently.',
      'Helps support whiter results over time.',
    ]);
    expect(result.frozenScript?.disclaimer).toBe(
      'Consultation required • Results vary'
    );
    expect(result.frozenScript?.cta).toBe('DM to Learn More');
  });

  it('skips brand fields when v1 outro values are missing', () => {
    const result = convertEducational(
      'educational-1',
      fixtureDraftConfig(ed1Script, {
        outro: {
          businessName: '',
          ctaText: '',
          backgroundOpacity: 0.9,
          backgroundColor: 'not-a-color',
          textColor: '',
          durationSec: 3,
        },
      })
    );
    expect(result.brandFieldsForTheme.colors).toBeUndefined();
    expect(result.brandFieldsForTheme.identity).toBeUndefined();
    expect(result.brandFieldsForTheme.logo).toBeUndefined();
  });

  it('returns undefined frozenScript when scriptText is empty', () => {
    const result = convertEducational('educational-1', fixtureDraftConfig(''));
    expect(result.frozenScript).toBeUndefined();
  });

  it('falls back to body when no disclaimer/cta keywords match', () => {
    const script = [
      'A quirky hand-edited hook line',
      'A middle line about something specific',
      'Another middle line',
    ].join('\n');
    const result = convertEducational(
      'educational-1',
      fixtureDraftConfig(script)
    );
    expect(result.frozenScript?.hook).toBe('A quirky hand-edited hook line');
    expect(result.frozenScript?.body).toEqual([
      'A middle line about something specific',
      'Another middle line',
    ]);
    expect(result.frozenScript?.disclaimer).toBeUndefined();
    expect(result.frozenScript?.cta).toBeUndefined();
  });

  it("returns the correct templateId for the variation it's called with", () => {
    expect(
      convertEducational('educational-1', fixtureDraftConfig(ed1Script))
        .templateId
    ).toBe('educational-1');
    expect(
      convertEducational('educational-2', fixtureDraftConfig(ed2Script))
        .templateId
    ).toBe('educational-2');
    expect(
      convertEducational('educational-3', fixtureDraftConfig(ed3Script))
        .templateId
    ).toBe('educational-3');
  });
});
