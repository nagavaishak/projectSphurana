import { defineCoverage } from '../coverage.types.js';

/**
 * AI-CONTENT — 3 endpoints, 1 tool. Three LLM copy generators. All three are
 * POSTs, but none of them persists anything: they take a brief and return text.
 * So the usual "writes lean not exposed" default is the wrong lens — the real
 * question is which generator Claire should be routed through, because more
 * than one path to the same copy is how a model picks the wrong one.
 *
 * The generic generator is exposed (it backs post captions and ad copy). The
 * two offer-specific generators are not, because Claire's offer path already
 * runs through the `claire_setPendingOffer*` draft tools, which keep the copy in
 * a reviewable draft the owner can see and edit rather than handing back
 * free-floating text with no home.
 */
export const aiContentCoverage = defineCoverage('ai-content', {
  'POST /ai-content/generate': {
    exposed: 'social_posts_generatePostCaption',
    confirm: false,
  },

  'POST /ai-content/generate-offer-content': {
    notExposed:
      'Offer name and description generation. Claire composes offers through the claire_setPendingOffer* draft tools, which land the copy in a preview the owner approves before anything publishes; a second generator returning bare strings gives her text with nowhere to put it.',
  },
  'POST /ai-content/generate-offer-copy': {
    notExposed:
      "Generates the video-copy bundle (headline, CTA, urgency, bullets) for the create-video offer step. It is wired to the video wizard, which supplies the offer id and renders each field into the template; Claire's video path uses videos_generateVideoScript instead.",
  },
});
