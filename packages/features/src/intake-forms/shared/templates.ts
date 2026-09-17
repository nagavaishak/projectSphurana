import type { IntakeFormField } from '@borradh-workspace/database';

/**
 * Pre-built intake templates a clinic can start from — the spec's "general
 * consultation form, aesthetic intake, physio assessment, medical history,
 * consent form".
 *
 * A template is just a name + a set of fields; seeding one creates a normal,
 * fully-editable `intake_form`. Field ids are stable within a template so a
 * clinic that seeds the same one twice does not get colliding answer keys
 * across the two copies (each copy is a separate form row, so its submissions
 * key against its own snapshot regardless).
 */
export interface IntakeTemplate {
  key: string;
  name: string;
  description: string;
  fields: IntakeFormField[];
}

const consent = (id: string, label: string): IntakeFormField => ({
  id,
  type: 'checkbox',
  label,
  required: true,
});

export const INTAKE_TEMPLATES: IntakeTemplate[] = [
  {
    key: 'general_consultation',
    name: 'General consultation',
    description: 'A short form for a first visit.',
    fields: [
      {
        id: 'reason',
        type: 'long_text',
        label: 'What would you like help with today?',
        required: true,
      },
      {
        id: 'expectations',
        type: 'long_text',
        label: 'What are you hoping to achieve?',
      },
      {
        id: 'referral',
        type: 'short_text',
        label: 'How did you hear about us?',
      },
    ],
  },
  {
    key: 'medical_history',
    name: 'Medical history',
    description: 'Standard medical background before treatment.',
    fields: [
      {
        id: 'conditions',
        type: 'long_text',
        label: 'Do you have any medical conditions? Please list them.',
      },
      {
        id: 'medications',
        type: 'long_text',
        label: 'List any medications you are currently taking.',
      },
      {
        id: 'allergies',
        type: 'long_text',
        label: 'Do you have any allergies?',
      },
      {
        id: 'pregnant',
        type: 'single_select',
        label: 'Are you pregnant or breastfeeding?',
        options: ['No', 'Yes', 'Prefer not to say'],
      },
      { id: 'gp', type: 'short_text', label: 'GP name and practice' },
    ],
  },
  {
    key: 'aesthetic_intake',
    name: 'Aesthetic intake',
    description: 'For injectables, skin, and laser treatments.',
    fields: [
      {
        id: 'concerns',
        type: 'long_text',
        label: 'What are your main concerns?',
        required: true,
      },
      {
        id: 'prior_treatments',
        type: 'long_text',
        label: 'Have you had aesthetic treatments before? Which, and when?',
      },
      {
        id: 'skin_conditions',
        type: 'multi_select',
        label: 'Do any of these apply?',
        options: [
          'Active acne',
          'Rosacea',
          'Eczema',
          'Cold sores',
          'Keloid scarring',
          'None',
        ],
      },
      {
        id: 'sun_exposure',
        type: 'single_select',
        label: 'Recent sun exposure or tanning?',
        options: ['No', 'Yes'],
      },
      consent(
        'consent_treatment',
        'I consent to the treatment discussed and understand the risks explained to me.'
      ),
    ],
  },
  {
    key: 'physio_assessment',
    name: 'Physio assessment',
    description: 'Initial physiotherapy assessment.',
    fields: [
      {
        id: 'complaint',
        type: 'long_text',
        label: 'Describe your main complaint.',
        required: true,
      },
      { id: 'onset', type: 'date', label: 'When did it start?' },
      {
        id: 'pain_level',
        type: 'single_select',
        label: 'Current pain level',
        options: [
          '0 — none',
          '1-3 — mild',
          '4-6 — moderate',
          '7-9 — severe',
          '10 — worst imaginable',
        ],
      },
      { id: 'aggravating', type: 'long_text', label: 'What makes it worse?' },
      {
        id: 'goals',
        type: 'long_text',
        label: 'What are your recovery goals?',
      },
    ],
  },
  {
    key: 'consent_form',
    name: 'Treatment consent',
    description: 'A standalone consent and signature.',
    fields: [
      {
        id: 'consent_info',
        type: 'section',
        label: 'Please read and sign to confirm your consent to treatment.',
      },
      consent(
        'consent_understood',
        'I have had the treatment, its risks, and aftercare explained to me and I have had the chance to ask questions.'
      ),
      consent(
        'consent_photos',
        'I consent to before/after photos being taken for my clinical record.'
      ),
      {
        id: 'signature',
        type: 'signature',
        label: 'Signature',
        required: true,
      },
    ],
  },
];

export const getTemplateByKey = (key: string): IntakeTemplate | undefined =>
  INTAKE_TEMPLATES.find((t) => t.key === key);
