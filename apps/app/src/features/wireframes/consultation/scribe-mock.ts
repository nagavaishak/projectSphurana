/**
 * Fixtures for the AI scribe wireframe (§8A).
 *
 * Separate from `consultation/mock.ts` so the scribe can be deleted whole if it
 * does not survive review — it is the one feature here that is NOT in Spec V2.
 *
 * The transcript is deliberately imperfect: a real consultation is interrupted,
 * partly inaudible, and contains chat that belongs in no clinical field. A clean
 * fixture would make the review screen look unnecessary, which is precisely the
 * screen that most needs reviewing.
 */

/** Bar heights for the input-level meter, as percentages. */
export const RECORDER_LEVELS = [
  22, 48, 31, 66, 84, 52, 38, 71, 90, 44, 27, 59, 76, 33, 61, 47, 82, 29, 55,
  40,
];

export interface WfTranscriptLine {
  id: string;
  at: string;
  speaker: 'Dr. Byrne' | 'Patient' | 'Unclear';
  text: string;
}

export const TRANSCRIPT: WfTranscriptLine[] = [
  {
    id: 't1',
    at: '00:04',
    speaker: 'Dr. Byrne',
    text: "So what's bothering you most when you look in the mirror?",
  },
  {
    id: 't2',
    at: '00:09',
    speaker: 'Patient',
    text: "The lines between my eyebrows, mainly. People keep asking if I'm cross. And they've got deeper since I had them done last time — that was, what, back in November?",
  },
  {
    id: 't3',
    at: '00:26',
    speaker: 'Dr. Byrne',
    text: 'November, yes. So about four months. That is a little longer than the usual three, which would explain why they have come back more than you expected.',
  },
  {
    id: 't4',
    at: '00:38',
    speaker: 'Patient',
    text: "I've had no problems with it otherwise. No headaches, no drooping, nothing like that.",
  },
  {
    id: 't5',
    at: '00:47',
    speaker: 'Dr. Byrne',
    text: 'Good. Any change to your medication since we last met? Still not pregnant or breastfeeding?',
  },
  { id: 't6', at: '00:53', speaker: 'Patient', text: 'No change, and no.' },
  {
    id: 't7',
    at: '01:02',
    speaker: 'Dr. Byrne',
    text: 'On examination there is moderate glabellar rhytid at rest, and strong dynamic movement on frowning. Frontalis is mild. Crow’s feet minimal — I would leave those alone today.',
  },
  {
    id: 't8',
    at: '01:31',
    speaker: 'Dr. Byrne',
    text: "I'll treat the glabella and put a little into the forehead to balance it. Twenty units across the glabella, and I'll assess the forehead as I go.",
  },
  {
    id: 't9',
    at: '01:48',
    speaker: 'Patient',
    text: '[inaudible] ...and how long before I see it?',
  },
  {
    id: 't10',
    at: '01:52',
    speaker: 'Dr. Byrne',
    text: 'Three to five days for the first movement to soften, full effect at two weeks. Bruising is possible, usually settles within a week.',
  },
  {
    id: 't11',
    at: '02:14',
    speaker: 'Patient',
    text: "That's fine, I've had it before.",
  },
  {
    id: 't12',
    at: '02:40',
    speaker: 'Unclear',
    text: '[background — reception phone, speech not recoverable]',
  },
  {
    id: 't13',
    at: '03:20',
    speaker: 'Dr. Byrne',
    text: 'No lying down for four hours, no gym today, and try not to rub the area. I would see you back in twelve weeks rather than sixteen this time.',
  },
  {
    id: 't14',
    at: '03:44',
    speaker: 'Patient',
    text: "Twelve weeks. I'll book on the way out.",
  },
];

export interface WfNoteField {
  id: string;
  label: string;
  draft: string;
  rows: number;
  /**
   * Which transcript lines produced this field. Drives the provenance
   * highlight — and an EMPTY array is meaningful, marking a field the recording
   * never covered, which is exactly where a practitioner must type rather than
   * trust the draft.
   */
  sourceIds: string[];
}

export const NOTE_FIELDS: WfNoteField[] = [
  {
    id: 'presenting',
    label: 'Presenting concern',
    draft:
      'Glabellar lines, deepened since last treatment. Reports being asked if she looks cross.',
    rows: 2,
    sourceIds: ['t1', 't2'],
  },
  {
    id: 'history',
    label: 'History',
    draft:
      'Previous anti-wrinkle treatment November — approx. 4 months, longer than the usual 3-month interval. No adverse effects reported: no headache, no ptosis. No medication changes. Not pregnant, not breastfeeding.',
    rows: 3,
    sourceIds: ['t3', 't4', 't5', 't6'],
  },
  {
    id: 'examination',
    label: 'Examination',
    draft:
      'Moderate glabellar rhytid at rest with strong dynamic movement on frowning. Mild frontalis involvement. Crow’s feet minimal — not treated today.',
    rows: 3,
    sourceIds: ['t7'],
  },
  {
    id: 'discussion',
    label: 'Discussion and consent',
    draft:
      'Onset 3–5 days, full effect at 2 weeks. Bruising discussed as a possible side effect, usually settling within a week. Patient has had the treatment previously and is familiar with it.',
    rows: 3,
    sourceIds: ['t10', 't11'],
  },
  {
    id: 'products',
    label: 'Products and doses',
    draft:
      'Botox — glabella, 20 units. Forehead assessed and treated during the procedure.',
    rows: 2,
    sourceIds: ['t8'],
  },
  {
    id: 'plan',
    label: 'Plan and follow-up',
    draft: 'Review in 12 weeks, shortened from the previous 16-week interval.',
    rows: 2,
    sourceIds: ['t13', 't14'],
  },
  {
    id: 'postcare',
    label: 'Post-care given',
    draft:
      'No lying down for 4 hours. No exercise today. Avoid rubbing the treated area.',
    rows: 2,
    sourceIds: ['t13'],
  },
  {
    id: 'photos',
    label: 'Photographs',
    draft: '',
    rows: 2,
    // Nothing in the recording covers this — the empty array is the point.
    sourceIds: [],
  },
];
