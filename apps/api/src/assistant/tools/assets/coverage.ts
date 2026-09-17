import { defineCoverage } from '../coverage.types.js';

/**
 * ASSETS — 17 endpoints, 2 tools. The org's media library: uploaded photos and
 * clips, their probe/transcode state, their AI analysis, and the tag and
 * service links that make them findable.
 *
 * There is no `assets_*` tool and there deliberately isn't one — assets are
 * something Claire READS on the way to doing something else. Both tools that
 * touch this area are named for the job they serve, not the table:
 * `content_listMedia` picks clips for a render, and
 * `meta_ads_listLibraryImages` picks a creative for an ad. That is why the two
 * list routes below are exposed under video- and ads-shaped names.
 *
 * The writes are all upload-shaped or curation-shaped. Upload is a
 * multipart/presigned dance Claire cannot participate in: she has no file to
 * hand over, and `POST /assets` only registers a row against an object someone
 * else already put in S3. Curation (tags, service links, content type) is
 * plausibly hers and simply has no tool yet.
 */
export const assetsCoverage = defineCoverage('assets', {
  // ---- reads -------------------------------------------------------------
  'GET /assets': { exposed: 'content_listMedia' },
  'GET /assets/by-service/:serviceId': {
    exposed: 'meta_ads_listLibraryImages',
  },

  'GET /assets/:id': {
    notExposed:
      'No single-asset read tool exists. The list routes already return the full row, so Claire reaches an asset by listing rather than by id — she is never handed an id she did not just read. The ad and video tools do fetch one by id internally when validating a creative the owner named, but that is an implementation detail of those tools, not a capability of its own.',
  },
  'GET /assets/:id/analysis': {
    undecided: 'ENG-CLAIRE-ASSETS',
  },
  'GET /assets/batch/:batchId': {
    undecided: 'ENG-CLAIRE-ASSETS',
  },
  'GET /assets/bulk-status': {
    notExposed:
      'A polling route for the upload UI: it answers "has the analysis worker finished with these rows yet" for a batch the browser is watching. Claire has no upload in flight to watch, and every field it returns she can already read from the list routes without the polling semantics.',
  },

  // ---- writes: upload plumbing -------------------------------------------
  'POST /assets': {
    notExposed:
      'Registers an asset row against an object the presigned-upload flow has already put in S3. Claire holds no file and cannot drive that flow, so the row she created would point at nothing.',
  },
  'POST /assets/batch': {
    notExposed:
      'Same registration step for a multi-file upload, assembled by the dropzone from keys it just wrote. There is no payload Claire could construct that is not fabricated.',
  },
  'POST /assets/:id/reprobe': {
    notExposed:
      'A recovery hatch for assets whose ffprobe step failed — it resets probe state and re-enqueues the job. Diagnosing a stuck transcode needs the worker logs, not a conversation, and a blind re-probe usually re-fails identically.',
  },

  // ---- writes: curation --------------------------------------------------
  'POST /assets/:id/analyze': {
    undecided: 'ENG-CLAIRE-ASSETS',
  },
  'POST /assets/:id/tags': {
    undecided: 'ENG-CLAIRE-ASSETS',
  },
  'POST /assets/:id/services': {
    undecided: 'ENG-CLAIRE-ASSETS',
  },
  'PUT /assets/:id/content-type': {
    undecided: 'ENG-CLAIRE-ASSETS',
  },
  'PUT /assets/:id/tags': {
    notExposed:
      "Replaces an asset's whole tag set. The additive POST is the shape Claire would want if tagging is ever exposed; a wholesale replace from a partial view silently drops tags the owner set by hand in the library UI.",
  },
  'DELETE /assets/:id/tags': {
    notExposed:
      'Untagging is only useful next to tagging, and neither is exposed yet. Deciding the removal half before the add half exists would be settling a question nobody has asked.',
  },
  'DELETE /assets/:id/services': {
    notExposed:
      'Unlinking an asset from a service quietly changes what every future render and ad for that service can draw on. The failure is invisible until a video comes back with the wrong footage, so it stays a deliberate action in the library UI.',
  },
  'DELETE /assets/:id': {
    notExposed:
      'Deleting an asset breaks every video, graphic, and live ad creative that references it — including published ones, where the damage is public. Irreversible, and the blast radius is not visible from anything Claire can read first.',
  },
});
