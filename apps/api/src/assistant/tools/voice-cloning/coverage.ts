import { defineCoverage } from '../coverage.types.js';

/**
 * VOICE-CLONING — 4 endpoints, 0 tools. Ingests audio from the org's Meta page
 * videos to train an ElevenLabs voice clone of the owner, which later narrates
 * generated videos.
 *
 * Two axes decide this area. First, half the surface is `GlobalAdminGuard` and
 * takes an arbitrary `organizationId` in the body — an org-scoped assistant
 * reaching those is a tenancy break, full stop, and the fact that they are
 * POSTs carrying a read (`admin/status`) does not soften it. Second, the
 * non-admin write trains a biometric likeness: it is expensive, long-running,
 * and produces an artifact that can speak in a real person's voice. That is a
 * deliberate, consented human action, not something a turn should kick off
 * because the conversation drifted toward video.
 *
 * The status read is the one plausible capability and has no tool.
 */
export const voiceCloningCoverage = defineCoverage('voice-cloning', {
  'GET /voice-cloning/status': { undecided: 'ENG-CLAIRE-VOICE-CLONING' },

  'POST /voice-cloning/ingest': {
    notExposed:
      "Queues a long-running job that harvests audio from the org's Meta videos to train a clone of the owner's voice. Expensive, biometric, and consent-bearing — starting it is a deliberate act the owner takes in settings, not a side effect of a chat turn.",
  },
  'POST /voice-cloning/admin/ingest': {
    notExposed:
      "Global-admin operation taking an arbitrary organizationId and page id in the body. Reachable by an org-scoped assistant it would let one tenant trigger voice training against another's Meta page.",
  },
  'POST /voice-cloning/admin/status': {
    notExposed:
      "Global-admin read of any organization's clone state by id. Harmless-looking because it is only a status, but it is a cross-tenant lookup and the org-scoped status endpoint already answers the same question for the caller.",
  },
});
