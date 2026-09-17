import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * PRD-29 — edit an existing graphic.
 *
 * Generate-graphic skill, editing path: "make the lip filler graphic brighter"
 * → Claire FINDS the graphic with `listRecentGraphics`, then re-rolls it with
 * `regenerateGraphic` (template-pinned, refinement-aware). Same one-call
 * discipline as creation: no proposal turn, no status tool afterward — the
 * returned card auto-polls. Asserts the find→regenerate tool order.
 */
const fixture: ClaireFixture = {
  id: 'tool-dispatch-regenerate-graphic',
  description:
    'Generate-graphic editing path: "make the lip filler graphic brighter" finds the graphic via listRecentGraphics then re-rolls it via regenerateGraphic.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['generate-graphic'] },
  turns: [
    {
      userMessage: 'Make the lip filler graphic brighter.',
      expect: {
        toolsCalled: ['listRecentGraphics', 'regenerateGraphic'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'listRecentGraphics',
    respond: () => ({
      ok: true,
      data: {
        graphics: [
          {
            id: 'g-lip-1',
            title: 'Lip filler tips',
            status: 'ready',
            usageType: 'organic',
            kind: 'single',
            serviceId: 's-lip',
            topicSummary: 'Lip filler aftercare',
            aspectRatio: '4:5',
            thumbnailUrl: 'https://cdn/g-lip-1-thumb.png',
            imageUrl: 'https://cdn/g-lip-1.png',
            slideCount: 1,
            createdAt: '2026-06-10T00:00:00.000Z',
          },
        ],
        total: 1,
      },
    }),
  },
  {
    name: 'regenerateGraphic',
    respond: () => ({
      ok: true,
      data: {
        graphicId: 'g-lip-2',
        status: 'rendering',
        scope: 'all',
        uiState: 'created',
        title: 'Lip filler tips (edited)',
        message: 'Regenerating — it will appear in the card shortly.',
      },
    }),
  },
];

export default fixture;
