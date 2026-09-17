import { defineCoverage } from '../coverage.types.js';

/**
 * VIDEOS — 28 endpoints, 13 tools. The largest content area, and the one where
 * the coverage decision splits cleanly along three seams rather than one.
 *
 * The controller serves three different audiences from one route prefix:
 *
 *   1. The DRAFT EDITOR — create a draft, patch its config, pick clips, pick
 *      music, generate a script, render it. This is Claire's half, and it is
 *      the half the `videos_*` tools cover end to end.
 *   2. The RENDER PIPELINE's own plumbing — synthesize, transcribe, retry,
 *      stock-clip minting, template preview. These exist because the editor UI
 *      needs a step to be re-runnable; they are not capabilities an owner would
 *      ever ask for by name.
 *   3. `/videos/admin/*` — DLQ inspection and orphaned-asset cleanup. Operator
 *      surface, not tenant surface.
 *
 * The one write that matters is `POST /videos/:id/export`: it spends render
 * budget and produces something the owner will publish. It is deliberately
 * one destructive tool — `content_renderVideo` asks and acts, the factory
 * holding the token between — so `confirm: true` here describes the
 * PAIR, not the `destructive` flag on either half (both are `false`, because
 * the factory's own confirmation machinery is bypassed by the split).
 */
export const videosCoverage = defineCoverage('videos', {
  // ---- reads: the draft editor ------------------------------------------
  'GET /videos': { exposed: 'context_listRecentVideos' },
  'GET /videos/:id': { exposed: 'videos_getVideoStatus' },
  'GET /videos/:id/job': { exposed: 'videos_getVideoStatus' },
  'GET /videos/:id/draft-clips': { exposed: 'videos_listDraftClips' },

  'GET /videos/in-progress': {
    notExposed:
      'A pre-filtered slice of the same rows context_listRecentVideos already returns, which accepts a status filter. Two tools reading one table is how a model picks the wrong one, and "in progress" is not a status an owner asks about by that name.',
  },
  'GET /videos/queue/status': {
    notExposed:
      "Global render-queue depth and worker health. An infrastructure signal with no organization scope at all — it tells Claire nothing about THIS owner's videos, and inviting her to relay queue depth would produce confident nonsense during an incident.",
  },
  'GET /videos/admin/dlq': {
    notExposed:
      "Dead-letter queue inspection across every tenant. Operator surface: the payloads carry other organizations' job data, so it must never be reachable from a tenant-scoped assistant.",
  },
  'GET /videos/admin/dlq/stats': {
    notExposed:
      'Cross-tenant failure counters for the on-call dashboard. Same containment reason as the DLQ listing, and no owner-facing question is answered by it.',
  },

  'GET /videos/:id/slots': {
    undecided: 'ENG-CLAIRE-VIDEOS',
  },
  'GET /videos/:id/validate': {
    undecided: 'ENG-CLAIRE-VIDEOS',
  },
  // One lister over both shelves — uploads and the curated bank are the same
  // question asked of two places, and splitting it produced "you'd need to
  // upload footage first" for orgs whose videos were already built from stock.
  'GET /videos/stock-clips': { exposed: 'content_listMedia' },

  // ---- writes: the draft editor -----------------------------------------
  // Everything on a draft is cheap and reversible until export, so the editor
  // writes run unconfirmed; the render does not.
  // One create for both kinds — see `content_createContent`. Splitting it by
  // asset kind gave three tools with three descriptions to keep in step, and
  // only one of them opened a content item.
  'POST /videos': { exposed: 'content_createContent', confirm: false },
  // Edits go through `content_patchContent`, addressed by the POST. This
  // endpoint takes a video id, which is the wrong handle after an edit forks
  // the video — the fork's id ends up somewhere only the browser can see.
  'PUT /videos/:id': {
    notExposed:
      "A draft-config write addressed by VIDEO id. Claire edits by the post: content_patchContent takes an itemId, sends the owner's words to the review-turn classifier, and stages anything that costs a render. A second edit path addressed by the asset is how an edit lands on a cut nobody is looking at.",
  },
  'PATCH /videos/:id/draft-config': {
    // Reached by `content_patchContent` through the videos port, once the
    // review-turn endpoint has decided that an on-screen text change is what
    // the owner asked for. Not a tool of its own: authoring the patch is the
    // step that kept going wrong — the template block has to be right, and the
    // caller has to know that "the caption" means the headline on a Caption
    // Tease and not the field called `caption` underneath it.
    exposed: 'content_patchContent',
    confirm: false,
  },
  'POST /videos/:id/draft-clips': {
    exposed: 'videos_autoSelectClips',
    confirm: false,
  },
  'POST /videos/generate-script': {
    exposed: 'videos_generateVideoScript',
    confirm: false,
  },
  'POST /videos/:id/export': {
    exposed: 'content_renderVideo',
    confirm: true,
  },
  'DELETE /videos/:id': { exposed: 'videos_deleteDraftVideo', confirm: true },

  // ---- writes: pipeline plumbing ----------------------------------------
  'PUT /videos/:id/draft-clips': {
    notExposed:
      'Replaces the whole clip list in one shot. The editor sends a full array it already holds; Claire builds clip selections incrementally through videos_autoSelectClips, and a wholesale replace from a partial model view would silently drop clips the owner picked by hand.',
  },
  'POST /videos/:id/clips': {
    notExposed:
      'The legacy pre-draft clip attachment path, superseded by the draft-clips routes the current editor and videos_autoSelectClips both use. Writing through both models of the same list is how drafts end up internally inconsistent.',
  },
  'POST /videos/:id/synthesize': {
    notExposed:
      'Re-runs template synthesis to rebuild draftConfig from scratch. It silently discards every manual edit made since the draft was created, which is fine as an explicit editor button and disastrous as something a model can decide to do mid-conversation.',
  },
  'POST /videos/:id/transcribe': {
    notExposed:
      'Kicks off caption transcription as part of the render pipeline; the export path already triggers it when captions are enabled. Exposing it separately gives Claire a button whose only visible effect is a delay.',
  },
  'POST /videos/:id/retry': {
    notExposed:
      'Requeues a failed render job. videos_getVideoStatus already surfaces the failure reason, and blind retries usually re-fail on the same bad config — the useful move is to fix the draft and export again, which Claire can do.',
  },
  // Was notExposed on the reasoning that it "mints presigned preview URLs …
  // useless to a model". That described the BROWSE endpoint above; this one
  // returns org-owned ASSET IDS. The mistake left Claire with no route to the
  // stock bank at all, so an org with no uploads was told to go and upload
  // footage — while the render pipeline was quietly building its videos from
  // this very bank.
  'POST /videos/stock-clips/mint': {
    exposed: 'videos_useStockClips',
    confirm: false,
  },
  'POST /videos/template-preview': {
    undecided: 'ENG-CLAIRE-VIDEOS',
  },
  'POST /videos/generate-organic-copy': {
    undecided: 'ENG-CLAIRE-VIDEOS',
  },
  'POST /videos/admin/cleanup-orphaned-assets': {
    notExposed:
      'Bulk-deletes S3 objects no video row references any more. A maintenance job with irreversible cross-tenant reach; it belongs to a cron and an operator, never to a conversation.',
  },
  'POST /videos/admin/dlq/:jobId/retry': {
    notExposed:
      'Replays a dead-lettered job by raw queue id, across tenants. Operator surface with no organization scoping — the same containment reason as the DLQ reads.',
  },
});
