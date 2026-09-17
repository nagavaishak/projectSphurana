import { defineCoverage } from '../coverage.types.js';

/**
 * VENUE — 6 endpoints, 0 tools. A venue IS a location: this controller owns the
 * public-facing face of one — its "about" copy, amenities and slug, plus the
 * photo gallery shown on the booking page.
 *
 * The split here is unusually clean, because five of the six routes are about
 * IMAGES and Claire cannot see. She has no file handle to upload one, no eyes
 * to judge which shot should be the cover, and no way to know what she would be
 * destroying. The sixth — the venue's written description and amenity list — is
 * marketing prose, which is squarely the thing she is good at, so it is parked
 * for a decision rather than refused.
 */
export const venueCoverage = defineCoverage('venue', {
  // ---- reads -------------------------------------------------------------
  // Knowing which photos exist (and which is the cover) is context for the
  // social/graphics tools, which currently source imagery elsewhere entirely.
  'GET /venue/photos': { undecided: 'ENG-CLAIRE-VENUE-READ' },

  // ---- writes ------------------------------------------------------------
  // Venue "about" copy, amenities and slug — customer-facing marketing text of
  // exactly the kind Claire drafts elsewhere. If exposed it wants
  // `confirm: true`: the slug is part of the public booking URL.
  'PUT /venue/:locationId': { undecided: 'ENG-CLAIRE-VENUE-WRITE' },

  'POST /venue/photos': {
    notExposed:
      'Registers a gallery image that the browser has already uploaded to storage, so the payload is a URL the upload widget produced. Claire holds no file and can obtain no such URL, which makes this a UI continuation step rather than a capability.',
  },
  'POST /venue/photos/reorder': {
    notExposed:
      'Sets the display order of the public gallery from the complete ordered id array a drag-and-drop grid produces. It is a purely visual judgement about photographs Claire cannot see, and a wrong order is immediately live on the booking page.',
  },
  'POST /venue/photos/cover': {
    notExposed:
      'Chooses the hero image for the public booking page. Picking the most flattering shot of a salon is a visual decision made by looking at the photos — Claire only has filenames, so any choice she made would be arbitrary and publicly visible.',
  },
  'DELETE /venue/photos/:id': {
    notExposed:
      'Removes a photo from the venue gallery permanently. Claire cannot see the image she would be deleting, and the owner may hold no other copy — an unrecoverable loss decided on no evidence.',
  },
});
