import { defineCoverage } from '../coverage.types.js';

/**
 * FACE-GROUPS — 6 endpoints, 0 tools. Rekognition clusters over uploaded client
 * photographs: the system groups images it believes show the same face, and the
 * operator labels each asset `before` or `after` so the video and graphic
 * templates can pair them.
 *
 * This is the one area in the batch where the GET default is overridden across
 * the board, and the reason is the same for every route: the payload is
 * biometric. A face group IS an assertion that these photographs depict one
 * identifiable person, and the asset reads additionally resolve signed URLs to
 * the images themselves. Pulling that into a chat transcript — which is stored,
 * summarised into memory, and shipped to a model provider — is a category of
 * data we should not move for convenience, and Claire gains nothing: she never
 * picks the photos, the video tools take assets by id.
 *
 * The writes compound it. Each one asserts an identity or a clinical claim: that
 * two photos are the same client, or that this image is the "after". Get the
 * roles backwards and the org publishes a reversed before/after — a misleading
 * result claim about a real patient, which is precisely what the hard-block
 * rules elsewhere exist to prevent.
 */
export const faceGroupsCoverage = defineCoverage('face-groups', {
  // ---- reads -------------------------------------------------------------
  'GET /face-groups': {
    notExposed:
      'Face-recognition clusters of identifiable client photographs. Biometric groupings are not data to pull into a chat transcript that gets stored, summarised into memory and sent to a model provider, and Claire never selects photos herself.',
  },
  'GET /face-groups/:groupId/assets': {
    notExposed:
      'Returns the grouped photographs with signed image URLs resolved. Same biometric concern as the list, plus it hands out live links to client images that outlive the turn.',
  },
  'GET /face-groups/batch/:batchId': {
    notExposed:
      'Every face cluster in an upload batch, images and all. The heaviest read in the area and the same identifiable-client payload — the review UI is built to show these to the operator who took the photos.',
  },

  // ---- writes ------------------------------------------------------------
  'PUT /face-groups/:groupId': {
    notExposed:
      "Names or confirms a cluster, which asserts that a set of photographs depicts one specific person. That identification is a human judgement about a real client, and a wrong merge mixes two people's images into one marketing asset.",
  },
  'PUT /face-groups/:groupId/assets/:assetId/role': {
    notExposed:
      'Sets an image as the before or the after. Swapping them produces a reversed before/after in published marketing — a fabricated result claim about a real patient, the exact thing the ad hard-blocks exist to stop.',
  },
  'POST /face-groups/manual-pair': {
    notExposed:
      'Manually asserts that two photographs are the same client, overriding the recogniser. It is the highest-confidence identity claim in the system and it is made precisely when the machine was unsure.',
  },
});
