/**
 * Footage spec provenance — SOURCE OF TRUTH. Pure TypeScript, no Drizzle/DB
 * imports.
 *
 * These two enums exist to keep the system HONEST about where a piece of
 * footage-matching metadata came from. The b-roll matcher gates on them: a spec
 * that was only guessed from a service name must not unlock the same
 * exact-match procedure clips as one a clinician actually confirmed.
 *
 * See docs/plans/stock-footage-matching-architecture.md.
 */

/** Where a SERVICE's footage spec (agent, regions) came from. */
export const serviceSpecSourceLabels = {
  /** A human at the clinic confirmed it. The only fully trusted state. */
  declared: 'Confirmed by clinic',
  /**
   * Derived from the service name by the alias classifier. Good enough for
   * technique-grade matching; not enough to assert which specific machine a
   * clinic owns when several share a technique.
   */
  inferred_from_name: 'Inferred from name',
  /**
   * Nothing is known. The service name carries no treatment information
   * ("Chin", "Extra Large", "Body Contouring"). Procedure clips are refused;
   * the matcher falls back to ambient footage and reports a footage gap.
   */
  unknown: 'Not specified',
} as const;

export const serviceSpecSourceValues = Object.keys(serviceSpecSourceLabels) as [
  keyof typeof serviceSpecSourceLabels,
  ...(keyof typeof serviceSpecSourceLabels)[],
];

export type ServiceSpecSource = keyof typeof serviceSpecSourceLabels;

/** Where a CLIP's declared agent came from. */
export const clipAgentSourceLabels = {
  /**
   * A human curator labelled it when the clip entered the bank. Stock footage
   * is always this — it is labelled once, by whoever filmed or selected it,
   * and never inferred.
   */
  curated: 'Curated',
  /**
   * Inherited from the service this upload was linked to. Reliable when the
   * org has exactly one agent for the observed technique — a clip at a clinic
   * that only owns an Endospheres machine is Endospheres footage.
   */
  inherited: 'Inherited from service',
  /**
   * Identity unknown. Either nothing was linked, or the org owns several
   * machines of the same technique and the ambiguity was NOT resolved by
   * guessing. Treated as unknown by the gate — never as fact.
   */
  unconfirmed: 'Unconfirmed',
} as const;

export const clipAgentSourceValues = Object.keys(clipAgentSourceLabels) as [
  keyof typeof clipAgentSourceLabels,
  ...(keyof typeof clipAgentSourceLabels)[],
];

export type ClipAgentSource = keyof typeof clipAgentSourceLabels;

/**
 * How a stock clip entered the bank. Internal only — deliberately NOT a labels
 * record, because this is never surfaced in the product. No display strings
 * exist for it and none should be added.
 *
 * It exists for one functional reason: whether the clip's agent identity may be
 * DECLARED. That is a question about observability, not provenance. Machine
 * identity is not visible in pixels — a handpiece on an abdomen looks the same
 * whichever machine it belongs to (2026-07-29 prod audit, see
 * docs/plans/stock-footage-matching-architecture.md) — so only someone present
 * at filming can assert it. Anyone reviewing footage they did not shoot is
 * looking at the same pixels a model would.
 */
export const stockClipSourceValues = [
  /** Filmed by us. Whoever curated it was present and knows the machine. */
  'shot',
  /** Came from an external library. Deliberately does not record which one. */
  'provider',
  /**
   * Contributed by a clinic from its own uploads under a sharing grant. The
   * contributing clinic owns the machine, so it can declare the agent.
   */
  'pooled',
] as const;

export type StockClipSource = (typeof stockClipSourceValues)[number];

/**
 * The only values permitted to carry a non-null `agent_slug`. Everything else
 * is limited to technique-grade matching, so a body-contouring service with no
 * own footage correctly falls through to ambient plus a footage-gap signal
 * rather than being handed the wrong machine.
 */
export const agentDeclarableSources = [
  'shot',
  'pooled',
] as const satisfies readonly StockClipSource[];

/** How tightly a clip is framed. Observable, so safe to infer from pixels. */
export const clipFramingLabels = {
  /** Instrument and skin fill the frame. The default for face regions. */
  close_up: 'Close-up',
  /** Subject and immediate surroundings. The default for body regions. */
  mid: 'Mid-shot',
  /** Room or full scene — establishing shots, mostly ambient. */
  wide: 'Wide',
} as const;

export const clipFramingValues = Object.keys(clipFramingLabels) as [
  keyof typeof clipFramingLabels,
  ...(keyof typeof clipFramingLabels)[],
];

export type ClipFraming = keyof typeof clipFramingLabels;

/**
 * Body regions — the second gate axis, and as load-bearing as the agent.
 *
 * Eyebrow filler and lip filler are the same syringe and completely different
 * shots; laser hair removal splits into ~40 body-part variants across 20 orgs.
 * A matcher that gates only on the machine will happily put a tear-trough clip
 * on a jawline-filler video.
 *
 * CLOSED vocabulary, unlike `treatment_agent` — the human body does not gain
 * new regions, so the argument for row-based extensibility does not apply here.
 * Granularity is set by what is VISUALLY DISTINCT in a shot, not by anatomy:
 * `cheeks_midface` and `jaw_chin_jawline` are separate because the framing
 * differs, while individual fingers are not, because nobody films them apart.
 */
export const bodyRegionLabels = {
  full_face: 'Full face',
  forehead_brow: 'Forehead & brow',
  eyes_tear_trough: 'Eyes & tear trough',
  nose: 'Nose',
  lips: 'Lips',
  cheeks_midface: 'Cheeks & mid-face',
  jaw_chin_jawline: 'Jaw, chin & jawline',
  neck: 'Neck',
  chest_decolletage: 'Chest & décolletage',
  underarms: 'Underarms',
  arms: 'Arms & shoulders',
  hands: 'Hands',
  back: 'Back',
  stomach_abdomen: 'Stomach & abdomen',
  buttocks: 'Buttocks',
  thighs: 'Thighs',
  legs: 'Legs',
  /**
   * Bikini line, Brazilian, Hollywood, peri-anal, vajacial and intimate
   * rejuvenation — 17 services across 5 orgs in the 2026-07-29 audit.
   *
   * The matcher NEVER serves a procedure clip for this region, at any grade,
   * regardless of how well-stocked the bank is. Such footage cannot appear in
   * a marketing video, so these services route to ambient by rule. This is a
   * product decision encoded in the vocabulary, not a coverage gap to fill.
   */
  bikini_intimate: 'Bikini & intimate',
  scalp_hair: 'Scalp & hair',
  feet_nails: 'Feet & toenails',
  hands_nails: 'Hands & nails',
  teeth: 'Teeth',
  full_body: 'Full body',
} as const;

export const bodyRegionValues = Object.keys(bodyRegionLabels) as [
  keyof typeof bodyRegionLabels,
  ...(keyof typeof bodyRegionLabels)[],
];

export type BodyRegion = keyof typeof bodyRegionLabels;

/**
 * Regions that must never receive a procedure clip. Read by the matcher gate;
 * kept as data rather than an `if` so the rule is visible next to the
 * vocabulary it constrains.
 */
export const NON_FILMABLE_REGIONS: readonly BodyRegion[] = ['bikini_intimate'];
