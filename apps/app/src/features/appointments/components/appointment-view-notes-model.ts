/**
 * Note templates and the notes written from them — FIXTURES.
 *
 * Shapes follow `form` / `form_submission` with `kind = 'note'` and the
 * treatment-plan tables (portal.md §2.8, §2.9). Nothing here queries.
 *
 * The point of a template is that AFTERCARE IS NOT A COLUMN. A laser clinic
 * and an injectables clinic record different things, so "aftercare given",
 * "complications" and "review due" are fields a clinic chooses — not table
 * rows hardcoded by us, which is what an earlier draft of this screen did.
 */

export type NoteFieldType =
  | 'long_text'
  | 'short_text'
  | 'single_select'
  | 'multi_select'
  | 'date'
  | 'medications'
  | 'signature';

export type NoteField = {
  id: string;
  type: NoteFieldType;
  label: string;
  help?: string;
  options?: string[];
};

export type NoteTemplate = {
  id: string;
  name: string;
  fields: NoteField[];
  /** Attaching a plan template means "Generate" needs no decision. */
  planTemplateId?: string;
};

/**
 * A freeform note is not a different KIND of thing — it is a note whose
 * template happens to have one field. Modelling it that way means one list,
 * one reader, one dialog, and no "notes" tab sitting beside a "clinical" tab
 * holding the same artefact twice.
 *
 * It matters because the structured template is not always available: a phone
 * call about a bruise on day three is a real clinical event that fits no
 * consultation form.
 */
export const FREEFORM_TEMPLATE: NoteTemplate = {
  id: 'tpl_freeform',
  name: 'Note',
  fields: [{ id: 'body', type: 'long_text', label: 'Note' }],
};

/**
 * SOAP is a TEMPLATE, not a format we hardcode. Most consultation notes take
 * this shape; a clinic that wants different headings edits the template.
 */
export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: 'tpl_soap',
    name: 'Consultation (SOAP)',
    fields: [
      {
        id: 's',
        type: 'long_text',
        label: 'Subjective',
        help: 'What the patient reports, in their words where it matters.',
      },
      {
        id: 'o',
        type: 'long_text',
        label: 'Objective',
        help: 'What you observed or measured.',
      },
      {
        id: 'a',
        type: 'long_text',
        label: 'Assessment',
        help: 'Your judgement, including anything pre-existing.',
      },
      { id: 'p', type: 'long_text', label: 'Plan' },
      { id: 'sig', type: 'signature', label: 'Clinician signature' },
    ],
  },
  {
    id: 'tpl_toxin',
    name: 'Toxin treatment',
    planTemplateId: 'plan_toxin',
    fields: [
      {
        id: 'areas',
        type: 'multi_select',
        label: 'Areas treated',
        options: [
          'Glabella',
          'Frontalis',
          'Crow’s feet — left',
          'Crow’s feet — right',
          'Masseter — left',
          'Masseter — right',
        ],
      },
      {
        id: 'meds',
        type: 'medications',
        label: 'Medications administered',
        help: 'Writes a traceable row against the lot, not just this note.',
      },
      { id: 'after', type: 'long_text', label: 'Aftercare given' },
      {
        id: 'comp',
        type: 'single_select',
        label: 'Complications',
        options: ['None reported', 'Bruising', 'Swelling', 'Other'],
      },
      { id: 'review', type: 'date', label: 'Review due' },
      { id: 'sig', type: 'signature', label: 'Clinician signature' },
    ],
  },
];

export type Administered = {
  id: string;
  medicationId: string;
  lot: string;
  expiry: string;
  area: string;
  dose: number;
};

export type Addendum = { id: string; author: string; at: string; body: string };

export type Note = {
  id: string;
  templateId: string;
  author: string;
  at: string;
  /**
   * A signed note is IMMUTABLE. Corrections are addenda; there is no delete,
   * because deleting destroys the only thing the record is for.
   */
  status: 'draft' | 'signed';
  values: Record<string, string | string[]>;
  meds: Administered[];
  addenda: Addendum[];
};

export const ALL_TEMPLATES = [...NOTE_TEMPLATES, FREEFORM_TEMPLATE];

/**
 * Dates are RELATIVE to the appointment being viewed, not hardcoded. Fixtures
 * reading "2 March" on an appointment dated 2 September look like a product
 * bug rather than sample data, and reviewers spend their attention on that
 * instead of on the screen.
 */
const dayOffset = (base: Date, days: number, hour: number, minute: number) => {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.toLocaleString('en-IE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const dateOnly = (base: Date, days: number) => {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-IE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
};

export const initialNotes = (start: Date): Note[] => [
  {
    id: 'n1',
    templateId: 'tpl_toxin',
    author: 'Dr. Aoife Byrne',
    at: dayOffset(start, 0, 14, 40),
    status: 'signed',
    values: {
      areas: [
        'Glabella',
        'Frontalis',
        'Crow’s feet — left',
        'Crow’s feet — right',
      ],
      after:
        'Standard post-toxin advice: stay upright four hours, no exercise today, no rubbing the treated areas.',
      comp: 'None reported',
      review: dateOnly(start, 14),
    },
    meds: [
      {
        id: 'm_1',
        medicationId: 'm1',
        lot: 'AZ4471-B',
        expiry: 'Mar 2027',
        area: 'Glabella',
        dose: 20,
      },
      {
        id: 'm_2',
        medicationId: 'm1',
        lot: 'AZ4471-B',
        expiry: 'Mar 2027',
        area: 'Frontalis',
        dose: 18,
      },
      {
        id: 'm_3',
        medicationId: 'm1',
        lot: 'AZ4471-B',
        expiry: 'Mar 2027',
        area: 'Crow’s feet — left',
        dose: 6,
      },
      {
        id: 'm_4',
        medicationId: 'm1',
        lot: 'AZ4471-B',
        expiry: 'Mar 2027',
        area: 'Crow’s feet — right',
        dose: 6,
      },
    ],
    addenda: [
      {
        id: 'a1',
        author: 'Dr. Aoife Byrne',
        at: dayOffset(start, 1, 9, 12),
        body: 'Patient called about bruising at the left crow’s feet site. Reassured, advised arnica. No action needed.',
      },
    ],
  },
  {
    id: 'n0b',
    templateId: 'tpl_freeform',
    author: 'Reception',
    at: dayOffset(start, -3, 11, 20),
    status: 'signed',
    values: {
      body: 'Called to ask whether an afternoon slot might open up — works until 3pm most days and would rather not take the morning off. Happy to be called at short notice if there is a cancellation.',
    },
    meds: [],
    addenda: [],
  },
  {
    id: 'n0a',
    templateId: 'tpl_soap',
    author: 'Dr. Aoife Byrne',
    at: dayOffset(start, -48, 10, 5),
    status: 'signed',
    values: {
      s: 'First visit. Interested in softening the lines across the forehead. Has not had toxin before and is nervous about looking “frozen”.',
      o: 'Strong frontalis movement, moderate glabellar lines at rest. Brow position symmetrical. No contraindications on history.',
      a: 'Good candidate for a conservative first treatment. Expectation is softening, not elimination — discussed at length.',
      p: 'Start low, review at two weeks, top up if she wants more. Booked for the 2nd.',
    },
    meds: [],
    addenda: [],
  },
];

/**
 * AI Scribe consent is a property of the PATIENT, not of a visit — three
 * states on the chart, and answerable by the patient themselves through an
 * intake question mapped to this field. Not set still allows recording; only
 * an explicit opt-out blocks it.
 */
export type ScribeConsent = 'not_set' | 'opted_in' | 'opted_out';

/**
 * What the scribe fills, keyed by field id.
 *
 * Medications ARE filled — but only with drugs that exist in the clinic's
 * catalogue, so the model cannot invent a product. What it must never supply
 * is the LOT: a batch number is per-vial, exists in no catalogue, and a
 * mishearing there is a recall nobody can execute. The lot is chosen or
 * scanned by a human, every time.
 */
export const SCRIBE_SAMPLE: Record<string, string> = {
  s: 'Reports the forehead lines are the main concern. Happy with the result of the last treatment, felt it wore off around week ten. No bruising last time.',
  o: 'Moderate dynamic glabellar and frontalis rhytids. Mild pre-existing left brow asymmetry, lower on the left, noted before treatment. No active skin infection.',
  a: 'Suitable for repeat toxin. Asymmetry pre-dates treatment and was pointed out to the patient.',
  p: 'Treat glabella, frontalis and both crow’s feet. Review at two weeks for possible top-up.',
  after:
    'Stay upright for four hours, no exercise today, avoid rubbing the treated areas.',
  comp: 'None reported',
  body: 'Repeat toxin, forehead and glabella. Happy with previous result. Review at two weeks.',
};

/** Rough live transcript, revealed a line at a time while "recording". */
export const TRANSCRIPT_LINES = [
  'So it’s mainly the lines across the forehead that bother me.',
  'And how did you get on with the last treatment?',
  'Really good — I just felt it wore off a bit around ten weeks.',
  'That’s about right. I can see the movement coming back here.',
  'One thing to point out before we start — your left brow sits slightly lower than the right. That’s there now, before anything.',
  'Oh I’ve never noticed that.',
  'It’s very mild. I mention it so it’s on the record.',
  'So we’ll do the glabella, the forehead and both crow’s feet, and I’ll see you in two weeks.',
];

/** Prose with placeholders, resolved from the note when generated. */
export const PLAN_TEMPLATE_BODY = `Dear {{patient_first_name}},

Thank you for coming in on {{appointment_date}}. Here is a summary of your treatment and how to look after the area.

**What we did**
{{areas}}

**Aftercare**
{{after}}

**Your review**
We would like to see you again on {{review}} to check the result and top up if needed.

If anything worries you before then, call the clinic on {{clinic_phone}}.

{{clinician_name}}
{{clinic_name}}`;
