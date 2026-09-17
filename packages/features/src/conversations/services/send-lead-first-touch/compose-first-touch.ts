/**
 * Compose Claire's opening message to a new lead-form lead.
 *
 * The qualifying question is NOT invented here. It mirrors the
 * `=== TREATMENT-SPECIFIC FOLLOW-UPS ===` block in
 * `chatbots/services/generate-ai-response/prompt-templates.ts`, so the opener
 * asks the same question Claire would have asked had the lead messaged first,
 * and the handoff into the normal flow reads as one voice.
 *
 * **If you change the wording in either place, change it in both.** They are
 * paired by convention, not by the type system — the prompt is one large prose
 * string and extracting these lines out of it would need a held-out eval run
 * to prove Claire's behaviour is unchanged.
 *
 * The important case is LOW_QUALIFICATION: a Japanese head spa, a massage or a
 * float has no "problem area", and asking what's bothering someone about a
 * relaxation treatment reads as a script that hasn't been read. Those get no
 * question at all.
 */

export type TreatmentCategory =
  | 'injectable'
  | 'anti_wrinkle'
  | 'skin'
  | 'body'
  | 'low_qualification'
  | 'semi_permanent_makeup'
  | 'hair'
  | 'unknown';

const CATEGORY_KEYWORDS: Array<[TreatmentCategory, string[]]> = [
  // Order matters: the first category whose keyword appears wins, so the
  // narrower categories are listed before the broader ones.
  [
    'low_qualification',
    [
      'head spa',
      'float',
      'flotation',
      'floatation',
      'massage',
      'facial',
      'sauna',
      'cryotherapy',
      'brow',
      'lash',
    ],
  ],
  [
    'semi_permanent_makeup',
    ['microblading', 'powder brows', 'lip blush', 'semi-permanent'],
  ],
  ['anti_wrinkle', ['anti-wrinkle', 'anti wrinkle', 'botox', 'wrinkle']],
  [
    'injectable',
    ['lip filler', 'dermal filler', 'cheek filler', 'jaw filler', 'filler'],
  ],
  [
    'skin',
    [
      'microneedling',
      'chemical peel',
      'peel',
      'laser',
      'skin booster',
      'ipl',
      'skin',
    ],
  ],
  [
    'body',
    [
      'fat freezing',
      'body contouring',
      'body sculpting',
      'cavitation',
      'vaser',
      'coolsculpt',
    ],
  ],
  ['hair', ['prp', 'hair growth', 'scalp', 'hair loss', 'hair']],
];

export function categoriseTreatment(
  serviceName: string | null | undefined
): TreatmentCategory {
  if (!serviceName?.trim()) return 'unknown';
  const name = serviceName.toLowerCase();
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((k) => name.includes(k))) return category;
  }
  return 'unknown';
}

/**
 * The qualifying question for a category, or `null` when asking one would be
 * wrong. Wording is copied from the prompt template — see the note at the top.
 */
export function qualifyingQuestion(category: TreatmentCategory): string | null {
  switch (category) {
    case 'injectable':
      return 'What kind of look are you going for? Some people want a subtle bit of volume and others want more definition, our specialist tailors it to what suits your face so its good to know what you have in mind.';
    case 'anti_wrinkle':
      return 'What areas are bothering you most? Forehead, around the eyes, frown lines? Our specialist can go through what would work best for you.';
    case 'skin':
      return "Would you mind sharing what skin concerns you are having at the moment that we can help with? Whether its scarring, texture, pigmentation or fine lines, it helps to know what's bothering you most so our specialist knows what to focus on.";
    case 'body':
      return "What's the problem area you'd like to work on? Once I know that I can give you more info on what to expect.";
    case 'semi_permanent_makeup':
      return 'Have you had this done before or would this be your first time? Our specialist can talk you through the look you want.';
    case 'hair':
      return "What's going on with your hair at the moment? Whether its thinning, shedding or you just want to improve the quality, its good to know so our specialist can recommend the right approach.";
    case 'low_qualification':
      // No clinical assessment needed — asking "what's bothering you" about a
      // head spa is the exact mismatch this branch exists to avoid.
      return null;
    case 'unknown':
      return "What's your main concern at the moment? That way I can give you the best info.";
  }
}

export interface FirstTouchMessageInput {
  firstName: string | null;
  clinicName: string;
  /** The service the lead's form was about, when we can tell. */
  serviceName?: string | null;
}

export interface ComposedFirstTouch {
  /** The full message, for SMS. */
  body: string;
  /** Ordered `{{1}}..{{n}}` values for the WhatsApp template. */
  templateParameters: string[];
  category: TreatmentCategory;
}

/**
 * Build the opener.
 *
 * Structure follows the agreed template: greeting → who and where from → why
 * we're messaging → the qualifying question (when one applies) → why it helps.
 */
export function composeFirstTouch(
  input: FirstTouchMessageInput
): ComposedFirstTouch {
  const category = categoriseTreatment(input.serviceName);
  const question = qualifyingQuestion(category);
  const name = input.firstName?.trim() || 'there';

  const opening = `Hi ${name}, how are you? It's Claire here from ${input.clinicName}. I'm getting in touch about the form you submitted showing interest in our treatments.`;

  // Everything between the greeting and the sign-off, as one block. The
  // WhatsApp template has a single variable for it ({{3}}) so ONE approved
  // template serves every treatment category — including the head-spa case
  // where there is no question — and a clinic never needs a re-approval when a
  // new service is linked. Changing what goes in here needs no re-approval
  // either; only the static parts of the template do.
  //
  // The question IS the tail. Every branch of `qualifyingQuestion` already ends
  // with its own reason for asking — "so our specialist knows what to focus
  // on", "once I know that I can give you more info", "that way I can give you
  // the best info" — so appending a second, generic rationale said the same
  // thing twice in a row:
  //
  //   "What's your main concern at the moment? That way I can give you the best
  //    info. That will really help our specialists point you in the right
  //    direction with the treatment."
  //
  // Only the no-question branch needs something after it, since there is no
  // answer for anything to "help" with.
  //
  // Single line, deliberately: this block is sent as a WhatsApp template
  // parameter, and Meta rejects any parameter containing a newline, a tab, or
  // 4+ consecutive spaces — `(#132018) There's an issue with the parameters in
  // your template`. Verified by a real send that failed on exactly this.
  const tail =
    question ??
    'Happy to answer any questions about the treatment or check what times we have.';
  // Sign-off on the SAME line as the tail — see FIRST_TOUCH_SIGN_OFF.
  const body = `${opening}\n\n${tail} ${FIRST_TOUCH_SIGN_OFF}`;

  return {
    body,
    templateParameters: [name, input.clinicName, tail],
    category,
  };
}

/**
 * Static tail of the opener, on the SAME LINE as `{{3}}`.
 *
 * Both of those properties are forced by Meta, and were established by
 * submitting variants against the real API:
 *
 *  - a template may not END with a variable (subcode 2388299), so something
 *    static has to follow `{{3}}`;
 *  - a variable ALONE on its own line is scored as invalid format. The exact
 *    body with `{{3}}` on its own line is rejected; the same body with this
 *    sentence joined onto that line passes, deterministically.
 *
 * It reads naturally after both branches of `closing`, so it works for the
 * head-spa case (no question) as well as the clinical ones.
 */
export const FIRST_TOUCH_SIGN_OFF =
  "Just reply here and I'll take it from there.";

/**
 * The body of the `claire_first_touch` WhatsApp template, submitted to Meta for
 * approval when a clinic connects WhatsApp.
 *
 * It MUST stay structurally identical to {@link composeFirstTouch} — same
 * greeting, same variable order, same sign-off — or the approved template will
 * render differently from the SMS copy of the same message.
 *
 * The trailing static line is REQUIRED, not stylistic: Meta rejects a template
 * ending in a variable (subcode 2388299).
 */
export const FIRST_TOUCH_TEMPLATE_BODY = `Hi {{1}}, how are you? It's Claire here from {{2}}. I'm getting in touch about the form you submitted showing interest in our treatments.\n\n{{3}} ${FIRST_TOUCH_SIGN_OFF}`;

/**
 * The follow-up nudges, sent when a lead has not replied — ONE TEMPLATE PER
 * STEP.
 *
 * A single shared template with the copy in a variable was rejected by Meta:
 * `This template has too many variables for its length` (subcode 2388293).
 * Meta enforces a ratio of static text to variables, so the nudge copy has to
 * live in the template itself and only the name stays variable.
 */
export const FOLLOW_UP_TEMPLATE_NAMES = {
  followup_1: 'claire_follow_up_1',
  followup_2: 'claire_follow_up_2',
} as const;

/**
 * Separate templates from the opener.
 *
 * Follow-ups to a lead who has NOT replied are still business-initiated: the
 * 24h customer-service window only opens on a message FROM the customer, and
 * not having one is the entire reason we are following up. So these need
 * approved templates too — and they cannot reuse the opener, whose fixed text
 * says "I'm getting in touch about the form you submitted".
 */
/**
 * Plain punctuation, deliberately: no em-dash, no apostrophe contractions.
 *
 * Both were verified against the live API to cause rejection in bodies this
 * short. `…times we have — just reply here.` is REJECTED and the same line with
 * a full stop passes; `I won't … you'd … I'll` is REJECTED and the expanded
 * form passes. Meta appears to score unusual punctuation harshly when there is
 * little surrounding text, so the nudges avoid it entirely. The opener is long
 * enough to carry contractions, and does.
 */
export const FOLLOW_UP_TEMPLATE_BODIES = {
  followup_1:
    'Hi {{1}}, just checking you saw my last message. Happy to answer any questions about the treatment, or I can check what times we have. Just reply here.',
  followup_2:
    'Hi {{1}}, I will not keep messaging. If you would still like to hear about our treatments, reply here any time and I will pick it up from there.',
} as const;

export type FollowUpStep = 'followup_1' | 'followup_2';

export interface ComposedFollowUp {
  body: string;
  templateParameters: string[];
}

/**
 * Compose a follow-up nudge.
 *
 * Deliberately short and low-pressure. The first assumes the message was
 * missed; the second says plainly that it is the last one, because a nudge
 * that pretends there will not be another is the kind that gets a clinic
 * reported.
 */
export function composeFollowUp(
  step: FollowUpStep,
  input: { firstName: string | null; clinicName: string }
): ComposedFollowUp {
  const name = input.firstName?.trim() || 'there';
  // The SMS copy is the template body with {{1}} filled, so the two channels
  // send the same words and there is one place to change them.
  const body = FOLLOW_UP_TEMPLATE_BODIES[step].replaceAll('{{1}}', name);

  return { body, templateParameters: [name] };
}

/**
 * Sample values Meta shows its reviewer, one per `{{n}}`.
 *
 * Not cosmetic: a variable template submitted without examples is auto-rejected
 * `INVALID_FORMAT` before a human ever sees it. They are generated from the
 * real composer so the reviewer sees exactly what a lead would.
 */
export const FIRST_TOUCH_TEMPLATE_EXAMPLE = composeFirstTouch({
  firstName: 'Sarah',
  clinicName: 'Bloom Clinic',
  serviceName: 'Microneedling',
}).templateParameters;

export const FOLLOW_UP_TEMPLATE_EXAMPLES = {
  followup_1: composeFollowUp('followup_1', {
    firstName: 'Sarah',
    clinicName: 'Bloom Clinic',
  }).templateParameters,
  followup_2: composeFollowUp('followup_2', {
    firstName: 'Sarah',
    clinicName: 'Bloom Clinic',
  }).templateParameters,
} as const;
