/**
 * The business's OWN captions, to show the model rather than describe.
 *
 * The caption prompt has always described a voice ("warm, knowledgeable,
 * confident — sound like a trusted friend") and enumerated rules. Every business
 * gets the same description, so every business gets roughly the same captions.
 *
 * Meanwhile each one has already demonstrated its voice dozens of times: how
 * long its sentences run, how much emoji and where, how it opens and closes, how
 * it phrases a call to action, how many hashtags it uses — even which language
 * it writes in. `build_brand_corpus` has been storing those captions all along
 * and nothing has ever read them.
 *
 * Same finding as the graphics work, applied to text: showing beats telling.
 */

import { brandMediaEmbedding } from '@borradh-workspace/database';
import { and, desc, eq } from 'drizzle-orm';
import type { DbConnection } from '../../../shared/index.js';

/** How many real captions to show. Enough to establish habits, not a corpus. */
const SAMPLE_COUNT = 8;
/**
 * Below this a caption is a link dump, an emoji row or a bare "Book now" —
 * there is no voice in it to copy, and including them teaches the model that
 * one-liners are the house style.
 */
const MIN_CAPTION_CHARS = 80;
/** Rows scanned before filtering. Newest-first, so this is "recent history". */
const SCAN_LIMIT = 60;

export interface CaptionSamples {
  captions: string[];
  /** The org's own average hashtag count, rounded — null when not derivable. */
  averageHashtagCount: number | null;
  /** The org's own average caption length in characters. */
  averageLength: number | null;
}

export function countHashtags(text: string): number {
  return (text.match(/#[\wÀ-ɏ]+/g) ?? []).length;
}

/**
 * Recent, substantial, deduplicated captions for an org.
 *
 * Deduplicates on the opening 60 characters: a post published to both the
 * Facebook page and Instagram is stored twice with an identical caption, and
 * eight samples that are really four posts twice over is a much weaker signal
 * than it looks.
 */
export async function loadCaptionSamples(
  db: DbConnection,
  organizationId: string
): Promise<CaptionSamples> {
  const rows = await db
    .select({
      caption: brandMediaEmbedding.caption,
      postedAt: brandMediaEmbedding.postedAt,
    })
    .from(brandMediaEmbedding)
    .where(
      and(
        eq(brandMediaEmbedding.organizationId, organizationId),
        eq(brandMediaEmbedding.mediaType, 'image')
      )
    )
    .orderBy(desc(brandMediaEmbedding.postedAt))
    .limit(SCAN_LIMIT);

  const seen = new Set<string>();
  const captions: string[] = [];
  for (const row of rows) {
    const caption = (row.caption ?? '').trim();
    if (caption.length < MIN_CAPTION_CHARS) continue;
    const key = caption.slice(0, 60).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    captions.push(caption);
    if (captions.length >= SAMPLE_COUNT) break;
  }

  const mean = (fn: (c: string) => number) =>
    captions.length
      ? Math.round(captions.reduce((n, c) => n + fn(c), 0) / captions.length)
      : null;

  return {
    captions,
    averageHashtagCount: mean(countHashtags),
    averageLength: mean((c) => c.length),
  };
}
