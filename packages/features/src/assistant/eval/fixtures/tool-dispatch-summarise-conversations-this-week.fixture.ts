import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'tool-dispatch-summarise-conversations-this-week',
  description:
    'Manage-customer-chats skill (W-C09-tools): "how was the inbox this week" routes through summariseConversationsThisWeek; the response surfaces counts + the oldest pending thread.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['manage-customer-chats'] },
  turns: [
    {
      userMessage: 'How did customer chats go this week?',
      expect: {
        toolsCalled: ['summariseConversationsThisWeek'],
        responseContains: ['12'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'summariseConversationsThisWeek',
    respond: () => ({
      ok: true,
      data: {
        timeframe: {
          since: '2026-04-18T00:00:00.000Z',
          until: '2026-04-25T00:00:00.000Z',
        },
        counts: {
          totalThreads: 12,
          openThreads: 5,
          escalatedThreads: 2,
          closedThreads: 5,
        },
        byChannel: {
          whatsapp: 7,
          facebook_messenger: 3,
          instagram_dm: 2,
        },
        topIntents: [],
        responseTime: { p50Ms: 4500, p95Ms: 65000 },
        oldestPending: {
          conversationId: 'conv-stale',
          customerName: 'James Carter',
          hoursPending: 38,
        },
      },
    }),
  },
];

export default fixture;
