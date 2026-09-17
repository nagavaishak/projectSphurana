/**
 * Words that appear in almost every clip description and in almost every
 * request, so matching on them ranks nothing.
 */
const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'the',
  'of',
  'in',
  'on',
  'at',
  'to',
  'for',
  'with',
  'that',
  'this',
  'it',
  'is',
  'was',
  'be',
  'has',
  'have',
  'something',
  'some',
  'one',
  'clip',
  'video',
  'footage',
  'shot',
  'show',
  'showing',
  'me',
  'my',
  'i',
  'want',
  'like',
  'more',
  'other',
  'another',
  'different',
  'change',
  'swap',
  'replace',
]);

/** Lowercase word tokens, stopwords dropped, short tokens dropped. */
export function describeTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2 && !STOPWORDS.has(word))
  );
}

/**
 * Rank clips by how well their description answers what the owner asked for.
 *
 * LEXICAL, NOT SEMANTIC, and deliberately so. The stock bank has pgvector
 * embeddings, but they are computed per SERVICE at match time — there is no
 * query-time embedding path, and adding a model call inside an edit turn would
 * put a network round trip and a cost on "swap the second clip". Word overlap
 * is a poor semantic matcher and a perfectly good filter for the thing owners
 * actually say: "something with the treatment room in it", "a before and
 * after", "one with a face".
 *
 * The bar to clear is not "the best possible clip". It is the behaviour this
 * replaces, which was `candidates.shift()` — the first clip of an arbitrary
 * pool, so "swap clip 2 for something with the treatment room" returned
 * whatever happened to be at the front. Anything that reads the request at all
 * beats that.
 *
 * Ties keep their original order, which is the bank's own ranking (service
 * matches first, generic pool after). A clip that matches NOTHING is not
 * dropped: the owner asked for a swap and gets one, because refusing to swap
 * leaves them with the clip they already said was wrong.
 */
export function rankByDescription<T extends { description?: string | null }>(
  clips: T[],
  query: string | undefined | null
): T[] {
  if (!query?.trim()) return clips;
  const wanted = describeTokens(query);
  if (wanted.size === 0) return clips;

  return clips
    .map((clip, index) => {
      const tokens = describeTokens(clip.description ?? '');
      let hits = 0;
      for (const word of wanted) if (tokens.has(word)) hits += 1;
      return { clip, index, hits };
    })
    .sort((a, b) => b.hits - a.hits || a.index - b.index)
    .map((scored) => scored.clip);
}
