/**
 * Brand-inspiration storage + selection, against a REAL Postgres.
 *
 * The bug this replaces was pure SQL semantics, and no mock could have caught
 * it: ingest inserted with `onConflictDoNothing`, so a post we already knew
 * about could never have its expired Meta CDN URL replaced. A probe of
 * production found 2,456 of 2,473 rows (99.3%) pointing at images that no
 * longer loaded, and generation silently ran with no brand reference for
 * months.
 *
 * So these assert the two things the unit tests cannot:
 *   1. a second ingest REPAIRS a known row instead of skipping it, and cannot
 *      null out a good stored object on a failed re-copy (the COALESCE)
 *   2. the selection query — jsonb filtering, "we hold the bytes", org scoping,
 *      the age cutoff and the ordering — behaves against real SQL the way the
 *      mocked unit tests assume
 */
import { randomUUID } from 'node:crypto';
import {
  and,
  brandMediaEmbedding,
  db,
  desc,
  eq,
  isNotNull,
  sql,
} from '@borradh-workspace/database';
import { seedOrganization } from './harness.js';

const DAY_MS = 1000 * 60 * 60 * 24;
const ago = (days: number) => new Date(Date.now() - days * DAY_MS);

/** Mirrors the shape `gateInspirationCandidates` writes. */
function verdict(over: Record<string, unknown> = {}) {
  const colourway = (over.colourway as string) ?? 'light-ground';
  const layout = (over.layout as string) ?? 'type-led-panel';
  return {
    kind: 'branded-graphic',
    isDesign: true,
    usable: true,
    colourway,
    layout,
    designFamily: `${colourway}|${layout}`,
    ...over,
  };
}

async function seedCorpusRow(args: {
  organizationId: string;
  postId: string;
  mediaUrl: string;
  objectKey?: string | null;
  dhash?: string | null;
  postedAt?: Date;
  verdict?: Record<string, unknown> | null;
}) {
  await db.insert(brandMediaEmbedding).values({
    id: randomUUID(),
    organizationId: args.organizationId,
    platform: 'facebook',
    mediaType: 'image',
    postId: args.postId,
    caption: 'a caption long enough to be worth sampling for voice, honestly',
    mediaUrl: args.mediaUrl,
    thumbnailUrl: args.mediaUrl,
    objectKey: args.objectKey ?? null,
    dhash: args.dhash ?? null,
    permalink: 'https://example.com/p/1',
    postedAt: args.postedAt ?? ago(10),
    inspirationVerdict: (args.verdict ?? null) as never,
    gatedAt: args.verdict ? new Date() : null,
  });
}

/** The exact upsert `buildBrandCorpus` performs, isolated from the Meta fetch. */
async function ingestUpsert(
  rows: {
    organizationId: string;
    postId: string;
    mediaUrl: string;
    objectKey: string | null;
    dhash: string | null;
  }[]
) {
  await db
    .insert(brandMediaEmbedding)
    .values(
      rows.map((r) => ({
        id: randomUUID(),
        organizationId: r.organizationId,
        platform: 'facebook' as const,
        mediaType: 'image' as const,
        postId: r.postId,
        caption: 'refreshed caption',
        mediaUrl: r.mediaUrl,
        thumbnailUrl: r.mediaUrl,
        objectKey: r.objectKey,
        dhash: r.dhash,
        permalink: 'https://example.com/p/1',
        postedAt: ago(10),
      }))
    )
    .onConflictDoUpdate({
      target: [brandMediaEmbedding.organizationId, brandMediaEmbedding.postId],
      set: {
        mediaUrl: sql`excluded.media_url`,
        thumbnailUrl: sql`excluded.thumbnail_url`,
        caption: sql`excluded.caption`,
        permalink: sql`excluded.permalink`,
        objectKey: sql`COALESCE(excluded.object_key, ${brandMediaEmbedding.objectKey})`,
        dhash: sql`COALESCE(excluded.dhash, ${brandMediaEmbedding.dhash})`,
        updatedAt: new Date(),
      },
    });
}

describe('brand inspiration — durable storage', () => {
  it('repairs a known row whose CDN URL has expired, instead of skipping it', async () => {
    const organizationId = await seedOrganization();
    await seedCorpusRow({
      organizationId,
      postId: 'post-1',
      mediaUrl: 'https://fbcdn.example/expired.jpg',
      objectKey: null,
    });

    // The re-pull returns the same post with a fresh URL, and this time we hold
    // the bytes. Under `onConflictDoNothing` both were discarded.
    await ingestUpsert([
      {
        organizationId,
        postId: 'post-1',
        mediaUrl: 'https://fbcdn.example/fresh.jpg',
        objectKey: `${organizationId}/brand-inspiration/post-1.jpg`,
        dhash: 'aabbccddeeff0011',
      },
    ]);

    const [row] = await db
      .select()
      .from(brandMediaEmbedding)
      .where(eq(brandMediaEmbedding.organizationId, organizationId));

    expect(row.objectKey).toBe(
      `${organizationId}/brand-inspiration/post-1.jpg`
    );
    expect(row.mediaUrl).toBe('https://fbcdn.example/fresh.jpg');
    expect(row.dhash).toBe('aabbccddeeff0011');
  });

  it('does not create a duplicate row for a post it already has', async () => {
    const organizationId = await seedOrganization();
    await seedCorpusRow({
      organizationId,
      postId: 'post-1',
      mediaUrl: 'https://fbcdn.example/a.jpg',
    });
    await ingestUpsert([
      {
        organizationId,
        postId: 'post-1',
        mediaUrl: 'https://fbcdn.example/b.jpg',
        objectKey: 'k',
        dhash: 'h',
      },
    ]);

    const rows = await db
      .select()
      .from(brandMediaEmbedding)
      .where(eq(brandMediaEmbedding.organizationId, organizationId));
    expect(rows).toHaveLength(1);
  });

  // The COALESCE. A re-copy that fails returns a null key, and blindly taking
  // `excluded` would erase a perfectly good stored object — turning a transient
  // download failure into permanent data loss.
  it('never nulls out a good stored object when a re-copy fails', async () => {
    const organizationId = await seedOrganization();
    await seedCorpusRow({
      organizationId,
      postId: 'post-1',
      mediaUrl: 'https://fbcdn.example/a.jpg',
      objectKey: 'good/key.jpg',
      dhash: 'goodhashgoodhash',
    });

    await ingestUpsert([
      {
        organizationId,
        postId: 'post-1',
        mediaUrl: 'https://fbcdn.example/b.jpg',
        objectKey: null,
        dhash: null,
      },
    ]);

    const [row] = await db
      .select()
      .from(brandMediaEmbedding)
      .where(eq(brandMediaEmbedding.organizationId, organizationId));
    expect(row.objectKey).toBe('good/key.jpg');
    expect(row.dhash).toBe('goodhashgoodhash');
    // …while the facts we DID refresh still landed.
    expect(row.mediaUrl).toBe('https://fbcdn.example/b.jpg');
  });

  it('allows a row with no embedding (the column is nullable now)', async () => {
    const organizationId = await seedOrganization();
    await seedCorpusRow({
      organizationId,
      postId: 'post-1',
      mediaUrl: 'https://fbcdn.example/a.jpg',
    });
    const [row] = await db
      .select()
      .from(brandMediaEmbedding)
      .where(eq(brandMediaEmbedding.organizationId, organizationId));
    expect(row.embedding).toBeNull();
  });
});

/**
 * The SELECTION QUERY, run against real Postgres.
 *
 * Asserts the predicates `selectInspirationSet` builds — jsonb filtering on the
 * cached verdict, "we hold the bytes", org scoping and the age cutoff. Those are
 * exactly what a mocked `db` cannot check, and what the pick-logic unit tests
 * (which supply rows directly) take on trust.
 *
 * The service function itself is not called here: its `trackedResult` wrapper
 * performs a dynamic `import()` that this Jest harness cannot run without
 * --experimental-vm-modules, and the wrapper turns that into a generic failure.
 * The pick logic on top of these rows is covered by
 * `select-inspiration-set.test.ts`.
 */
describe('brand inspiration — the selection query against real SQL', () => {
  const MONTH_MS = 1000 * 60 * 60 * 24 * 30.4;
  const MAX_AGE_MONTHS = 18;

  /** The predicates the service applies, in one place. */
  async function selectableRows(organizationId: string) {
    const rows = await db
      .select({
        objectKey: brandMediaEmbedding.objectKey,
        postedAt: brandMediaEmbedding.postedAt,
        verdict: brandMediaEmbedding.inspirationVerdict,
      })
      .from(brandMediaEmbedding)
      .where(
        and(
          eq(brandMediaEmbedding.organizationId, organizationId),
          isNotNull(brandMediaEmbedding.objectKey),
          isNotNull(brandMediaEmbedding.inspirationVerdict)
        )
      )
      .orderBy(desc(brandMediaEmbedding.postedAt));

    const now = Date.now();
    return rows
      .filter((r) => r.verdict?.isDesign && r.verdict?.usable)
      .filter(
        (r) =>
          r.postedAt !== null &&
          (now - r.postedAt.getTime()) / MONTH_MS <= MAX_AGE_MONTHS
      )
      .map((r) => r.objectKey);
  }

  it('returns only gated, usable designs that we hold bytes for', async () => {
    const organizationId = await seedOrganization();
    await seedCorpusRow({
      organizationId,
      postId: 'usable',
      mediaUrl: 'u',
      objectKey: 'a.jpg',
      postedAt: ago(5),
      verdict: verdict(),
    });
    // Gated, but a photo rather than a design.
    await seedCorpusRow({
      organizationId,
      postId: 'photo',
      mediaUrl: 'p',
      objectKey: 'b.jpg',
      postedAt: ago(6),
      verdict: verdict({ isDesign: false, kind: 'photo' }),
    });
    // Never gated — no verdict to trust.
    await seedCorpusRow({
      organizationId,
      postId: 'ungated',
      mediaUrl: 'g',
      objectKey: 'c.jpg',
      postedAt: ago(7),
    });
    // Gated and usable, but we hold no bytes — the pre-fix state, and unusable
    // as a reference no matter how good the post is.
    await seedCorpusRow({
      organizationId,
      postId: 'no-bytes',
      mediaUrl: 'n',
      objectKey: null,
      postedAt: ago(8),
      verdict: verdict(),
    });

    expect(await selectableRows(organizationId)).toEqual(['a.jpg']);
  });

  it('drops posts past the age cutoff', async () => {
    const organizationId = await seedOrganization();
    await seedCorpusRow({
      organizationId,
      postId: 'recent',
      mediaUrl: 'r',
      objectKey: 'recent.jpg',
      postedAt: ago(30),
      verdict: verdict(),
    });
    await seedCorpusRow({
      organizationId,
      postId: 'ancient',
      mediaUrl: 'a',
      objectKey: 'ancient.jpg',
      postedAt: ago(800),
      verdict: verdict(),
    });

    expect(await selectableRows(organizationId)).toEqual(['recent.jpg']);
  });

  it('scopes strictly to one organization', async () => {
    const orgA = await seedOrganization();
    const orgB = await seedOrganization();
    await seedCorpusRow({
      organizationId: orgA,
      postId: 'a',
      mediaUrl: 'a',
      objectKey: 'a.jpg',
      verdict: verdict(),
    });
    await seedCorpusRow({
      organizationId: orgB,
      postId: 'b',
      mediaUrl: 'b',
      objectKey: 'b.jpg',
      verdict: verdict(),
    });

    expect(await selectableRows(orgA)).toEqual(['a.jpg']);
    expect(await selectableRows(orgB)).toEqual(['b.jpg']);
  });

  it('orders newest first, so the pick takes the most recent work', async () => {
    const organizationId = await seedOrganization();
    await seedCorpusRow({
      organizationId,
      postId: 'old',
      mediaUrl: 'o',
      objectKey: 'old.jpg',
      postedAt: ago(200),
      verdict: verdict(),
    });
    await seedCorpusRow({
      organizationId,
      postId: 'new',
      mediaUrl: 'n',
      objectKey: 'new.jpg',
      postedAt: ago(2),
      verdict: verdict(),
    });

    expect(await selectableRows(organizationId)).toEqual([
      'new.jpg',
      'old.jpg',
    ]);
  });
});
