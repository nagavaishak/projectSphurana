/**
 * What a regeneration is TRYING to change — declared, not inferred.
 *
 * WHY THIS EXISTS
 * ---------------
 * One regenerate path serves several intents: change the words, change the
 * photo, re-roll entirely. Its behaviour was tuned by adjusting which
 * reference images and instructions the model receives — and every tuning was
 * a trade, because the inputs that make one intent work are the inputs that
 * break another.
 *
 * That produced a repeating failure: a symptom is reported, the path is
 * narrowed until the symptom stops, and an adjacent capability silently dies.
 * Concretely, "changing the headline changes the whole image" was fixed by
 * withholding the subject photo on every amendment — which made "change the
 * background image" impossible, because the new photo could no longer reach
 * the model. Nothing failed; the endpoint stayed reachable and the tool kept
 * its parameter. The capability just stopped working.
 *
 * The endpoint-coverage gate cannot catch this. It grades whether Claire can
 * REACH a route; this is about what the route still DOES. Reachable is not
 * capable.
 *
 * So intent is now explicit, and the inputs each intent needs live in ONE
 * table below rather than in conditionals spread through the generator. Adding
 * or tuning an intent cannot silently degrade another, and each row is
 * asserted by a capability test — removing an input a capability depends on is
 * a build failure rather than a customer report weeks later.
 */

/** What this regeneration is changing. */
export type RegenerationIntent =
  /** The words. Imagery, layout and styling must not move. */
  | 'copy'
  /** The photography. Copy, layout and styling must not move. */
  | 'image'
  /**
   * The BRANDING — logo presence, placement, variant. Copy AND photography
   * must not move.
   *
   * Added because "put my logo in the top right" had nowhere to go. It is not
   * `copy` (which pins the picture — and the logo is part of the picture, so
   * the request was delivered and then explicitly contradicted), not `image`
   * (which licenses replacing the photography, and did: an aesthetics clinic's
   * own treatment-room photo came back as a stock dental surgery), and not
   * `full` (which discards the copy). Inference sent it to `copy`, so the
   * instruction reached the model alongside "do not change the imagery".
   */
  | 'branding'
  /**
   * A DIFFERENT slide of the same deck, built from a finished sibling.
   *
   * Not an amendment — nothing about the reference slide is being changed. The
   * sibling is there because an edit reproduces pixels it can see while a
   * generation re-decides them, and the background is the thing that keeps
   * being re-decided.
   */
  | 'sibling'
  /** Everything — a fresh composition, not an amendment. */
  | 'full';

/**
 * Which inputs the model receives for an intent.
 *
 * Each flag exists because sending it, or withholding it, changes whether a
 * capability works — they are not stylistic preferences.
 */
export interface AmendmentInputs {
  /**
   * The previous render, as the thing being edited.
   *
   * Absent, the model composes something new and the "change one word"
   * request becomes a full re-roll.
   */
  priorImage: boolean;
  /**
   * The service photo.
   *
   * Required for `image` — it IS the new photograph, and withholding it makes
   * the swap impossible. Kept for `copy` too: it is the same imagery already
   * in the prior render but a cleaner source (the prior render reaches the
   * model downscaled with text baked over it), so it reinforces rather than
   * competes.
   */
  subjectPhoto: boolean;
  /**
   * The curated layout/inspiration image.
   *
   * Withheld on any amendment. It carries its own "reproduce this structure
   * FAITHFULLY" instruction, which genuinely conflicts with the prior render —
   * two references both claiming to define the composition, which the model
   * resolves by composing a third thing.
   */
  layoutInspiration: boolean;
  /**
   * A real post of the brand's, as an aesthetic reference.
   *
   * Withheld on any amendment for the same reason: "match this feel" is
   * licence to restyle, and the prior render already embodies the brand.
   */
  brandExample: boolean;
  /**
   * Logo and font references.
   *
   * Always sent. They guard REPRODUCTION fidelity rather than composition —
   * without the logo the model invents a wordmark, which is its own
   * long-running complaint.
   */
  brandAssets: boolean;
}

/**
 * The single source of truth for what each intent sends.
 *
 * Read this table to answer "why did that render receive X?", and change it —
 * rather than a conditional somewhere in the generator — to alter behaviour.
 */
const INTENT_INPUTS: Record<RegenerationIntent, AmendmentInputs> = {
  /**
   * BUILDING a sibling, not amending one.
   *
   * Inputs follow `copy` — the sibling already carries the design, so a layout
   * reference or a brand example would only offer a second opinion about how
   * the deck should look, and the model resolves two opinions by recomposing.
   * The subject photo IS sent: this slide has its own, and unlike a real
   * amendment there is no previous photograph here worth preserving.
   */
  sibling: {
    priorImage: true,
    subjectPhoto: true,
    layoutInspiration: false,
    brandExample: false,
    brandAssets: true,
  },
  copy: {
    priorImage: true,
    subjectPhoto: true,
    layoutInspiration: false,
    brandExample: false,
    brandAssets: true,
  },
  image: {
    priorImage: true,
    subjectPhoto: true,
    layoutInspiration: false,
    brandExample: false,
    brandAssets: true,
  },
  branding: {
    priorImage: true,
    // NOT sent. The prior render already contains the photography, and the
    // resolver re-picks by rotation — so supplying "the service photo" here
    // supplies a DIFFERENT photo than the one being amended, and the model
    // resolves the conflict by re-composing around the newcomer. That is
    // exactly how "add the logo" returned a different background.
    subjectPhoto: false,
    layoutInspiration: false,
    brandExample: false,
    brandAssets: true,
  },
  full: {
    priorImage: false,
    subjectPhoto: true,
    layoutInspiration: true,
    brandExample: true,
    brandAssets: true,
  },
};

export function inputsForIntent(intent: RegenerationIntent): AmendmentInputs {
  return INTENT_INPUTS[intent];
}

/**
 * The instruction that frames an amendment.
 *
 * `copy` and `image` send the same inputs but must NAME different things as
 * fixed — otherwise "reproduce it faithfully" fights the very change being
 * asked for, and the swap silently no-ops.
 */
export function amendmentDirective(intent: RegenerationIntent): string | null {
  switch (intent) {
    case 'copy':
      return 'A PREVIOUS version of this graphic is provided as a reference image. Reproduce it faithfully — same photography, layout, composition, branding, fonts and overall design — and change ONLY the wording requested below. Do not re-crop, restyle or re-compose anything.';
    case 'branding':
      return 'A PREVIOUS version of this graphic is provided as a reference image. Reproduce it EXACTLY — same photography, same wording, same layout, same typography, same colours — and change ONLY the logo as requested below (its presence, position or variant). Do not re-crop, restyle, re-typeset or replace the photograph, and do not reword any text.';
    case 'sibling':
      return 'A FINISHED SLIDE from this same carousel is provided as a reference image. You are building the NEXT slide of that deck — a different slide, not a copy. Keep its BACKGROUND exactly: the same ground colour, the same tone and lightness, the same texture or gradient if it has one, edge to edge. Keep its palette and which colour plays which role, its typefaces and their relative sizes, its type treatment and its margins. The COPY and any PHOTOGRAPH are its own and are expected to DIFFER — reusing the reference’s wording or its photograph is a defect, not a match.';
    case 'image':
      return 'A PREVIOUS version of this graphic is provided as a reference image, together with a NEW service photo. REPLACE the photography with the new photo and keep everything else from the previous version identical — same layout, composition, wording, branding, fonts and logo placement. Do not reword or re-typeset any text.';
    default:
      return null;
  }
}

/**
 * Work out the intent when a caller hasn't declared one.
 *
 * Inference is a COMPATIBILITY SHIM for callers that predate the explicit
 * field, not the mechanism — the point of this module is that intent is
 * stated. New callers should pass it.
 */
export function inferRegenerationIntent(args: {
  hasPriorImage: boolean;
  /** Asset ids supplied on THIS call, not inherited from the source graphic. */
  explicitSourceAssetIds?: string[];
  refinementInstruction?: string;
}): RegenerationIntent {
  if (!args.hasPriorImage) return 'full';
  // Choosing a photo is the request; a wording tweak alongside it is
  // secondary, and the `image` directive holds the copy anyway.
  if (args.explicitSourceAssetIds?.length) return 'image';
  const instruction = args.refinementInstruction?.trim();
  if (!instruction) return 'full';
  // A brand-mark request is about the picture, so `copy` — which tells the
  // model the picture must not move — is the one answer guaranteed to fail it.
  // Narrow and keyword-based on purpose: this is the compatibility shim for
  // callers that do not state intent, and the review thread now states it.
  if (/\b(logo|wordmark|watermark|brand ?mark|monogram)\b/i.test(instruction)) {
    return 'branding';
  }
  return 'copy';
}
