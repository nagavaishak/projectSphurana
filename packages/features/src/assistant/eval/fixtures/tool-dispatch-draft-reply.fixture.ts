import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'tool-dispatch-draft-reply',
  description:
    'Manage-customer-chats skill (W-C09-tools): "draft a reply for Sarah" routes through draftReply; the response surfaces the draft text for the operator to review and send.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['manage-customer-chats'] },
  turns: [
    {
      userMessage:
        'Draft a reply to Sarah on conv-1 confirming Tuesday at 10am.',
      expect: {
        toolsCalled: ['draftReply'],
        responseContains: ['Tuesday'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'draftReply',
    // Production tool emits `presentation: { type: 'draft_reply', ... }` for
    // the rich-content renderer, but the harness's HarnessPresentation
    // union is closed-set (`confirmation_required` | `confirmation_expired`
    // | `hard_block_violation` | `tour_dispatch`). The fixture sticks to
    // `data` — `tool-dispatch` expectations only check `toolsCalled`, so
    // the presentation envelope isn't needed here.
    respond: () => ({
      ok: true,
      data: {
        conversationId: 'conv-1',
        draft:
          "Hi Sarah, Tuesday at 10am works grand. I'll see you then — pop a reply if anything changes.",
        customerName: 'Sarah Murphy',
        platform: 'whatsapp',
        suggestedSendAction: 'send_message',
      },
    }),
  },
];

export default fixture;
