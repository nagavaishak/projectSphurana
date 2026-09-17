/**
 * Prompt surface for the service classifier.
 *
 * Split out from the service so the reasoning that shaped these words stays
 * readable next to them, and so the service file is about control flow.
 *
 * MODEL-DRIVEN, NOT A LOOKUP TABLE. "Fat Freezing" and "CoolSculpting" are the
 * same treatment, and no alias list will ever be complete — 93% of distinct
 * service names in production appear exactly once. Synonymy is a language
 * question, so a model answers it. The `treatment_agent.aliases` are supplied as
 * the DEFINITION of each technique, not as the matcher.
 *
 * CLOSED VOCABULARY. The model chooses a slug from `technique`; anything else is
 * dropped to null. `technique_slug` is an FK, and free text drifts —
 * classifying clips without a closed list produced `hair_wash` AND `hair_washing`
 * in the same run.
 *
 * VAGUENESS IS AN ANSWER. A service named "Barrier Repair" or "Anti-Ageing"
 * carries no treatment information, and guessing one is the precise failure the
 * design exists to prevent: the clinic doing EMS shown an endospheres machine.
 * Those stay null and fall through to ambient.
 */

/** Controlled region vocabulary. Matches the bodyArea values clips carry. */
export const REGIONS = [
  'forehead',
  'brow',
  'eyes',
  'lips',
  'cheeks',
  'chin',
  'jaw',
  'full face',
  'neck',
  'scalp',
  'hair',
  'abdomen',
  'flank',
  'thighs',
  'legs',
  'arms',
  'underarm',
  'back',
  'chest',
  'hands',
  'feet',
  'teeth',
  'buttocks',
  'body-general',
] as const;

export const SYSTEM = `You classify beauty and aesthetic clinic services so marketing video b-roll can be matched to them.

You answer from the SERVICE NAME and any description given. You are reading a price list, not examining a patient.

Two different treatments that are performed the same way share a technique — that is correct and intended. But a name that carries no treatment information at all must return null. Guessing is worse than abstaining: a clinic shown footage of a machine it does not own will notice immediately.`;

/** The service being classified, as the prompt sees it. */
export interface ClassifiableService {
  name: string;
  description: string | null;
  category: string | null;
  targetArea: string | null;
  /**
   * Other service names sold by the same organisation. Present only on PASS 2,
   * so a vague name can be read in the context of the catalogue it sits in.
   */
  siblingNames: string[];
}

/** The classifier's raw answer, before closed-vocabulary validation. */
export interface ClassifiedSpec {
  techniqueSlug: string | null;
  regions: string[];
  expectedShot: string;
  confidence: string;
  reasoning: string;
}

export const promptFor = (
  vocab: string,
  svc: ClassifiableService,
  withCatalogue: boolean
): string => {
  const lines = [`Service name: ${svc.name}`];
  if (svc.category) lines.push(`Category: ${svc.category}`);
  if (svc.description) lines.push(`Description: ${svc.description}`);
  if (svc.targetArea) lines.push(`Target area: ${svc.targetArea}`);

  // Only present on PASS 2, and only for services pass 1 could not decide. See
  // the two-pass comment at the call site: a catalogue in the prompt shifts
  // judgements it is not evidence for, and no instruction reliably prevents
  // that. Capped — a long list dilutes the signal and some clinics list
  // hundreds of services.
  const catalogue =
    withCatalogue && svc.siblingNames.length > 0
      ? `\n  The rest of this clinic's price list:\n${svc.siblingNames
          .slice(0, 40)
          .map((n) => `    - ${n}`)
          .join('\n')}\n`
      : '';

  // Pass 1 has no catalogue, so it must not be told to consult one — a prompt
  // that references an absent list invites invention. It gets the parent rule
  // only; naming a machine from the service name alone is never allowed.
  const techniqueTieBreak = catalogue
    ? `  This clinic's own price list frequently answers it outright. A clinic
  selling "Endymed contouring" or "Skin Tightening (RF)" alongside a bare
  "Body Contouring" owns a radiofrequency device, so the vague service is
  "radiofrequency". One selling "Emsculpt" owns EMS. That is not a guess — the
  clinic told you, on a different line of the same list. Treat an entry as
  evidence only when it names a MACHINE or a BRAND; another vague name tells
  you nothing.
${catalogue}
  If the list points to SEVERAL different machines, or to none, choose the
  PARENT technique that covers the category — "Body Contouring" is
  "energy_contact". The parent is a real answer, not a hedge: it selects footage
  where the machine is deliberately not identifiable, which is exactly honest
  about what you were told. Only return null if no parent covers the name.`
    : `  Choose the PARENT technique that covers the category instead — "Body
  Contouring" is "energy_contact". The parent is a real answer, not a hedge: it
  selects footage where the machine is deliberately not identifiable, which is
  exactly honest about what the name told you. Only return null if no parent in
  the list covers the name either.

  Never name a specific machine on the strength of the service name alone.`;

  return `${lines.join('\n')}

Return STRICT JSON only:

{
  "techniqueSlug": string | null,
  "regions": string[],
  "expectedShot": string,
  "confidence": "high" | "medium" | "low",
  "reasoning": string
}

- "techniqueSlug": choose EXACTLY ONE slug from the list below, or null.
  Choose by what the treatment PHYSICALLY INVOLVES, not by what it is called.
  Brand names, trade names and marketing terms all resolve to the technique
  they are performed with — e.g. a named fat-freezing system is cryolipolysis
  whatever the brand is called.

  Return null when the name names a CONCERN or an OUTCOME rather than a
  treatment — "Pigmentation", "Anti-Ageing", "Barrier Repair", "Active Acne",
  "Acne Scarring". These describe what the client wants fixed, and a clinic may
  treat them several different ways, so there is no single procedure to show.
  Null is a correct and expected answer for these.

  But DO answer when the name gives a category that maps to ONE technique, even
  if it does not identify the exact brand or protocol. A plain "Facial" is a
  facial; a named fat-freezing system is cryolipolysis. Prefer the technique
  over null whenever the name tells you what physically happens.

  When the name covers SEVERAL techniques performed with DIFFERENT, visually
  distinct equipment — "Body Contouring", "Inch Loss", "Skin Tightening" — it
  could be radiofrequency, cavitation, cryolipolysis, EMS, endospheres or laser
  lipolysis. Those machines do not look alike on camera, so naming one at random
  is guessing which machine the clinic owns, and being wrong is immediately
  visible to them.
${techniqueTieBreak}

${vocab}

- "regions": where on the body this treatment is performed, from this list:
${REGIONS.join(', ')}

  Distinguish two different kinds of "it varies":

  (a) The treatment has an INHERENT area even though the exact spot varies.
      A fat-dissolving injection is a BODY treatment — abdomen, flank, thighs,
      under the chin — never a lip. A wrinkle-relaxing injection is a FACE
      treatment — forehead, brow, eyes. List the plausible areas. Several is
      fine and expected; that is what "varies within an area" looks like.

  (b) The treatment genuinely has no area until consultation, because it is
      sold as a bare capability that could go anywhere on the body. Only then
      return an empty array.

  Empty means REGION-NEUTRAL — the matcher will allow footage of ANY body part.
  So returning empty for a body-only treatment lets it be illustrated with a
  lip close-up, which is wrong and visible. When in doubt, list the areas the
  treatment is actually performed on. Prefer (a); (b) is rarer than it looks.

- "expectedShot": one sentence describing the b-roll shot THIS service wants,
  written the way a shot list entry is written — instrument, body region,
  framing. For example "fine needle entering the lips, close-up, gloved hands"
  or "laser handpiece pressed to the lower leg, mid shot".

  It MUST name a body area whenever one is known, because this sentence is
  embedded and used to rank candidate clips. A generic sentence that merely
  restates the technique ("fine needle entering the skin, close-up") carries no
  ranking signal, so an abdomen treatment ends up illustrated by whichever
  facial clip happens to sit nearest in embedding space. Make it specific
  enough that it could only describe this service. Never name a brand.

  If the technique is null, describe a neutral clinic shot instead.

- "confidence": "high" when the name names the treatment outright; "medium"
  when it is strongly implied; "low" when you are inferring from context.

- "reasoning": one short clause. Why this technique, or why null.`;
};

/**
 * Pull the JSON object out of a completion. Tolerates a ```json fence and any
 * prose either side of the object, both of which the model still emits
 * occasionally despite `jsonResponse: true`.
 */
export function parseJson(raw: string): Record<string, unknown> {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : raw).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error(`no JSON in: ${raw.slice(0, 160)}`);
  }
  return JSON.parse(body.slice(start, end + 1));
}
