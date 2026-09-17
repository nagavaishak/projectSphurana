/**
 * Create a microsite (one per org) plus its default, empty page set.
 *
 * IDEMPOTENT BY CONTRACT. Provisioning runs in a BullMQ job, and BullMQ retries
 * — so "already exists" is the NORMAL second call, not an error. If the org
 * already has a microsite this returns it untouched, including its slug and its
 * pages: a retry must never renumber a live site's slug or wipe pages the agent
 * has since written into it.
 *
 * The org-uniqueness is enforced by a UNIQUE constraint on
 * `microsite.organization_id`, so the read-then-insert below is checked twice:
 * once optimistically, and once by postgres when two retries race. The unique
 * violation path re-reads and returns the winner rather than erroring.
 */

import {
  type Database,
  isUniqueViolation,
  microsite,
  micrositePage,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import type { MicrositeTheme } from '@borradh-workspace/web-shared';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { seedMicrositeTheme } from '../seed-microsite-theme/index.js';
import { sanitizeTheme, toFeatureError } from '../shared/index.js';
import {
  type CreateMicrositeInput,
  createMicrositeSchema,
} from './create-microsite.schema.js';

/**
 * The page set every new microsite starts with (plan §8 step 3): Home, About,
 * Services, Contact. Booking is NOT here — it is the existing `/book/{slug}`
 * route, linked to rather than re-implemented as a block page.
 *
 * They start EMPTY. Composing blocks is provisioning's job, and separating the
 * two means a provisioning failure leaves a navigable skeleton rather than a
 * microsite with no pages at all.
 *
 * `/` is `isSystem`: a site with no home page is a 404 on its own apex.
 */
export const DEFAULT_MICROSITE_PAGES = [
  { path: '/', title: 'Home', order: 0, isSystem: true },
  { path: '/about', title: 'About', order: 1, isSystem: false },
  { path: '/services', title: 'Services', order: 2, isSystem: false },
  { path: '/contact', title: 'Contact', order: 3, isSystem: false },
] as const;

export interface CreateMicrositeOutput {
  id: string;
  organizationId: string;
  slug: string;
  status: 'draft' | 'published';
  theme: MicrositeTheme;
  publishedRevisionId: string | null;
  /** False when an existing microsite was returned instead of a new one. */
  created: boolean;
}

const findExisting = async (db: DbConnection, organizationId: string) =>
  db.query.microsite.findFirst({
    where: eq(microsite.organizationId, organizationId),
    columns: {
      id: true,
      organizationId: true,
      slug: true,
      status: true,
      theme: true,
      publishedRevisionId: true,
    },
  });

const createMicrositeImpl = async (
  db: DbConnection,
  input: CreateMicrositeInput
): Promise<Result<CreateMicrositeOutput>> => {
  const parsed = createMicrositeSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, slug } = parsed.data;

  const existing = await findExisting(db, organizationId);
  if (existing) {
    return ok({ ...(existing as CreateMicrositeOutput), created: false });
  }

  // Seeded BEFORE the transaction on purpose: seeding reads the org's brand
  // imagery over the network, and holding a pooled connection across that I/O
  // is exactly what saturated the pool in the meta-sync incident.
  let theme = parsed.data.theme;
  if (!theme) {
    const seeded = await seedMicrositeTheme(db as Database, { organizationId });
    if (!seeded.success) return err(toFeatureError(seeded.error));
    theme = seeded.data;
  }

  try {
    const created = await (db as Database).transaction(async (tx) => {
      const [row] = await tx
        .insert(microsite)
        .values({ organizationId, slug, status: 'draft', theme })
        .returning();

      await tx.insert(micrositePage).values(
        DEFAULT_MICROSITE_PAGES.map((page) => ({
          micrositeId: row.id,
          // Denormalized so `orgRlsPolicy` applies to the page row directly.
          organizationId,
          path: page.path,
          title: page.title,
          order: page.order,
          isSystem: page.isSystem,
          seo: {},
          blocks: [],
        }))
      );

      return row;
    });

    return ok({
      id: created.id,
      organizationId: created.organizationId,
      slug: created.slug,
      status: created.status,
      // The jsonb column is untyped in the schema on purpose (see
      // database/src/schema/microsites.ts): the guarantee comes from parsing
      // here, not from a `.$type<>()` claim about bytes we have not read.
      theme: sanitizeTheme(created.theme, {
        micrositeId: created.id,
        organizationId,
        source: 'create',
      }),
      publishedRevisionId: created.publishedRevisionId,
      created: true,
    });
  } catch (error) {
    // Two retries raced us to the insert. The other one won and the site is
    // correct — that is a success for this caller, not a conflict.
    if (isUniqueViolation(error, 'microsite_organization_id_unique')) {
      const winner = await findExisting(db, organizationId);
      if (winner) {
        return ok({ ...(winner as CreateMicrositeOutput), created: false });
      }
    }
    // A different org already holds this slug. The caller must pick another —
    // this one really is a conflict.
    if (isUniqueViolation(error, 'microsite_slug_unique')) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          'That website address is already taken'
        )
      );
    }

    logError('microsites.createMicrosite', error, {
      feature: 'microsites',
      extra: { organizationId, slug },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to create microsite')
    );
  }
};

export const createMicrosite = (
  db: DbConnection,
  input: CreateMicrositeInput
) =>
  trackedResult(
    'microsites.createMicrosite',
    () => createMicrositeImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        slug: input.slug,
      },
    }
  );

export type CreateMicrositeResult = Awaited<ReturnType<typeof createMicrosite>>;
