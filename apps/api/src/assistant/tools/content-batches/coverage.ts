import { defineCoverage } from '../coverage.types.js';

/**
 * CONTENT-BATCHES — 15 endpoints, 0 tools. The monthly bulk-content run: a cron
 * generates a month's worth of videos and graphics for the org, and the Socials
 * page shows the owner a review modal where each item is accepted, rejected, or
 * regenerated.
 *
 * The READS are a gap rather than a decision — hence `undecided`. "What did
 * this month's batch produce?" is exactly what an owner asks in chat, and today
 * Claire cannot answer it. That half should close.
 *
 * The WRITES were decided together (2026-08-01): **a batch reaches chat as an
 * artifact, not as an editing surface.** Claire surfaced the month's batch as a
 * card the owner clicked through to the review page, and every judgement about
 * a post was taken there, beside the thing being judged.
 *
 * THAT PREMISE CHANGED (2026-08-04). The review page IS the chat now: the queue
 * sits beside the ordinary assistant conversation with the post on screen in
 * the content panel. "Beside the thing being judged" and "in chat" stopped
 * being opposites, so the two judgements that are about the CONTENT —
 * regenerate and rewrite the caption — are exposed. Accept and reject stayed
 * out: they are buttons in the panel, taken by the person looking at it, and a
 * tool for them would let an orchestrator decide a post on someone's behalf.
 *
 * NOT because generating content is risky. `graphics_regenerateGraphic` is
 * exposed and runs unconfirmed, so Claire re-rolls images today — and should.
 * The difference is ADDITIVE vs REPLACING: that tool INSERTS a new graphic row
 * and leaves the source untouched, so the render lands in the library and
 * nothing already on a screen changes. These endpoints move a slot's
 * `currentAttemptId`. They swap what a queued post SAYS and SHOWS, for a post
 * the owner is mid-decision on, and the thing that makes the swap judgeable —
 * the cut it replaced, side by side — exists on exactly one screen. An
 * orchestrator pressing them changes a queue nobody has open; the owner finds
 * out the next time they open it, with no turn to point at.
 *
 * That leaves one write in a class of its own: `DELETE /content-batches/current`
 * hard-deletes the month's batch AND the video and graphic rows behind it.
 */
export const contentBatchesCoverage = defineCoverage('content-batches', {
  // ---- reads: no tool exists yet, but clearly should ---------------------
  'GET /content-batches': { undecided: 'ENG-CLAIRE-CONTENT-BATCHES' },
  'GET /content-batches/:id': { undecided: 'ENG-CLAIRE-CONTENT-BATCHES' },
  'GET /content-batches/current': { undecided: 'ENG-CLAIRE-CONTENT-BATCHES' },

  // ---- writes: per-item review ------------------------------------------
  'POST /content-batches/generate': {
    undecided: 'ENG-CLAIRE-CONTENT-BATCHES',
  },
  'POST /content-batches/items/:itemId/accept': {
    undecided: 'ENG-CLAIRE-CONTENT-BATCHES',
  },
  'POST /content-batches/items/:itemId/reject': {
    undecided: 'ENG-CLAIRE-CONTENT-BATCHES',
  },
  'POST /content-batches/items/:itemId/regenerate': {
    notExposed:
      "Re-rolls a post. Reached now through content_patchContent, which sends the owner's instruction to the review-turn endpoint below — that is what decides a re-roll is what they asked for, from state it holds and Claire does not. A second, direct route would let a model spend a render on a judgement call it is worse placed to make, which is how a caption rewrite became a re-render.",
  },
  'POST /content-batches/items/:itemId/undo-regenerate': {
    notExposed:
      'Swaps which cut of a post is live. Instant and free, so neither the cost nor the risk argument applies — the argument is legibility, and it is the area rule above: this REPLACES what a queued post shows, where graphics_regenerateGraphic only ADDS a row. Going back only means something when you can see what you are going back from, and that comparison exists on the review page. Claire\'s answer to "revert post 3" is the link, not a blind pointer move.',
  },

  // ---- the per-post review thread ---------------------------------------
  //
  // These three belong to the review workspace's interaction loop, and that is
  // the argument against exposing them: each only makes sense while the owner
  // is looking at the post it changes.
  'GET /content-batches/items/:itemId/messages': {
    notExposed:
      "Returns Claire's own transcript from the review workspace. Reading it back inside a Claire conversation is Claire quoting herself, and it answers nothing that reading the batch does not — the captions those turns produced are already on the items.",
  },
  'POST /content-batches/items/:itemId/messages': {
    // THE edit endpoint, and the whole of `content_patchContent`.
    //
    // It was notExposed on the argument that driving it from chat would alter a
    // post nobody was looking at. That premise is gone: the review page IS the
    // chat, with the post on screen in the panel beside it, and an ordinary
    // conversation shows the same card.
    //
    // What it does that no tool should: it takes the owner's words and decides
    // which lever they pull — the caption, the on-screen text, the clips, or a
    // re-roll — using the item's kind, its active template block, the current
    // value of every field on it and its clip list. Making the model choose
    // instead produced free changes that cost renders, and edits landing on the
    // wrong field. Video edits are STAGED here, never fired, so the render
    // still belongs to the owner.
    exposed: 'content_patchContent',
    confirm: false,
  },
  'GET /content-batches/items/:itemId/clips': {
    notExposed:
      "The clip filmstrip for the review workspace. Claire already receives this list as context on every review turn — that is how she can say 'clip 2 is the syringe tray' — so a tool would be a second, drifting route to the same data.",
  },
  'GET /content-batches/items/:itemId/state': {
    // Read by the CARDS, and now by `patchContent` before it edits — it is how
    // the tool knows the kind and the live cut without asking the model for
    // either. Not a tool of its own: nothing is worth telling an owner that
    // this returns on its own.
    exposed: 'content_patchContent',
  },
  'POST /content-batches/items/:itemId/stage-clips': {
    notExposed:
      'The clip list editor writing back the list the owner just dragged into order. It sends the WHOLE list, which is safe only because the card renders every position the owner is looking at — Claire reads clips as text and has never seen the stored array, so a model driving this could reorder a video by rearranging clips it cannot see. When the owner names the footage they want, she already has the right tools: listMedia, useStockClips, and patchContent to place what she found.',
  },
  'DELETE /content-batches/items/:itemId/staged-edits': {
    notExposed:
      "The card's Reject. It throws away an edit the owner made by hand and is only meaningful next to the list it discards — an orchestrator calling it would silently undo work the owner staged, and the first they would know is the change not being there.",
  },
  'POST /content-batches/items/:itemId/apply-edits': {
    notExposed:
      'Fires the re-render for whatever the review thread staged. The staging step is already notExposed, so there is nothing an orchestrator could have queued here — and this is the point where an edit stops being free, which is exactly the moment that belongs to the owner looking at the post.',
  },
  'PATCH /content-batches/items/:itemId/caption': {
    notExposed:
      "Sets a caption verbatim — a hand-edit in the caption box, or a revert to an earlier version from the thread. No model call, so nothing here rewrites anything. Claire's route to a caption change is content_patchContent, which sends what the owner said to the review-turn endpoint and lets it do the rewriting; reaching this one directly would mean her own words replacing theirs.",
  },

  // ---- writes: the reset -------------------------------------------------
  'DELETE /content-batches/current': {
    notExposed:
      "Hard-deletes this month's batch together with every video and graphic row it produced — a month of generated content gone, with no undo and no way to reproduce the same renders. It exists so a stuck batch can be re-run, and that is a decision an owner should take at the keyboard with the consequence spelled out on screen.",
  },
});
