import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'tool-dispatch-summarise-conversation',
  description:
    'Manage-customer-chats skill (W-C09-tools): "summarise this thread" routes through summariseConversation; the response surfaces the customer name and a 2-3 sentence read.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['manage-customer-chats'] },
  turns: [
    {
      userMessage: 'Summarise the thread with Sarah — conv-1.',
      expect: {
        toolsCalled: ['summariseConversation'],
        responseContains: ['Sarah'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'summariseConversation',
    respond: () => ({
      ok: true,
      data: {
        conversation: {
          id: 'conv-1',
          externalUserName: 'Sarah Murphy',
          externalUserId: 'u-1',
          platform: 'whatsapp',
          status: 'agent_handling',
          assignedToId: null,
          metadata: {},
          lastMessageAt: '2026-04-25T09:00:00.000Z',
          createdAt: '2026-04-24T14:00:00.000Z',
        },
        messageCount: 4,
        truncated: false,
        totalMessages: 4,
        messages: [
          {
            role: 'user',
            content: 'Hi, do you do lip filler?',
            timestamp: '2026-04-24T14:00:00.000Z',
          },
          {
            role: 'bot',
            content: 'We do — happy to help. Would you like to book in?',
            timestamp: '2026-04-24T14:01:00.000Z',
          },
          {
            role: 'user',
            content: 'Can I book Tuesday at 10am?',
            timestamp: '2026-04-25T09:00:00.000Z',
          },
        ],
        aiDisclosureFound: false,
      },
    }),
  },
];

export default fixture;
