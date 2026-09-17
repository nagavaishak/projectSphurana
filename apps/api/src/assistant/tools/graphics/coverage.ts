import { defineCoverage } from '../coverage.types.js';

/**
 * GRAPHICS — 9 endpoints, 3 tools. Branded still images: offer cards, price
 * cards, ad creatives. A small area with a clean split, because generating a
 * graphic publishes nothing and spends nothing the owner can see — the render
 * lands in the library and waits to be used.
 *
 * That is why both generation routes run UNCONFIRMED. The considered act with a
 * graphic is posting it, and that decision lives in `social-posts` and
 * `meta-ads`, behind their own confirmations. Asking twice — once to draw a
 * picture, again to use it — trains an owner to click through confirmations
 * without reading them, which is how the one that mattered gets waved past.
 *
 * The organic and paid-ad graphics are two shapes of one entry point
 * into the same `POST /graphics/generate` route; the endpoint is declared once,
 * under the general-purpose tool.
 */
export const graphicsCoverage = defineCoverage('graphics', {
  // ---- reads -------------------------------------------------------------
  'GET /graphics': { exposed: 'context_listRecentGraphics' },

  'GET /graphics/:id': {
    notExposed:
      'No single-graphic read tool exists. context_listRecentGraphics returns the full row including render status and blob URL, so Claire reaches a graphic by listing it rather than by bare id.',
  },
  'GET /graphics/templates': {
    undecided: 'ENG-CLAIRE-GRAPHICS',
  },

  // ---- writes ------------------------------------------------------------
  'POST /graphics/generate': {
    exposed: 'content_createContent',
    confirm: false,
  },
  'POST /graphics/:id/regenerate': {
    notExposed:
      'Re-rolls a graphic, addressed by the IMAGE. Claire edits by the POST — content_patchContent takes an itemId and nothing else — so that the id she is handed is always the id an edit takes. Two addresses for one change is what produced a not-found on the wrong id, reported to an owner as the post being locked. The UI still calls this directly; it holds the graphic the owner is looking at.',
  },

  'PUT /graphics/:id': {
    undecided: 'ENG-CLAIRE-GRAPHICS',
  },
  'POST /graphics/:id/outputs/upload-url': {
    notExposed:
      'Hands the browser a presigned S3 key so the client-side canvas renderer can upload the image it just drew. Claire has no canvas and no bytes; a URL she requested would simply expire unused.',
  },
  'POST /graphics/:id/outputs/confirm': {
    notExposed:
      'The second half of that client-render handshake — it marks the uploaded object as the graphic\'s output. Calling it without having actually uploaded anything would flip a graphic to "ready" while pointing at a missing object.',
  },
  'DELETE /graphics/:id': {
    notExposed:
      'Deleting a graphic breaks any scheduled post or live ad creative still pointing at it, and the render cannot be reproduced byte-for-byte because generation is non-deterministic. Regenerating is the cheap, additive move Claire already has.',
  },
});
