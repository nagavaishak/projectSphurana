import type { VideoDraftConfig } from '@borradh-workspace/database';

/**
 * Which key of `draftConfig` holds a template's ON-SCREEN COPY.
 *
 * WHY THIS EXISTS. `draftConfig` is deliberately flat and template-agnostic:
 * every template reads the fields it cares about and ignores the rest. That is
 * the right storage shape, and it has one sharp edge — writing a key the active
 * template does not read is accepted, persisted, and renders to an identical
 * video. No error anywhere, because nothing is wrong: the write succeeded, and
 * the renderer honestly reproduced a config whose meaningful half never
 * changed.
 *
 * That is exactly how a real edit was lost. Claire was asked to change a line
 * on a `myth-fact-1` video and patched `scriptText` — a real, valid field —
 * when `myth-fact` renders from `mythFact.pairs` and only consults `scriptText`
 * for AI voiceover. The patch persisted, a render was spent, and the words on
 * screen did not move.
 *
 * A partial version of this map already existed inside `regenerate-batch-item`
 * with seven of the seventeen variations, `myth-fact-1` among the missing.
 * Completing it and moving it here is the point: one map, and a new template
 * that forgets to register lands in `UNMAPPED_VARIATIONS` rather than silently
 * becoming un-editable.
 */
export const VARIATION_CONTENT_KEY: Record<string, keyof VideoDraftConfig> = {
  'caption-tease-1': 'captionTease',
  'fade-benefits-1': 'fadeBenefits',
  'aesthetic-line-1': 'aestheticLine',
  'numbered-list-1': 'numberedList',
  'ins-outs-1': 'insOuts',
  'question-cta-1': 'questionCta',
  'improves-1': 'improves',
  'highlight-caption-1': 'textFrames',
  'curiosity-hook-1': 'textFrames',
  'step-timer-1': 'stepTimer',
  'time-progress-1': 'timeProgress',
  'poll-1': 'poll',
  'myth-fact-1': 'mythFact',
  'versus-1': 'versus',
  'price-reveal-1': 'priceReveal',
  'client-question-1': 'clientQuestion',
  'come-with-me-1': 'comeWithMe',
};

/**
 * Every key that belongs to exactly ONE template. Writing one of these on a
 * video built from a different template is always a no-op.
 */
const TEMPLATE_OWNED_KEYS = new Set<string>(
  Object.values(VARIATION_CONTENT_KEY)
);

/**
 * Keys every render consults regardless of template — footage, captions, music,
 * the outro card, orientation, overlays, the offer card. A patch touching any
 * of these always has an effect.
 */
const UNIVERSAL_KEYS = new Set<string>([
  'bRollClips',
  'captions',
  'musicTrackId',
  'musicUrl',
  'musicVolume',
  'outro',
  'orientation',
  'pipOverlays',
  'offerCard',
  'narrationType',
  'aiVoiceId',
  'talkingHeadAssetId',
  'talkingHeadUrl',
  'disclaimer',
  'transcriptText',
  'editedCaptionText',
]);

export interface IneffectivePatchReport {
  /** The keys that this video's render will not read. */
  ignoredKeys: string[];
  /** The key the caller almost certainly meant, when there is one. */
  suggestedKey?: string;
}

/**
 * Report a patch whose every key is ignored by the video it targets.
 *
 * Returns `null` when at least one key has an effect — a mixed patch is fine,
 * and deliberately not flagged: the caller changed something real, and the
 * extra keys are harmless (a client on older code sending a field this
 * template dropped should degrade, not 400).
 *
 * The narrow case this catches is the damaging one: EVERY key is inert, so the
 * call reports success, spends a render, and changes nothing.
 */
export const describeIneffectivePatch = (input: {
  variationId: string | null | undefined;
  narrationType: string | null | undefined;
  patchKeys: string[];
}): IneffectivePatchReport | null => {
  const { variationId, narrationType, patchKeys } = input;
  if (patchKeys.length === 0) return null;

  // No variation means no template to judge against — an offer/ad video, or a
  // row from before variations were recorded. Silence is the only honest
  // answer.
  if (!variationId) return null;

  const ownKey = VARIATION_CONTENT_KEY[variationId];
  // An unmapped variation gets the benefit of the doubt too. Refusing a patch
  // because a template forgot to register would be worse than the no-op this
  // guard exists to prevent.
  if (!ownKey) return null;

  const readsScriptText =
    narrationType === 'ai_voiceover' || narrationType === 'recorded';

  const isEffective = (key: string): boolean => {
    if (UNIVERSAL_KEYS.has(key)) return true;
    if (key === 'scriptText' || key === 'scriptRoles') return readsScriptText;
    if (key === 'hook' || key === 'body' || key === 'cta' || key === 'lists') {
      return readsScriptText;
    }
    if (TEMPLATE_OWNED_KEYS.has(key)) return key === ownKey;
    // Unknown key: not ours to judge. `partialDraftConfigSchema` has already
    // stripped anything that is not part of the config at all.
    return true;
  };

  const ignoredKeys = patchKeys.filter((k) => !isEffective(k));
  if (ignoredKeys.length !== patchKeys.length) return null;

  return {
    ignoredKeys,
    ...(ownKey ? { suggestedKey: ownKey } : {}),
  };
};
