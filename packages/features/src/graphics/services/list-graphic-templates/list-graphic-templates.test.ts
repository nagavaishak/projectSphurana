import { describe, expect, it } from '@borradh-workspace/testing';
import {
  DECK_BRIEFS,
  SINGLE_BRIEFS,
} from '../../../image-generation/carousel-templates/index.js';
import { ErrorCodes } from '../../../shared/index.js';
import { listGraphicTemplates } from './list-graphic-templates.service.js';

describe('listGraphicTemplates', () => {
  it('offers BRIEFS for organic work, of both kinds', async () => {
    const result = await listGraphicTemplates();

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.templates).toHaveLength(
      DECK_BRIEFS.length + SINGLE_BRIEFS.length
    );

    // Every summary carries what the picker needs and tags its kind.
    for (const t of result.data.templates) {
      expect(t.slug).toBeTruthy();
      expect(t.label).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(['single', 'carousel']).toContain(t.kind);
    }

    const bySlug = new Map(result.data.templates.map((t) => [t.slug, t]));
    expect(bySlug.get('living-with-it')?.kind).toBe('carousel');
    expect(bySlug.get('one-myth-corrected')?.kind).toBe('single');

    // Composition templates are not offered for organic work. They were, and
    // the choice was collected, stored and then superseded by a brief before
    // the deck was built — a picker showing options the renderer ignores.
    expect(bySlug.has('clearskin-blackwhite')).toBe(false);
    expect(bySlug.has('stat-serif-centered')).toBe(false);
  });

  it('filters the ad pool to offer templates only', async () => {
    const result = await listGraphicTemplates({ usageType: 'ad' });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.templates.length).toBeGreaterThan(0);
    for (const t of result.data.templates) {
      // No ad carousels exist — the ad pool is all singles.
      expect(t.kind).toBe('single');
    }
    expect(
      result.data.templates.some((t) => t.slug === 'offer-benefits-split')
    ).toBe(true);
  });

  it('returns VALIDATION_ERROR for an unknown usageType', async () => {
    const result = await listGraphicTemplates({
      usageType: 'video' as never,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
