import { defineQueue } from './define-job.js';

/**
 * THE queue registry.
 *
 * Every BullMQ queue in the workspace is declared here, exactly once. The
 * observability lists (`QUEUE_NAMES` for the metrics collector, the Bull Board
 * board) are DERIVED from this file — they are not hand-written, because the
 * hand-written ones were wrong: the metrics collector watched 7 of 18 queues
 * (missing `appointment-lifecycle` and `campaign-send` — the two whose backlog
 * most directly means "customers aren't being contacted") and Bull Board showed
 * 1 of 18.
 *
 * The gate (`job-registry.test.ts`) does NOT trust this file either: it
 * enumerates every `new Queue(...)` and `new Worker(...)` in the tree and
 * cross-checks. So a queue that exists in code but not here is a failure, and a
 * queue declared here with no worker is a failure unless it carries an explicit
 * `disabled` reason.
 */
export const videoRenderQueue = defineQueue({
  name: 'video-render',
  description: 'Remotion Lambda video renders.',
  deadLetter: true,
  // Video rendering is expensive: limited retries, exponential backoff, and
  // failures are kept (they are copied to the DLQ for manual replay).
  //
  // This object is the ONLY retry policy for this queue. The retry path used to
  // construct its own Queue instance with `attempts: 1`, so a manually-retried
  // render silently got one shot instead of three.
  jobOptions: {
    removeOnComplete: 100,
    removeOnFail: false,
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
  },
});

export const appointmentLifecycleQueue = defineQueue({
  name: 'appointment-lifecycle',
  description:
    'Booking side-effects: reminders, deposit expiry, calendar sync. Routed by job name.',
  deadLetter: true,
  jobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: true,
    removeOnFail: 500,
  },
});

// ---------------------------------------------------------------------------
// Queues whose producers still build their own `Queue` instance.
//
// They are declared here so the derived observability lists and the
// producer↔worker gate cover them. Migrating each producer to `getJobQueue()`
// + `enqueueJob()` (which is what makes the payload and the retry policy
// single-source) is mechanical follow-up work — `jobOptions` is deliberately
// left off those declarations rather than duplicating a policy this file does
// not yet own, because a declared-but-unapplied policy is exactly the drift
// this registry exists to kill.
// ---------------------------------------------------------------------------

export const contentBatchGenerateQueue = defineQueue({
  name: 'content-batch-generate',
  description:
    'Monthly bulk content batches: seeds graphics + organic videos per service.',
});

export const claireWhatsappTurnQueue = defineQueue({
  name: 'claire-whatsapp-turn',
  description: 'Claire assistant turns arriving over WhatsApp.',
});

export const claireWhatsappOutboundQueue = defineQueue({
  name: 'claire-whatsapp-outbound',
  description: 'Proactive Claire → WhatsApp deliveries (e.g. finished videos).',
});

export const claireClassifyQueue = defineQueue({
  name: 'claire-classify',
  description: 'Claire background classification triggers.',
});

export const knowledgeUpdateQueue = defineQueue({
  name: 'knowledge-update',
  description: "Rebuilds Claire's org knowledge snapshot.",
  deadLetter: true,
});

export const chatbotFlowQueue = defineQueue({
  name: 'chatbot-flow',
  description: 'Customer chatbot flow execution (Messenger / IG / WhatsApp).',
  deadLetter: true,
});

export const campaignSendQueue = defineQueue({
  name: 'campaign-send',
  description: 'Bulk messaging campaign sends (email / SMS / WhatsApp).',
  deadLetter: true,
});

export const voiceIngestQueue = defineQueue({
  name: 'voice-ingest',
  description: 'Voice-clone sample ingestion.',
});

export const metaSyncQueue = defineQueue({
  name: 'meta-sync',
  description: 'Meta ads/insights sync (off the request path — pool safety).',
});

export const metaCampaignDuplicateQueue = defineQueue({
  name: 'meta-campaign-duplicate',
  description: 'Duplicating a Meta campaign (many external calls).',
});

export const micrositeDomainQueue = defineQueue({
  name: 'microsite-domain',
  description:
    'Custom-domain verification polling and the domain_changed fan-out (ad destination rewrites, Meta re-verification).',
});

export const graphicGenerateQueue = defineQueue({
  name: 'graphic-generate',
  description: 'Branded graphic generation.',
  deadLetter: true,
});

export const assetAnalysisQueue = defineQueue({
  name: 'asset-analysis',
  description: 'Vision analysis of uploaded assets.',
  deadLetter: true,
});

export const assetProbeQueue = defineQueue({
  name: 'asset-probe',
  description: 'ffprobe metadata extraction for uploaded media.',
  deadLetter: true,
});

export const assetThumbnailQueue = defineQueue({
  name: 'asset-thumbnail',
  description: 'Thumbnail generation / backfill for assets.',
  deadLetter: true,
});

export const assetTranscodeQueue = defineQueue({
  name: 'asset-transcode',
  description: 'Normalising 4K/HEVC uploads to H.264 before render.',
  deadLetter: true,
});

export const stockMatchQueue = defineQueue({
  name: 'stock-match',
  description:
    'Once-per-service stock-footage matching (embed + rank) off the request path.',
});

export const sequenceExecutionQueue = defineQueue({
  name: 'sequence-execution',
  description: 'Nurture-sequence step execution.',
  deadLetter: true,
  // ---------------------------------------------------------------------
  // DECLARED DISABLED — read this before "fixing" it.
  //
  // This queue has a producer (`queueSequenceStep`) and has NEVER had a
  // `Worker` anywhere in the tree. It is the only orphan of the 18 queues.
  // It is harmless today only because `queueSequenceStep` has no callers:
  // the sequences feature is deprecated (kept, not deleted — it still owns
  // schema, services and UI that other work references).
  //
  // Registering a worker for a deprecated feature would be shipping dead
  // code that we would then have to keep alive. Deleting the feature is out
  // of scope and explicitly not wanted. So the queue is declared DISABLED:
  // the gate now knows it has no consumer *on purpose*, and the day someone
  // wires `queueSequenceStep` up to a caller, `enqueueJob` refuses at
  // runtime and the gate refuses at build time — instead of every nurture
  // step enqueueing and silently never running.
  //
  // To un-deprecate: register a Worker on this queue and delete this line.
  // ---------------------------------------------------------------------
  disabled:
    'sequences feature is deprecated: producer exists, no worker has ever been registered. Enqueueing here would silently never run.',
});

export const leadFirstTouchQueue = defineQueue({
  name: 'lead-first-touch',
  description:
    "Claire's opening message to a new lead-form submission (WhatsApp template, else SMS).",
  deadLetter: true,
  jobOptions: {
    // ONE attempt. The job ends in an external send BEFORE the
    // conversationMessage row is persisted, so a retry after a mid-send crash
    // re-messages the lead — and a dedup guard cannot help, because the very
    // row it would check for is the one that failed to write. Same reasoning as
    // the chatbot-flow delivery triggers. Failures are kept for the DLQ.
    attempts: 1,
    removeOnComplete: 500,
    removeOnFail: false,
  },
});

/**
 * Every queue, in one list. The observability lists derive from this — nobody
 * hand-maintains a second copy.
 */
export const documentMatchQueue = defineQueue({
  name: 'document-match',
  description:
    'Reads a staged document (PDF/photo) with the vision model and attaches it to the matching client (ENG-784).',
  deadLetter: true,
  jobOptions: {
    // The handler claims the row with a conditional UPDATE and finalisation is
    // idempotent on `patient_document_id`, so a second attempt after a model
    // or S3 blip is safe. Two is enough: anything still failing is a bad file,
    // not a transient, and belongs in needs_review/failed for a person.
    attempts: 2,
    backoff: { type: 'exponential', delay: 15_000 },
    removeOnComplete: 500,
    removeOnFail: false,
  },
});

export const jobQueues = [
  leadFirstTouchQueue,
  videoRenderQueue,
  appointmentLifecycleQueue,
  contentBatchGenerateQueue,
  claireWhatsappTurnQueue,
  claireWhatsappOutboundQueue,
  claireClassifyQueue,
  knowledgeUpdateQueue,
  chatbotFlowQueue,
  campaignSendQueue,
  voiceIngestQueue,
  metaSyncQueue,
  metaCampaignDuplicateQueue,
  graphicGenerateQueue,
  assetAnalysisQueue,
  assetProbeQueue,
  assetThumbnailQueue,
  assetTranscodeQueue,
  stockMatchQueue,
  sequenceExecutionQueue,
  micrositeDomainQueue,
  documentMatchQueue,
] as const;

/** Every queue name. DERIVED — never type this list again. */
export const QUEUE_NAMES: readonly string[] = jobQueues.map((q) => q.name);

/** Every dead-letter queue name. DERIVED from `deadLetter: true`. */
export const DLQ_NAMES: readonly string[] = jobQueues
  .filter((q) => q.deadLetter)
  .map((q) => `${q.name}-dlq`);

/**
 * Everything worth watching: the queues plus their DLQs. This is what the
 * metrics collector polls and what Bull Board shows.
 */
export const MONITORED_QUEUE_NAMES: readonly string[] = [
  ...QUEUE_NAMES,
  ...DLQ_NAMES,
];
