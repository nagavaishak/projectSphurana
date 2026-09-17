import { describe, expect, it } from 'vitest';
import type { VisionApiResponse } from './types.js';
import { deriveMatchedServices } from './vision-analysis.service.js';

/**
 * These cases are taken from real prod data.
 *
 * The old prompt asked which services an asset "likely relates to" and linked
 * every match >= 0.5, unbounded. That produced 1,957 AI links (96.6% of all
 * asset->service links), 213 video assets claiming two or more treatments and
 * one claiming six unrelated modalities — which is how a glow-peel script ends
 * up over laser footage.
 *
 * The replacement asks what the asset DEPICTS: one service, plus variants that
 * are genuinely the same procedure, with abstention allowed.
 */
const base = (over: Partial<VisionApiResponse>): VisionApiResponse => ({
  description: 'a treatment',
  contentType: 'procedure',
  matchedServices: [],
  suggestedTags: [],
  ...over,
});

describe('deriveMatchedServices', () => {
  it('keeps a legitimate same-procedure family together', () => {
    // Prod asset 0492e14f: anti-wrinkle one/two/three areas. These differ only
    // by treated area, so one clip legitimately serves all of them — the
    // "Botox is also Facial Injectables" case that must NOT be broken.
    const result = deriveMatchedServices(
      base({
        serviceIdentification: {
          serviceName: 'Anti-wrinkle Treatment (one area)',
          confidence: 0.9,
          alsoValidFor: [
            'Anti-wrinkle Treatment (two areas)',
            'Anti-wrinkle Treatment (three areas)',
          ],
        },
      })
    );

    expect(result).toHaveLength(3);
    expect(result[0].serviceName).toBe('Anti-wrinkle Treatment (one area)');
    // Variants inherit the primary's confidence: they're asserted to be the
    // same procedure, so a lower score would be false precision.
    expect(result.every((r) => r.confidence === 0.9)).toBe(true);
  });

  it('writes no links when the model abstains', () => {
    // Previously impossible: the old prompt always returned something above
    // the 0.5 floor, so every asset got linked to something.
    const result = deriveMatchedServices(
      base({
        serviceIdentification: {
          serviceName: null,
          confidence: 0,
          alsoValidFor: [],
        },
      })
    );

    expect(result).toEqual([]);
  });

  it('writes no links for a designed asset', () => {
    // Prod had infographics ("statistics about Meniere's Disease") and posters
    // linked to services and cut into treatment videos as b-roll.
    const result = deriveMatchedServices(
      base({
        observation: {
          instrument: null,
          bodyArea: null,
          isRealFootage: false,
        },
        serviceIdentification: {
          serviceName: 'Hyperbaric Oxygen Therapy',
          confidence: 0.9,
          alsoValidFor: [],
        },
      })
    );

    expect(result).toEqual([]);
  });

  it('collapses a six-way grab bag to the one service depicted', () => {
    // Prod asset 8f3da6fc was linked to Red Light Bed, Infrared Sauna, Laser
    // Lipo, Lymphatic Compression, Oxygen Bar AND UV Tanning at 0.70-0.80.
    // One clip cannot show six modalities.
    const result = deriveMatchedServices(
      base({
        serviceIdentification: {
          serviceName: 'Infrared Sauna Session',
          confidence: 0.8,
          alsoValidFor: [],
        },
        matchedServices: [
          { serviceName: '15 min Red Light Therapy Bed', confidence: 0.7 },
          { serviceName: '30 min Infrared Sauna Session', confidence: 0.8 },
          { serviceName: 'InvisaRed Laser Lipo', confidence: 0.8 },
          { serviceName: 'Lymphatic Compression', confidence: 0.8 },
          { serviceName: 'Oxygen Bar', confidence: 0.8 },
          { serviceName: 'Platinum UV Tanning Session', confidence: 0.8 },
        ],
      })
    );

    // The identification wins over the legacy list entirely.
    expect(result).toHaveLength(1);
    expect(result[0].serviceName).toBe('Infrared Sauna Session');
  });

  it('drops a variant that duplicates the primary', () => {
    const result = deriveMatchedServices(
      base({
        serviceIdentification: {
          serviceName: 'Microneedling',
          confidence: 0.85,
          alsoValidFor: ['Microneedling', 'Microneedling with Profhilo'],
        },
      })
    );

    expect(result.map((r) => r.serviceName)).toEqual([
      'Microneedling',
      'Microneedling with Profhilo',
    ]);
  });

  it('falls back to the legacy shape when the model does not comply', () => {
    // A non-compliant response should degrade to the old behaviour rather than
    // silently losing all tagging.
    const result = deriveMatchedServices(
      base({
        matchedServices: [
          { serviceName: 'Chemical Peel', confidence: 0.9 },
          { serviceName: 'Too Low', confidence: 0.3 },
        ],
      })
    );

    expect(result).toHaveLength(1);
    expect(result[0].serviceName).toBe('Chemical Peel');
  });

  it('treats a missing isRealFootage flag as real', () => {
    // Only an explicit `false` should exclude an asset — a model that omits
    // the field must not silently strip legitimate footage.
    const result = deriveMatchedServices(
      base({
        observation: {
          instrument: 'syringe',
          bodyArea: 'lips',
          isRealFootage: true,
        },
        serviceIdentification: {
          serviceName: 'Lip Filler',
          confidence: 0.9,
          alsoValidFor: [],
        },
      })
    );

    expect(result).toHaveLength(1);
  });

  it('clamps an out-of-range confidence', () => {
    const result = deriveMatchedServices(
      base({
        serviceIdentification: {
          serviceName: 'Laser Hair Removal',
          confidence: 1.7,
          alsoValidFor: [],
        },
      })
    );

    expect(result[0].confidence).toBe(1);
  });
});
