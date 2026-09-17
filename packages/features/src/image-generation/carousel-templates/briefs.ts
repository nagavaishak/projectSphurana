/**
 * BRIEFS WITH AN IDENTITY — the registry that replaces composition templates.
 *
 * `semantic-briefs.ts` proved the idea and shipped it behind a switch: a brief
 * says what a post is ABOUT and nothing about how it looks, and a selected
 * brief supersedes the pinned composition template. That left the briefs as
 * bare strings chosen by hashing a graphic id, which is enough to render with
 * and not enough to be a system:
 *
 *   - the app's template picker could not offer them, so it went on offering
 *     carousel templates the deck would then ignore;
 *   - the assistant's `style` argument could only name a template;
 *   - `graphic.template_slug` had nothing brief-shaped to persist, so a
 *     regeneration could not reproduce the brief the first render used.
 *
 * Giving each brief a slug fixes all three, and makes the composition
 * registries deletable rather than merely bypassed.
 *
 * ## What a brief may contain
 *
 * Subject only. No layout, no panel counts, no colour, no button shapes, no
 * word counts, and nothing that could be rendered as a word. Every remaining
 * defect class in the audit that motivated this was something a template ASKED
 * for — a swipe prompt, a vote instruction, a first-person client quote — and
 * the renders duly produced swipe chrome, engagement prompts and invented
 * clients. Appearance comes from the brand's own posts.
 *
 * ## Ads are not briefs
 *
 * An offer ad pins a price badge as the visual hero. That is a real layout
 * requirement rather than a description of a look, so ads keep their
 * composition templates in `single-registry.ts`. See
 * docs/plans/graphic-generation-state-of-play.md §0.
 */

export interface Brief {
  /**
   * Stable id. Persisted in `graphic.template_slug`, accepted by the assistant
   * as `style`, and offered by the template picker — so it must not change once
   * rows exist.
   */
  slug: string;
  /** Shown in the picker. */
  label: string;
  /** When to reach for it. Shown under the label. */
  description: string;
  /** The prose handed to the planner. Subject only. */
  brief: string;
  /**
   * The composition template this brief took over from.
   *
   * Rows written before briefs had slugs hold the old template slug, and the
   * app may still send one. `resolveBriefSlug` maps them across so a
   * regeneration reproduces the deck the first render actually made, rather
   * than silently falling back to a hash of the graphic id.
   */
  replaces?: string;
}

/** One per organic carousel shape. */
export const DECK_BRIEFS: readonly Brief[] = [
  {
    slug: 'walk-through',
    label: 'A walk through the service',
    description: 'First question to booking, in order.',
    brief:
      'a walk through what this service involves, from first question to booking',
    replaces: 'client-journey',
  },
  {
    slug: 'questions-asked-most',
    label: 'The questions people ask most',
    description: 'The recurring ones, answered plainly.',
    brief: 'the questions people ask most about this service, answered plainly',
    replaces: 'therapie',
  },
  {
    slug: 'myths-corrected',
    label: 'Myths, corrected',
    description: 'Common misconceptions taken one at a time.',
    brief: 'the myths about this service, each corrected in turn',
    replaces: 'myth-countdown',
  },
  {
    slug: 'living-with-it',
    label: 'Living with the problem',
    description: 'What it is like before, and what changes after.',
    brief:
      'what it is like to live with the problem this service treats, and what changes once it is dealt with',
    replaces: 'clearskin-blackwhite',
  },
  {
    slug: 'hesitating-then-going',
    label: 'Putting it off, then going',
    description: 'A first-person account of deciding to book.',
    brief:
      'a first-person account of putting this service off, what changed the person’s mind, and how it actually went',
    replaces: 'clearskin-storytime',
  },
  {
    slug: 'reasons-one-at-a-time',
    label: 'Reasons, one at a time',
    description: 'Why someone chooses this, itemised.',
    brief: 'the reasons someone would choose this service, taken one at a time',
    replaces: 'phoenix',
  },
  {
    slug: 'one-treatment-in-depth',
    label: 'One treatment in depth',
    description: 'What it is, what it does, who it is for.',
    brief:
      'one named treatment explained properly — what it is, what it does, and who it is for',
    replaces: 'phoenix-2',
  },
  {
    slug: 'an-ordinary-working-day',
    label: 'An ordinary working day',
    description: 'Opening up to winding down.',
    brief:
      'an ordinary working day at this business, from opening up to winding down',
    replaces: 'day-in-the-life',
  },
  {
    slug: 'two-treatments-compared',
    label: 'Two treatments compared',
    description: 'Honestly, including who each is not for.',
    brief:
      'two of this business’s treatments compared honestly, including who each one is not for',
    replaces: 'treatment-compare',
  },
  {
    slug: 'before-and-after-the-visit',
    label: 'Before and after the visit',
    description: 'How to prepare, and how to look after yourself.',
    brief:
      'how to prepare for this service beforehand, and how to look after yourself afterwards',
    replaces: 'read-before-book',
  },
] as const;

/** One per organic single, plus subjects that never had a template. */
export const SINGLE_BRIEFS: readonly Brief[] = [
  {
    slug: 'two-services-compared',
    label: 'Two services compared',
    description: 'A straight comparison of two things on the menu.',
    brief: 'a comparison between two of the services this business offers',
  },
  {
    slug: 'one-myth-corrected',
    label: 'One myth, corrected',
    description: 'A single misconception, put right.',
    brief: 'one common myth about this service, corrected',
    replaces: 'stat-serif-centered',
  },
  {
    slug: 'first-appointment',
    label: 'What happens first time',
    description: 'What actually happens at a first appointment.',
    brief: 'what actually happens at a first appointment',
  },
  {
    slug: 'aftercare',
    label: 'Aftercare',
    description: 'The days immediately after the treatment.',
    brief: 'how to look after yourself in the days after the treatment',
  },
  {
    slug: 'who-it-suits',
    label: 'Who it suits',
    description: 'And, just as usefully, who it does not.',
    brief: 'who this service suits, and who it does not',
    replaces: 'concern-list-photo',
  },
  {
    slug: 'one-striking-fact',
    label: 'One striking fact',
    description: 'Something most people do not know.',
    brief: 'one striking fact about this service that most people do not know',
    replaces: 'didyouknow-fact',
  },
  {
    slug: 'the-concerns-it-treats',
    label: 'The concerns it treats',
    description: 'What the treatment is actually meant to improve.',
    brief: 'the specific concerns this treatment is meant to improve',
  },
  {
    slug: 'what-the-price-buys',
    label: 'What the price buys',
    description: 'Cost to deliver, and what that buys.',
    brief:
      'what this service costs to deliver and what that price actually buys',
    replaces: 'its-not-cheap-longform',
  },
] as const;

/**
 * RETIRED, and why — two shapes that deliberately have no brief.
 *
 * Kept named rather than deleted so the decision stays visible.
 *
 * `testimonial-quote` asked for a client's first name and a five-star rating,
 * and generation has no source of real ones, so every render invented a
 * customer and a review of a business it had never seen — a fabricated
 * endorsement in the org's own name. A testimonial needs real review text as an
 * INPUT; if that arrives this becomes a brief that quotes it, never one that
 * writes it.
 *
 * `poll-thisorthat` existed for a vote instruction in the footer, which is
 * exactly what `RULE_NO_SOCIAL_CHROME` strips. A shape whose purpose is the
 * thing the rules forbid cannot be reworded into compliance.
 */
export const RETIRED_SHAPES = ['testimonial-quote', 'poll-thisorthat'] as const;

const bySlug = (briefs: readonly Brief[]) => {
  const index = new Map<string, Brief>();
  for (const b of briefs) {
    index.set(b.slug, b);
    if (b.replaces) index.set(b.replaces, b);
  }
  return index;
};

const DECK_INDEX = bySlug(DECK_BRIEFS);
const SINGLE_INDEX = bySlug(SINGLE_BRIEFS);

/**
 * Resolve a slug to a brief, accepting the composition-template slug it
 * replaced. Returns undefined for a retired shape or an unknown string — the
 * caller then falls back to deterministic selection rather than failing a
 * render over a stale pin.
 */
export function getDeckBrief(slug: string): Brief | undefined {
  return DECK_INDEX.get(slug);
}

export function getSingleBrief(slug: string): Brief | undefined {
  return SINGLE_INDEX.get(slug);
}

/**
 * Deterministic selection — the same hash the composition registry used, so a
 * given graphic always maps to the same shape and a batch spreads across them.
 * Reusing the mechanism means the editorial spread of a month did not change
 * when the source of variety did.
 */
function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function selectDeckBriefForSeed(seed: string): Brief {
  return DECK_BRIEFS[hashSeed(seed) % DECK_BRIEFS.length];
}

export function selectSingleBriefForSeed(seed: string): Brief {
  return SINGLE_BRIEFS[hashSeed(seed) % SINGLE_BRIEFS.length];
}

/**
 * The brief a render should use: an explicit pin when it names a live shape,
 * otherwise deterministic selection from the seed.
 *
 * A pin that names a RETIRED shape falls through to selection deliberately —
 * the alternative is failing the render or reviving the defect the shape was
 * retired for.
 */
export function resolveDeckBrief(
  pinned: string | undefined,
  seed: string
): Brief {
  return (
    (pinned ? getDeckBrief(pinned) : undefined) ?? selectDeckBriefForSeed(seed)
  );
}

export function resolveSingleBrief(
  pinned: string | undefined,
  seed: string
): Brief {
  return (
    (pinned ? getSingleBrief(pinned) : undefined) ??
    selectSingleBriefForSeed(seed)
  );
}

/**
 * Compose the brief with the month's planned topic.
 *
 * The brief says what SHAPE the post takes; the topic says what it is about,
 * and both are needed. Selection hashed the graphic id while the planner chose
 * the topic independently, and the template's `copySpec` then won — three
 * singles in one production batch rendered a testimonial, a stat tile and a
 * poll for topics that asked for none of those things. Carrying the topic into
 * the brief is what stops the plan being silently discarded.
 */
export function briefWithTopic(brief: string, topic: string): string {
  const t = topic.trim();
  return t ? `${brief} — specifically: ${t}` : brief;
}
