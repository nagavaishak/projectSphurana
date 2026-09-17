/**
 * The authenticated microsite use cases.
 *
 * Everything the staff controller does beyond streaming lives here: the org
 * lookup, the feature-service calls and the Result→HTTP translation. The
 * controller stays at "call the use case, return it" (Gate 5, controller
 * thinness) and this file holds no transport of its own.
 *
 * `micrositeId` arrives from the route but is NEVER trusted on its own: every
 * service below takes the caller's `organizationId` too and enforces the pair
 * in a WHERE clause (plan §12). A microsite id belonging to another tenant
 * returns NOT_FOUND, not FORBIDDEN — FORBIDDEN would confirm the id exists.
 */

import { db } from '@borradh-workspace/database';
import {
  type MicrositeAgentSession,
  applyManualBlockEdit,
  getOrganizationWorkspace,
  listRevisions,
  loadTranscript,
  provisionMicrosite,
  publishMicrosite,
  restoreRevision,
} from '@borradh-workspace/features/microsites';
import { HttpException, HttpStatus } from '@nestjs/common';

const STATUS_BY_CODE: Record<string, HttpStatus> = {
  VALIDATION_ERROR: HttpStatus.BAD_REQUEST,
  INVALID_INPUT: HttpStatus.BAD_REQUEST,
  UNAUTHORIZED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  ALREADY_EXISTS: HttpStatus.CONFLICT,
  CONFLICT: HttpStatus.CONFLICT,
};

const fail = (error: { code: string; message: string }): never => {
  throw new HttpException(
    error.message,
    STATUS_BY_CODE[error.code] ?? HttpStatus.INTERNAL_SERVER_ERROR
  );
};

const session = (
  micrositeId: string,
  organizationId: string,
  userId: string
): MicrositeAgentSession => ({ micrositeId, organizationId, userId });

/**
 * `GET microsites/mine` — the editor's whole payload.
 *
 * SHAPE. The feature returns one flat object; the editor's wire contract
 * (contract §4, `MicrositeMineResponse`) is `{ microsite, document }`. Those
 * two disagreed, so `data.microsite` was always undefined and the editor fell
 * straight through to "we could not load your website" on a 200 with a
 * perfectly good 5KB body. The mapping lives here, at the transport boundary,
 * rather than by reshaping the feature service — the flat result is also the
 * agent's own view of the workspace, and it should not have to change shape
 * because an HTTP client wants a different envelope.
 *
 * `changesSincePublish` is the one field the flat result does not carry. The
 * Publish button renders it verbatim, and the revisions service already
 * computes it, so it is read from there rather than counted a second time
 * here. `limit: 1` because only the count is wanted — the editor loads the
 * history itself, separately, when the user opens it.
 */
export async function readWorkspace(organizationId: string) {
  const result = await getOrganizationWorkspace(db, organizationId);
  if (!result.success) fail(result.error);
  if (!result.success) return undefined;

  const workspace = result.data;
  const revisions = await listRevisions(db, {
    micrositeId: workspace.micrositeId,
    organizationId,
    limit: 1,
  });

  return {
    microsite: {
      id: workspace.micrositeId,
      slug: workspace.slug,
      status: workspace.status,
      publishedRevisionId: workspace.publishedRevisionId,
      draftRevisionId: workspace.draftRevisionId,
      changesSincePublish: revisions.success
        ? revisions.data.changesSincePublish
        : 0,
      previewUrl: workspace.previewUrl,
    },
    document: { theme: workspace.theme, pages: workspace.pages },
  };
}

/**
 * Create this org's website, on request.
 *
 * Provisioning is EXPLICIT. The plan had it fire at onboarding completion; it
 * is not wired there and should not be while the feature is preview-only —
 * every new org would silently get a site nobody can edit, and each one costs
 * a model call to write its copy. So the editor asks for it, and the empty
 * state is the ask.
 *
 * Idempotent underneath (`createMicrosite` returns the existing row rather
 * than renumbering a live slug), so a double-click or a retry is safe.
 */
export async function createWorkspace(organizationId: string) {
  const result = await provisionMicrosite(db, { organizationId });
  if (!result.success) fail(result.error);
  return readWorkspace(organizationId);
}

export async function readConversation(
  micrositeId: string,
  conversationId: string,
  organizationId: string,
  userId: string
) {
  const result = await loadTranscript(
    db,
    session(micrositeId, organizationId, userId),
    conversationId
  );
  if (!result.success) fail(result.error);
  return result.success ? result.data : undefined;
}

export async function readRevisions(
  micrositeId: string,
  organizationId: string,
  query: { limit?: number; cursor?: string }
) {
  const result = await listRevisions(db, {
    micrositeId,
    organizationId,
    ...query,
  });
  if (!result.success) fail(result.error);
  return result.success ? result.data : undefined;
}

export async function restoreMicrositeRevision(
  micrositeId: string,
  revisionId: string,
  organizationId: string
) {
  const result = await restoreRevision(db, {
    micrositeId,
    organizationId,
    revisionId,
  });
  if (!result.success) fail(result.error);
  return result.success ? result.data : undefined;
}

export async function publishDraft(
  micrositeId: string,
  organizationId: string,
  label?: string
) {
  const result = await publishMicrosite(db, {
    micrositeId,
    organizationId,
    createdBy: 'user',
    label,
  });
  if (!result.success) fail(result.error);
  return result.success ? result.data : undefined;
}

export async function editBlock(
  params: {
    micrositeId: string;
    pageId: string;
    blockId: string;
    organizationId: string;
    userId: string;
  },
  body: {
    propsPatch?: Record<string, unknown>;
    variant?: string;
    toIndex?: number;
  }
) {
  const result = await applyManualBlockEdit(
    db,
    session(params.micrositeId, params.organizationId, params.userId),
    {
      pageId: params.pageId,
      blockId: params.blockId,
      propsPatch: body.propsPatch,
      variant: body.variant,
      toIndex: body.toIndex,
    }
  );
  if (!result.success) fail(result.error);
  return result.success ? result.data : undefined;
}
