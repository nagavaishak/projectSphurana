import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * manage-lead-forms: the owner asks to add a field to an existing lead form.
 * Claire finds the form (listLeadForms / previewLeadForm) and edits it
 * (updateLeadForm with the field merged in), confirming in plain language.
 */
const fixture: ClaireFixture = {
  id: 'lead-form-edit-fields',
  description:
    'Owner asks to add a phone-number field to their lead form; Claire locates it and calls updateLeadForm with the field added, confirming in plain language (not Meta field codes).',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['manage-lead-forms'] },
  turns: [
    {
      userMessage: 'Add a phone number field to my lead form.',
      expect: {
        toolsCalled: ['updateLeadForm'],
        responseContains: ['phone'],
        // Plain language only — never the Meta field-type codes.
        responseLacks: ['FULL_NAME', 'updateLeadForm'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'listLeadForms',
    respond: () => ({
      ok: true,
      data: {
        leadForms: [
          {
            leadFormId: 'lf1',
            name: 'New client enquiries',
            status: 'synced',
            metaFormId: 'm1',
            followUpChannel: 'whatsapp',
            fieldCount: 2,
          },
        ],
        count: 1,
      },
    }),
  },
  {
    name: 'previewLeadForm',
    respond: () => ({
      ok: true,
      data: {
        uiState: 'created',
        variant: 'preview',
        title: 'New client enquiries',
        leadFormId: 'lf1',
        followUpChannel: 'whatsapp',
        questions: [
          { type: 'FULL_NAME', label: 'Full Name' },
          { type: 'EMAIL', label: 'Email' },
        ],
        fields: [],
        actions: [],
        ready: true,
      },
    }),
  },
  {
    name: 'updateLeadForm',
    respond: () => ({
      ok: true,
      data: {
        uiState: 'created',
        variant: 'preview',
        title: 'Lead form updated',
        leadFormId: 'lf1',
        metaFormId: 'm2',
        followUpChannel: 'whatsapp',
        status: 'synced',
        requiresCampaignRelink: false,
        questions: [
          { type: 'FULL_NAME', label: 'Full Name' },
          { type: 'EMAIL', label: 'Email' },
          { type: 'PHONE', label: 'Phone' },
        ],
        fields: [],
        actions: [],
        ready: true,
      },
    }),
  },
];

export default fixture;
