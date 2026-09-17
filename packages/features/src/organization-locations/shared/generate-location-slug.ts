import { organizationLocation } from '@borradh-workspace/database';
import { and, eq } from 'drizzle-orm';
import type { DbConnection } from '../../shared/index.js';

/**
 * Turn a branch name into a URL segment: `"Dublin — City Centre"` → `dublin-city-centre`.
 *
 * Deliberately conservative. It strips accents rather than passing them
 * through, because the slug ends up in a shareable URL that gets copied into
 * emails and chat clients that percent-encode non-ASCII — `/l/dún-laoghaire`
 * pasted back as `/l/d%C3%BAn-laoghaire` is not the readable URL this exists to
 * provide.
 */
export function slugifyLocationName(name: string): string {
  return (
    name
      .normalize('NFD')
      // Every Unicode Mark — i.e. the accents NFD just split off.
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
  );
}

/**
 * A slug for a new branch that is unique WITHIN ITS ORG.
 *
 * Per-org, not global — that is the whole reason the unique constraint was
 * re-grained. Under the old global constraint every tenant with a "Dublin"
 * branch fought for one name and the loser got `dublin-4`; scoped per org, the
 * suffix only appears when the SAME business genuinely has two branches whose
 * names slugify identically, which is rare and where a suffix is honest.
 *
 * Falls back to `branch` for a name that slugifies to nothing (emoji-only, or
 * a name written entirely in a non-Latin script) so the column is always
 * fillable — a null slug is what forces the URL back to a raw id.
 */
export async function generateLocationSlug(
  db: DbConnection,
  input: { organizationId: string; name: string }
): Promise<string> {
  const base = slugifyLocationName(input.name) || 'branch';

  const taken = await db.query.organizationLocation.findMany({
    where: eq(organizationLocation.organizationId, input.organizationId),
    columns: { slug: true },
  });
  const used = new Set(
    taken.map((row) => row.slug).filter((slug): slug is string => Boolean(slug))
  );

  if (!used.has(base)) return base;

  // `-2` reads as "the second Dublin", which is what it is. Starting at 2
  // rather than 1 keeps the first one un-suffixed.
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }

  // 998 identically-named branches in one org is not a real state; fall back to
  // something guaranteed-unique rather than looping forever or throwing.
  return `${base}-${Date.now()}`;
}

/**
 * Does this slug already belong to a DIFFERENT branch in the same org?
 *
 * For the venue editor, where an owner types the slug by hand: the unique
 * constraint would catch a clash, but a 500 from a constraint violation is a
 * worse answer than a field-level "that one is taken".
 */
export async function isLocationSlugTaken(
  db: DbConnection,
  input: { organizationId: string; slug: string; excludeLocationId?: string }
): Promise<boolean> {
  const existing = await db.query.organizationLocation.findFirst({
    where: and(
      eq(organizationLocation.organizationId, input.organizationId),
      eq(organizationLocation.slug, input.slug)
    ),
    columns: { id: true },
  });
  if (!existing) return false;
  return existing.id !== input.excludeLocationId;
}
