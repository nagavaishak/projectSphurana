/**
 * The editor's own reads and its manual-edit path.
 *
 * MANUAL EDITS GO THROUGH THE AGENT'S TOOLS. The inspector's field edit calls
 * `update_block`; the canvas's drag-reorder calls `move_block` — the same
 * implementations the model calls, with the same validation and the same
 * guardrails. Contract §5 asks for exactly this ("one code path, or the two
 * drift and only one gets fixed"), and it is also the only way the
 * conversion-path rule holds for a user dragging blocks around.
 *
 * Every manual edit is a revision too, authored `user` rather than `agent`, so
 * undo does not care which produced a change.
 */

import type { Database } from '@borradh-workspace/database';
import { microsite } from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import { logError } from '@borradh-workspace/observability';
import type { MicrositeDocument } from '@borradh-workspace/web-shared';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../shared/index.js';
import { mintPreviewToken } from '../preview-token.js';
import { createRevision } from '../services/create-revision/create-revision.service.js';
import { toFeatureError } from '../services/shared/errors.js';
import { computeMicrositeDiff, describeDiff, isEmptyDiff } from './diff.js';
import type { MicrositeTurnDiff } from './diff.js';
import { loadDraft } from './draft-writer.js';
import { writePageBlocks } from './draft-writer.js';
import { createTurnBudget } from './guardrails.js';
import { moveBlockTool, updateBlockTool } from './tools/index.js';
import { parseBlock, resolveRequestedVariant } from './tools/shared.js';
import type { MicrositeAgentSession } from './types.js';

/**
 * The apexes we serve microsites on. Same env var host resolution reads, so the
 * preview URL and the live URL cannot disagree — and the CLIENT never builds
 * this: the apex is environment-driven and a browser guessing it is wrong on
 * every non-production environment.
 */
const previewBaseDomain = (): string =>
  (process.env.MICROSITE_BASE_DOMAIN ?? 'borradh.io')
    .split(',')[0]
    .trim()
    .toLowerCase()
    .replace(/^\.+|\.+$/g, '');

/**
 * The editor canvas's iframe target: the TOKEN-GATED draft preview route.
 *
 * Two things this deliberately is not:
 *   - not the wildcard host `{slug}.borradh.io`. That tier does not exist until
 *     Phase 4; pointing the canvas at it today gives an iframe that never loads.
 *   - not the published `/sites/{slug}` page. The editor must show the DRAFT,
 *     which the public route refuses by design.
 *
 * Returns null when no preview token can be minted (no adequate signing
 * secret). Callers must then omit the preview URL — an unsigned preview URL is
 * not a degraded feature, it is an open door onto unpublished copy.
 */
export const micrositePreviewUrl = (micrositeId: string): string | null => {
  const token = mintPreviewToken(micrositeId);
  if (!token) return null;
  // MARKETING first, like every other customer-facing builder. WEB_URL means
  // the DASHBOARD in previews, and the preview canvas is iframed by the
  // dashboard — so resolving through it pointed the editor at a path the SPA
  // does not serve and rendered a 404 inside the editor.
  const base = (
    apiEnv.MARKETING_URL ??
    apiEnv.WEB_URL ??
    `https://${previewBaseDomain()}`
  ).replace(/\/$/, '');
  return `${base}/sites/preview/${encodeURIComponent(micrositeId)}?token=${encodeURIComponent(token)}`;
};

export interface MicrositeWorkspace extends MicrositeDocument {
  micrositeId: string;
  slug: string;
  status: 'draft' | 'published';
  publishedRevisionId: string | null;
  draftRevisionId: string | null;
  /** Where the canvas points its iframe. Built server-side (see above). */
  /** Null when no preview token could be minted — see micrositePreviewUrl. */
  previewUrl: string | null;
}

/**
 * The caller's org microsite plus its draft document — `GET microsites/mine`.
 *
 * One microsite per org (unique on `organization_id`), so "mine" is a lookup,
 * not a choice. NOT_FOUND when the org has not been provisioned yet: the
 * editor shows an empty state rather than silently creating a site the tenant
 * did not ask for.
 */
export const getOrganizationWorkspace = async (
  db: DbConnection,
  organizationId: string
): Promise<Result<MicrositeWorkspace>> => {
  const row = await db.query.microsite.findFirst({
    where: eq(microsite.organizationId, organizationId),
    columns: {
      id: true,
      slug: true,
      status: true,
      publishedRevisionId: true,
      draftRevisionId: true,
    },
  });

  if (!row) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        'This organization does not have a website yet'
      )
    );
  }

  const draft = await loadDraft(db, {
    micrositeId: row.id,
    organizationId,
    userId: '',
  });
  if (!draft.success) return err(draft.error);

  return ok({
    micrositeId: row.id,
    slug: row.slug,
    status: row.status,
    previewUrl: micrositePreviewUrl(row.id),
    publishedRevisionId: row.publishedRevisionId,
    draftRevisionId: row.draftRevisionId,
    theme: draft.data.theme,
    pages: draft.data.pages,
  });
};

export interface ManualEditInput {
  pageId: string;
  blockId: string;
  /** Field edits from the inspector. Same PATCH semantics as `update_block`. */
  propsPatch?: Record<string, unknown>;
  /** Drag-reorder from the canvas. Same implementation as `move_block`. */
  toIndex?: number;
  /**
   * Layout variant change from the inspector. There is no agent tool for this
   * — §2 has none — so it is implemented here, against the SAME catalogue the
   * agent's `add_block` resolves variants with. An unknown variant is
   * corrected to the block's fallback rather than refused, exactly as it is
   * there, because the renderer would fall back anyway.
   */
  variant?: string;
}

export interface ManualEditOutput {
  revisionId: string | null;
  diff: MicrositeTurnDiff;
}

export const applyManualBlockEdit = async (
  db: DbConnection,
  session: MicrositeAgentSession,
  input: ManualEditInput
): Promise<Result<ManualEditOutput>> => {
  if (
    !input.propsPatch &&
    input.toIndex === undefined &&
    input.variant === undefined
  ) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Provide propsPatch, variant or toIndex'
      )
    );
  }

  const before = await loadDraft(db, session);
  if (!before.success) return err(before.error);

  const page = before.data.pages.find(
    (candidate) => candidate.id === input.pageId
  );
  if (!page) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Page not found'));
  }

  const ctx = {
    db,
    session,
    budget: createTurnBudget(),
    // Manual edits are the user acting directly; there is nothing for the user
    // to confirm to themselves. Neither tool used here is gated anyway.
    confirmedActions: new Set<string>(),
  };

  if (input.propsPatch) {
    const updated = await updateBlockTool.execute(ctx, {
      path: page.path,
      blockId: input.blockId,
      propsPatch: input.propsPatch,
    });
    if (!updated.success) return err(updated.error);
  }

  if (input.variant !== undefined) {
    const current = await loadDraft(db, session);
    if (!current.success) return err(current.error);
    const currentPage = current.data.pages.find(
      (candidate) => candidate.id === input.pageId
    );
    const target = currentPage?.blocks.find(
      (block) => block.id === input.blockId
    );
    if (!currentPage || !target) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Block not found'));
    }

    const revalidated = parseBlock({
      id: target.id,
      type: target.type,
      variant: resolveRequestedVariant(target.type, input.variant),
      props: target.props as unknown as Record<string, unknown>,
    });
    if (!revalidated.success) return err(revalidated.error);

    const blocks = currentPage.blocks.map((block) =>
      block.id === input.blockId ? revalidated.data : block
    );
    const written = await writePageBlocks(db, session, currentPage.id, blocks);
    if (!written.success) return err(written.error);
  }

  if (input.toIndex !== undefined) {
    const moved = await moveBlockTool.execute(ctx, {
      path: page.path,
      blockId: input.blockId,
      toIndex: input.toIndex,
    });
    if (!moved.success) return err(moved.error);
  }

  const after = await loadDraft(db, session);
  if (!after.success) return err(after.error);

  const diff = computeMicrositeDiff(before.data, after.data);
  if (isEmptyDiff(diff)) return ok({ revisionId: null, diff });

  try {
    // Same transaction rule as an agent turn: `createRevision` is two
    // statements and only atomic when it is handed a `tx`. Split, the revision
    // lands while `draftRevisionId` still names the previous one and a later
    // undo silently skips this edit.
    const revision = await (db as Database).transaction((tx) =>
      createRevision(tx, {
        micrositeId: session.micrositeId,
        organizationId: session.organizationId,
        createdBy: 'user',
        label: describeDiff(diff),
      })
    );
    if (!revision.success) return err(toFeatureError(revision.error));
    return ok({ revisionId: revision.data.id, diff });
  } catch (error) {
    logError('microsites.applyManualBlockEdit', error, {
      feature: 'microsites',
      extra: {
        micrositeId: session.micrositeId,
        organizationId: session.organizationId,
      },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'The edit was saved but the version could not be recorded'
      )
    );
  }
};
