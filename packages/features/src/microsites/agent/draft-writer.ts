/**
 * The ONLY place the agent tools touch the draft.
 *
 * Reads go through `getMicrositeDocument` (which re-validates every jsonb blob
 * and drops what no longer parses); writes go through the handful of
 * primitives below. Two rules hold for every one of them:
 *
 *   1. `micrositeId` AND `organizationId` are both in the WHERE clause — the
 *      same boundary `loadOwnedMicrosite` enforces (plan §12). Scoping by
 *      microsite id alone would work today and would be one careless edit away
 *      from a cross-tenant write.
 *   2. The ids come from the SESSION, never from a tool argument. No function
 *      here takes a caller-supplied organization.
 *
 * These are deliberately NOT a new service directory: block-level draft
 * mutation is the agent's own primitive, and the sibling services
 * (create/get-document/publish/create-revision) stay the public surface.
 */

import { microsite, micrositePage } from '@borradh-workspace/database';
import type {
  Block,
  MicrositeDocument,
  MicrositePage,
  MicrositeSeo,
  MicrositeTheme,
} from '@borradh-workspace/web-shared';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../shared/index.js';
import { getMicrositeDocument } from '../services/get-microsite-document/get-microsite-document.service.js';
import { toFeatureError } from '../services/shared/errors.js';
import type { MicrositeAgentSession } from './types.js';

/** The draft, as the tools see it. */
export interface DraftDocument extends MicrositeDocument {
  micrositeId: string;
  slug: string;
}

export const loadDraft = async (
  db: DbConnection,
  session: MicrositeAgentSession
): Promise<Result<DraftDocument>> => {
  const result = await getMicrositeDocument(db, {
    micrositeId: session.micrositeId,
    organizationId: session.organizationId,
    mode: 'draft',
  });
  if (!result.success) return err(toFeatureError(result.error));
  return ok({
    micrositeId: result.data.micrositeId,
    slug: result.data.slug,
    theme: result.data.theme,
    pages: result.data.pages,
  });
};

/** NOT_FOUND rather than a null return: every caller has to answer the model. */
export const requirePage = (
  doc: MicrositeDocument,
  path: string
): Result<MicrositePage> => {
  const page = doc.pages.find((candidate) => candidate.path === path);
  if (!page) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        `There is no page at ${path}. Call list_pages to see the pages that exist.`
      )
    );
  }
  return ok(page);
};

export const requireBlock = (
  page: MicrositePage,
  blockId: string
): Result<{ block: Block; index: number }> => {
  const index = page.blocks.findIndex((candidate) => candidate.id === blockId);
  if (index === -1) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        `There is no block "${blockId}" on ${page.path}. Call read_page to see the current blocks.`
      )
    );
  }
  return ok({ block: page.blocks[index], index });
};

const affected = (rows: { id: string }[]): boolean => rows.length > 0;

/** Replace a page's whole block list. Every block mutation lands here. */
export const writePageBlocks = async (
  db: DbConnection,
  session: MicrositeAgentSession,
  pageId: string,
  blocks: Block[]
): Promise<Result<true>> => {
  const rows = await db
    .update(micrositePage)
    .set({ blocks })
    .where(
      and(
        eq(micrositePage.id, pageId),
        eq(micrositePage.micrositeId, session.micrositeId),
        eq(micrositePage.organizationId, session.organizationId)
      )
    )
    .returning({ id: micrositePage.id });

  if (!affected(rows)) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Page not found'));
  }
  return ok(true);
};

export const writePageSeo = async (
  db: DbConnection,
  session: MicrositeAgentSession,
  pageId: string,
  seo: MicrositeSeo
): Promise<Result<true>> => {
  const rows = await db
    .update(micrositePage)
    .set({ seo })
    .where(
      and(
        eq(micrositePage.id, pageId),
        eq(micrositePage.micrositeId, session.micrositeId),
        eq(micrositePage.organizationId, session.organizationId)
      )
    )
    .returning({ id: micrositePage.id });

  if (!affected(rows)) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Page not found'));
  }
  return ok(true);
};

export const insertDraftPage = async (
  db: DbConnection,
  session: MicrositeAgentSession,
  page: { path: string; title: string; blocks: Block[]; order: number }
): Promise<Result<{ id: string }>> => {
  const [row] = await db
    .insert(micrositePage)
    .values({
      micrositeId: session.micrositeId,
      // Denormalized so `orgRlsPolicy` applies to the page row directly.
      organizationId: session.organizationId,
      path: page.path,
      title: page.title,
      blocks: page.blocks,
      seo: {},
      order: page.order,
      // The agent never creates a system page: system-ness is what protects the
      // home page from the agent in the first place.
      isSystem: false,
    })
    .returning({ id: micrositePage.id });

  return ok({ id: row.id });
};

export const deleteDraftPage = async (
  db: DbConnection,
  session: MicrositeAgentSession,
  pageId: string
): Promise<Result<true>> => {
  const rows = await db
    .delete(micrositePage)
    .where(
      and(
        eq(micrositePage.id, pageId),
        eq(micrositePage.micrositeId, session.micrositeId),
        eq(micrositePage.organizationId, session.organizationId),
        // Belt and braces: `delete_page` already refuses a system page, and
        // this makes the refusal true of the WRITE and not only of the check.
        eq(micrositePage.isSystem, false)
      )
    )
    .returning({ id: micrositePage.id });

  if (!affected(rows)) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        'That page could not be deleted — it may be a system page.'
      )
    );
  }
  return ok(true);
};

export const writeTheme = async (
  db: DbConnection,
  session: MicrositeAgentSession,
  theme: MicrositeTheme
): Promise<Result<true>> => {
  const rows = await db
    .update(microsite)
    .set({ theme })
    .where(
      and(
        eq(microsite.id, session.micrositeId),
        eq(microsite.organizationId, session.organizationId)
      )
    )
    .returning({ id: microsite.id });

  if (!affected(rows)) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Microsite not found'));
  }
  return ok(true);
};
