/**
 * The microsite authorization boundary (plan §12).
 *
 * "`micrositeId` must belong to the caller's active org, enforced in the
 * SERVICE, not the controller." Every service in this folder that takes a
 * `micrositeId` starts here, and the enforcement is a WHERE clause rather than
 * a post-fetch comparison — so a wrong-org call cannot even read the row, let
 * alone write it.
 *
 * A cross-org id returns NOT_FOUND, never FORBIDDEN: FORBIDDEN confirms that
 * the id exists, which is a membership oracle over every tenant's site.
 *
 * `resolveMicrositeHost` is the one deliberate exception in this folder — it is
 * public and pre-auth by definition.
 */

import { microsite } from '@borradh-workspace/database';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';

export interface OwnedMicrosite {
  id: string;
  organizationId: string;
  slug: string;
  status: 'draft' | 'published';
  theme: unknown;
  publishedRevisionId: string | null;
  /** The revision the working draft corresponds to; null before the first one. */
  draftRevisionId: string | null;
}

/**
 * Load a microsite ONLY if it belongs to `organizationId`.
 *
 * The org predicate is part of the query. Do not "optimise" this into a lookup
 * by id followed by an equality check — that pattern has shipped a cross-org
 * read in this codebase before, because the check is easy to drop in a later
 * edit while the query keeps working.
 */
export const loadOwnedMicrosite = async (
  db: DbConnection,
  micrositeId: string,
  organizationId: string
): Promise<Result<OwnedMicrosite>> => {
  const row = await db.query.microsite.findFirst({
    where: and(
      eq(microsite.id, micrositeId),
      eq(microsite.organizationId, organizationId)
    ),
    columns: {
      id: true,
      organizationId: true,
      slug: true,
      status: true,
      theme: true,
      publishedRevisionId: true,
      draftRevisionId: true,
    },
  });

  if (!row) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Microsite not found'));
  }

  return ok(row as OwnedMicrosite);
};
