import { initAIClient, isAIClientInitialized } from '@borradh-workspace/ai';
import {
  type DocumentImportCandidate,
  documentImport,
} from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import { createLogger, logError } from '@borradh-workspace/observability';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { DocumentMatchJobPayload } from '../../../jobs/index.js';
import { type DbConnection, ErrorCodes } from '../../../shared/index.js';
import {
  AUTO_MATCH_CONFIDENCE_THRESHOLD,
  type DocumentImportStorageDeps,
  type DocumentMediaDeps,
  type ExtractedDocument,
  type LeadCandidate,
  type ProcessDocumentImportOutcome,
} from '../../models/index.js';
import { adjudicateDocumentMatch } from '../adjudicate-document-match/index.js';
import { extractDocumentFields } from '../extract-document-fields/index.js';
import { finalizeDocumentMatch } from '../finalize-document-match/index.js';
import { findLeadCandidates } from '../find-lead-candidates/index.js';

const logger = createLogger('DocumentImportProcessor');

export interface ProcessDocumentImportDeps {
  storage: DocumentImportStorageDeps;
  media: DocumentMediaDeps;
}

/** Only what the review UI needs — no emails/phones persisted twice. */
const toPersistedCandidates = (
  candidates: LeadCandidate[]
): DocumentImportCandidate[] =>
  candidates.map(({ leadId, name, matchedOn, score }) => ({
    leadId,
    name,
    matchedOn,
    score,
  }));

const ensureAIClient = (): boolean => {
  if (isAIClientInitialized()) return true;
  const apiKey = apiEnv.OPENAI_API_KEY;
  if (!apiKey) return false;
  initAIClient({ apiKey });
  return true;
};

interface Decision {
  leadId: string | null;
  confidence: number;
  reason: string;
  /** True when the second model call was needed. */
  adjudicated: boolean;
}

/**
 * One exact email/phone hit is decisive on its own; everything else goes to
 * the model with the full candidate list.
 */
const decide = async (
  input: {
    organizationId: string;
    importId: string;
    fileName: string;
  },
  extracted: ExtractedDocument,
  candidates: LeadCandidate[]
): Promise<Decision> => {
  if (candidates.length === 0) {
    return {
      leadId: null,
      confidence: 0,
      reason: 'No client with a matching name, email or phone number',
      adjudicated: false,
    };
  }
  const strong = candidates.filter(
    (c) => c.matchedOn.includes('email') || c.matchedOn.includes('phone')
  );
  if (strong.length === 1) {
    const [hit] = strong;
    const byEmail = hit.matchedOn.includes('email');
    return {
      leadId: hit.leadId,
      confidence: byEmail ? 0.97 : 0.92,
      reason: byEmail
        ? 'Email address on the document matches this client'
        : 'Phone number on the document matches this client',
      adjudicated: false,
    };
  }

  // A name that accounts for exactly one client is an identification on its
  // own. Most clinical paperwork carries a name and nothing else — no email,
  // no phone — so requiring contact details to corroborate meant the ordinary
  // case could never file itself, and every consent form landed in review.
  // Ambiguity is the thing to be careful about, and that is covered: two
  // clients answering to the same name fall through to the model below.
  const named = candidates.filter((c) => c.matchedOn.includes('name'));
  if (named.length === 1) {
    const [hit] = named;
    return {
      leadId: hit.leadId,
      confidence: 0.9,
      reason: `Name on the document matches ${hit.name}, and no other client`,
      adjudicated: false,
    };
  }
  const verdict = await adjudicateDocumentMatch({
    organizationId: input.organizationId,
    importId: input.importId,
    fileName: input.fileName,
    extracted,
    candidates,
  });
  if (!verdict.success) throw new Error(verdict.error.message);
  return { ...verdict.data, adjudicated: true };
};

/**
 * The `document-match` job body (ENG-784). Runs under SYSTEM scope in the
 * worker, so every query pins `organizationId` explicitly.
 *
 *   claim → download → extract (luna) → candidates (SQL) → decide (luna if
 *   ambiguous) → finalize | needs_review | failed
 *
 * Throws only for errors worth a second BullMQ attempt (model/network). A
 * file that cannot be read, or a document nobody matches, is a RESULT, not a
 * failure — it lands in `failed`/`needs_review` for a person and the job
 * completes. Before rethrowing, the row is marked `failed` with the reason
 * so nothing is ever left in `processing`.
 */
export const processDocumentImportJob = async (
  tx: DbConnection,
  deps: ProcessDocumentImportDeps,
  payload: DocumentMatchJobPayload
): Promise<ProcessDocumentImportOutcome> => {
  const { organizationId, importId } = payload;
  // Every write below is scoped LIVE: staff can discard a row at any point
  // while this job runs, and a discard must be final — no status flip back
  // onto a soft-deleted row, and no file into the client's vault.
  const scope = and(
    eq(documentImport.id, importId),
    eq(documentImport.organizationId, organizationId),
    isNull(documentImport.deletedAt)
  );

  const markFailed = async (reason: string) => {
    await tx
      .update(documentImport)
      .set({
        status: 'failed',
        failureReason: reason.slice(0, 500),
        processedAt: new Date(),
      })
      .where(scope);
  };

  // Claim. `processing` is re-claimable so a crash mid-attempt (lock lost,
  // process killed) does not strand the row; `patientDocumentId IS NULL`
  // keeps a finished import from ever being redone.
  const [row] = await tx
    .update(documentImport)
    .set({ status: 'processing', failureReason: null })
    .where(
      and(
        scope,
        inArray(documentImport.status, ['pending', 'failed', 'processing']),
        isNull(documentImport.patientDocumentId)
      )
    )
    .returning();
  if (!row) {
    logger.info('Document import not claimable — skipping', {
      organizationId,
      importId,
    });
    return 'skipped';
  }

  try {
    if (!ensureAIClient()) {
      await markFailed('Document reading is not configured on this server');
      return 'failed';
    }

    const bucket = deps.storage.getOrgAssetsBucket();
    const bytes = await deps.storage.downloadAsBuffer({
      bucket,
      key: row.storageKey,
    });

    const extraction = await extractDocumentFields(deps.media, {
      organizationId,
      importId,
      fileName: row.fileName,
      mimeType: row.mimeType,
      bytes,
    });
    if (!extraction.success) {
      if (extraction.error.code === ErrorCodes.EXTERNAL_SERVICE_ERROR) {
        throw new Error(extraction.error.message);
      }
      await markFailed(extraction.error.message);
      return 'failed';
    }
    const extracted = extraction.data;
    const { legible, documentKind, ...extractedFields } = extracted;

    const candidates = legible
      ? await findLeadCandidates(tx, {
          organizationId,
          personName: extracted.personName,
          email: extracted.email,
          phone: extracted.phone,
        })
      : [];

    const decision = legible
      ? await decide(
          { organizationId, importId, fileName: row.fileName },
          extracted,
          candidates
        )
      : {
          leadId: null,
          confidence: 0,
          reason: 'The document could not be read clearly',
          adjudicated: false,
        };

    const readBack = {
      extracted: extractedFields,
      documentKind,
      candidates: toPersistedCandidates(candidates),
    };

    if (
      decision.leadId &&
      decision.confidence >= AUTO_MATCH_CONFIDENCE_THRESHOLD
    ) {
      await tx.update(documentImport).set(readBack).where(scope);
      const finalized = await finalizeDocumentMatch(tx, deps.storage, {
        organizationId,
        importId,
        leadId: decision.leadId,
        matchSource: 'auto',
        confidence: decision.confidence,
        reason: decision.reason,
      });
      if (!finalized.success) {
        if (finalized.error.code === ErrorCodes.INTERNAL_ERROR) {
          throw new Error(finalized.error.message);
        }
        // NOT_FOUND here means the row was discarded mid-flight. That is a
        // decision, not a failure — leave the discarded row alone.
        if (finalized.error.code === ErrorCodes.NOT_FOUND) {
          logger.info('Document import discarded while processing — skipping', {
            organizationId,
            importId,
          });
          return 'skipped';
        }
        await markFailed(finalized.error.message);
        return 'failed';
      }
      logger.info('Document import matched', {
        organizationId,
        importId,
        leadId: decision.leadId,
        confidence: decision.confidence,
        adjudicated: decision.adjudicated,
      });
      return 'matched';
    }

    await tx
      .update(documentImport)
      .set({
        ...readBack,
        status: 'needs_review',
        matchedLeadId: null,
        confidence: decision.confidence,
        matchReason: decision.reason,
        processedAt: new Date(),
      })
      .where(scope);
    logger.info('Document import needs review', {
      organizationId,
      importId,
      candidates: candidates.length,
      confidence: decision.confidence,
    });
    return 'needs_review';
  } catch (error) {
    logError('documentImports.processDocumentImportJob', error, {
      feature: 'document-imports',
      extra: { organizationId, importId },
    });
    await markFailed(
      error instanceof Error ? error.message : 'Document matching failed'
    ).catch(() => undefined);
    throw error;
  }
};
