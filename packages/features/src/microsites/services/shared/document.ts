/**
 * Reading a microsite document out of jsonb.
 *
 * `blocks`, `theme` and `seo` are `.$type<T>()` jsonb columns. That is a
 * COMPILE-TIME claim about what we write, and nothing more: postgres round-trips
 * whatever bytes it was given. A row written by an older block schema, by a
 * hand-run SQL fix, or by a future agent tool that shipped a field we later
 * renamed will come back typed but wrong — and the renderer will then crash on
 * a live customer site.
 *
 * So every read goes through here, and the policy is deliberate:
 *
 *   BLOCKS  — an invalid block is DROPPED and logged (`microsites.invalid_block_dropped`).
 *             One bad block must never take down a whole page, let alone a whole
 *             site. A missing section is recoverable by the tenant in the editor;
 *             a 500 on their homepage is not.
 *   SEO     — falls back to `{}` (every field is optional; nothing is lost but
 *             metadata).
 *   THEME   — CANNOT be dropped: the page shell needs the CSS custom properties,
 *             and a page with no theme is not a degraded page, it is an unstyled
 *             one. An invalid theme falls back to `FALLBACK_MICROSITE_THEME` and
 *             logs at ERROR, because unlike a dropped block this is visible on
 *             every page at once and wants a human.
 */

import { createLogger } from '@borradh-workspace/observability';
import type {
  Block,
  MicrositePage,
  MicrositeSeo,
  MicrositeTheme,
} from '@borradh-workspace/web-shared';
import {
  blockSchema,
  micrositeSeoSchema,
  micrositeThemeSchema,
} from '../../blocks/index.js';
import { DEFAULT_MICROSITE_BRAND } from '../seed-microsite-theme/index.js';

const logger = createLogger('MicrositeDocument');

/** Where a sanitized read came from — carried into the logs, nothing else. */
export interface DocumentReadContext {
  micrositeId: string;
  organizationId?: string;
  /** `draft` (page rows) or a revision id. */
  source: string;
}

/**
 * The theme used when the stored one does not parse. Deliberately the same
 * engine defaults `seedMicrositeTheme` falls back to, so "default" means one
 * thing across the feature.
 */
export const FALLBACK_MICROSITE_THEME: MicrositeTheme = {
  brand: { ...DEFAULT_MICROSITE_BRAND },
  logo: { assetUrl: null },
  typography: { scale: 'default' },
  radius: 'md',
  buttonStyle: 'solid',
  density: 'comfortable',
};

/**
 * Validate a stored block list, dropping anything that no longer parses.
 *
 * Returns the survivors in their original order. The dropped count is logged
 * once per page rather than once per block, so a wholesale schema break does
 * not become a log flood.
 */
export function sanitizeBlocks(
  stored: unknown,
  ctx: DocumentReadContext & { path?: string }
): Block[] {
  if (!Array.isArray(stored)) {
    if (stored != null) {
      logger.error('Stored blocks are not an array; rendering an empty page', {
        event: 'microsites.invalid_block_dropped',
        ...ctx,
        droppedCount: 1,
      });
    }
    return [];
  }

  const kept: Block[] = [];
  const dropped: { index: number; reason: string }[] = [];

  stored.forEach((candidate, index) => {
    const parsed = blockSchema.safeParse(candidate);
    if (parsed.success) {
      kept.push(parsed.data as Block);
      return;
    }
    dropped.push({
      index,
      reason: parsed.error.issues[0]?.message ?? 'invalid block',
    });
  });

  if (dropped.length > 0) {
    logger.error('Dropped invalid microsite blocks', {
      event: 'microsites.invalid_block_dropped',
      ...ctx,
      droppedCount: dropped.length,
      keptCount: kept.length,
      dropped,
    });
  }

  return kept;
}

/** Metadata only — an unparseable `seo` degrades to `{}`. */
export function sanitizeSeo(
  stored: unknown,
  ctx: DocumentReadContext & { path?: string }
): MicrositeSeo {
  const parsed = micrositeSeoSchema.safeParse(stored ?? {});
  if (parsed.success) return parsed.data;

  logger.warn('Dropped invalid microsite SEO metadata', {
    event: 'microsites.invalid_seo_dropped',
    ...ctx,
  });
  return {};
}

/** Never dropped — see the file header. */
export function sanitizeTheme(
  stored: unknown,
  ctx: DocumentReadContext
): MicrositeTheme {
  const parsed = micrositeThemeSchema.safeParse(stored);
  if (parsed.success) return parsed.data;

  logger.error('Stored microsite theme is invalid; serving engine defaults', {
    event: 'microsites.invalid_theme_replaced',
    ...ctx,
    issues: parsed.error.issues.map((i) => i.message),
  });
  return { ...FALLBACK_MICROSITE_THEME };
}

/** The shape a `microsite_page` row and a snapshot page have in common. */
interface StoredPageLike {
  id: string;
  path: string;
  title: string;
  seo: unknown;
  blocks: unknown;
  order: number;
  isSystem: boolean;
}

/**
 * A stored page as the renderer wants it.
 *
 * `id`/`path`/`title` are NOT NULL text columns, so they are trusted; only the
 * jsonb is re-validated.
 */
export function sanitizePage(
  row: StoredPageLike,
  ctx: DocumentReadContext
): MicrositePage {
  const pageCtx = { ...ctx, path: row.path };
  return {
    id: row.id,
    path: row.path,
    title: row.title,
    seo: sanitizeSeo(row.seo, pageCtx),
    blocks: sanitizeBlocks(row.blocks, pageCtx),
    order: row.order,
    isSystem: row.isSystem,
  };
}

/**
 * A revision's `pages` jsonb is a whole document, not a row set — an element
 * that is not even page-shaped is dropped outright rather than half-rendered.
 */
export function sanitizeSnapshotPages(
  stored: unknown,
  ctx: DocumentReadContext
): MicrositePage[] {
  if (!Array.isArray(stored)) {
    logger.error('Revision pages are not an array; serving no pages', {
      event: 'microsites.invalid_snapshot_pages',
      ...ctx,
    });
    return [];
  }

  const pages: MicrositePage[] = [];
  for (const candidate of stored) {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      typeof (candidate as { id?: unknown }).id !== 'string' ||
      typeof (candidate as { path?: unknown }).path !== 'string' ||
      typeof (candidate as { title?: unknown }).title !== 'string'
    ) {
      logger.error('Dropped a malformed page from a microsite revision', {
        event: 'microsites.invalid_snapshot_page_dropped',
        ...ctx,
      });
      continue;
    }
    const row = candidate as Record<string, unknown>;
    pages.push(
      sanitizePage(
        {
          id: row.id as string,
          path: row.path as string,
          title: row.title as string,
          seo: row.seo,
          blocks: row.blocks,
          order: typeof row.order === 'number' ? row.order : 0,
          isSystem: row.isSystem === true,
        },
        ctx
      )
    );
  }
  return pages;
}
