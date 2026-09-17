/**
 * Write the composed blocks onto the microsite's draft pages.
 *
 * `createMicrosite` deliberately creates the four default pages EMPTY — its
 * own comment says composing blocks is provisioning's job, so that a failure
 * here leaves a navigable skeleton rather than a site with no pages. This is
 * that job, and it is the only write provisioning owns.
 *
 * Two details that are not decoration:
 *   - The WHERE clause carries `organizationId` as well as `micrositeId`, the
 *     same boundary `loadOwnedMicrosite` enforces (plan §12). Scoping by
 *     microsite id alone would work and would be one edit away from a
 *     cross-org write.
 *   - One transaction for all four pages. A half-composed site published
 *     between two page writes is a live customer page with a hero and no way
 *     to book.
 */

import { type Database, micrositePage } from '@borradh-workspace/database';
import { logError } from '@borradh-workspace/observability';
import type { MicrositePage } from '@borradh-workspace/web-shared';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';

export const writeComposedPages = async (
  db: DbConnection,
  input: {
    micrositeId: string;
    organizationId: string;
    pages: MicrositePage[];
  }
): Promise<Result<number>> => {
  const { micrositeId, organizationId, pages } = input;

  try {
    await (db as Database).transaction(async (tx) => {
      for (const page of pages) {
        const updated = await tx
          .update(micrositePage)
          .set({
            title: page.title,
            seo: page.seo,
            blocks: page.blocks,
            order: page.order,
          })
          .where(
            and(
              eq(micrositePage.micrositeId, micrositeId),
              eq(micrositePage.organizationId, organizationId),
              eq(micrositePage.path, page.path)
            )
          )
          .returning({ id: micrositePage.id });

        if (updated.length > 0) continue;

        // The default set already contains every path we compose, so this is
        // the "someone changed DEFAULT_MICROSITE_PAGES" path — insert rather
        // than silently drop a page.
        await tx.insert(micrositePage).values({
          micrositeId,
          organizationId,
          path: page.path,
          title: page.title,
          seo: page.seo,
          blocks: page.blocks,
          order: page.order,
          // A site with no home page 404s on its own apex.
          isSystem: page.path === '/',
        });
      }
    });

    return ok(pages.length);
  } catch (error) {
    logError('microsites.writeComposedPages', error, {
      feature: 'microsites',
      extra: { micrositeId, organizationId, pageCount: pages.length },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to write microsite pages'
      )
    );
  }
};
