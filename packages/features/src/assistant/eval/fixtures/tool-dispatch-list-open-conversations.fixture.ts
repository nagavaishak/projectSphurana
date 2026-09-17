import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'tool-dispatch-list-open-conversations',
  description:
    'Manage-customer-chats skill (W-C09-tools): "what customer messages are open" routes through listOpenConversations; the response surfaces the threads waiting for a reply.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['manage-customer-chats'] },
  turns: [
    {
      userMessage: 'What customer messages are open right now?',
      expect: {
        toolsCalled: ['listOpenConversations'],
        responseContains: ['Sarah'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'listOpenConversations',
    respond: () => ({
      ok: true,
      data: {
        conversations: [
          {
            id: 'conv-1',
            externalUserId: 'u-1',
            externalUserName: 'Sarah Murphy',
            platform: 'whatsapp',
            status: 'agent_handling',
            assignedToId: null,
            lastMessageContent: 'Can I book Tuesday at 10am?',
            lastMessageRole: 'user',
            lastMessageAt: '2026-04-25T09:00:00.000Z',
            createdAt: '2026-04-24T14:00:00.000Z',
          },
          {
            id: 'conv-2',
            externalUserId: 'u-2',
            externalUserName: 'Liam OBrien',
            platform: 'facebook_messenger',
            status: 'bot_handling',
            assignedToId: null,
            lastMessageContent: 'Thanks, will think about it',
            lastMessageRole: 'user',
            lastMessageAt: '2026-04-25T08:15:00.000Z',
            createdAt: '2026-04-24T11:30:00.000Z',
          },
        ],
        pageCount: 2,
        total: 2,
        limit: 20,
        offset: 0,
      },
    }),
  },
];

export default fixture;
