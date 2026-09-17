import { defineCoverage } from '../coverage.types.js';

/**
 * CONVERSATIONS — 10 endpoints, 5 tools. The CUSTOMER inbox: Messenger,
 * Instagram DM and WhatsApp threads between the salon and the people messaging
 * it. Distinct from `/assistant/conversations`, which is Claire's own chat
 * history — these threads have a real person on the other end.
 *
 * That is what shapes the decision. Every read is exposed, because triaging an
 * inbox is one of the things Claire is actually for and she cannot summarise a
 * thread she cannot open. Every exposed write is `confirm: true` without
 * exception: each one is visible to a customer or changes who owns the thread,
 * and none of them can be taken back. Sending is additionally hard-blocked
 * (surgical pricing, fabricated result claims, POM brand names) BEFORE the
 * confirmation is even offered.
 *
 * What stays out is the inbox's own bookkeeping — closing, bulk syncing,
 * deleting — where the mistake is silent and the operator never sees it happen.
 */
export const customerConversationsCoverage = defineCoverage('conversations', {
  // ---- reads -------------------------------------------------------------
  'GET /conversations': {
    exposed: 'customer_conversations_listOpenConversations',
  },
  'GET /conversations/summary/this-week': {
    exposed: 'customer_conversations_summariseConversationsThisWeek',
  },
  'GET /conversations/:id': {
    exposed: 'customer_conversations_summariseConversation',
  },
  'GET /conversations/:id/messages': {
    exposed: 'customer_conversations_summariseConversation',
  },

  // ---- writes ------------------------------------------------------------
  // All three exposed writes are two-call confirmation flows: the tool returns
  // a token plus a rendered summary of exactly what will happen, the operator
  // approves, and only then does the second tool execute.
  'POST /conversations/:id/messages': {
    exposed: 'customer_conversations_sendReply',
    confirm: true,
  },
  'POST /conversations/:id/assign': {
    exposed: 'customer_conversations_confirmAssignConversation',
    confirm: true,
  },
  'POST /conversations/:id/escalate': {
    exposed: 'customer_conversations_confirmEscalateToHuman',
    confirm: true,
  },

  'POST /conversations/:id/close': {
    notExposed:
      'Closing a thread drops it out of the open-inbox feed the team works from. A wrongly-closed conversation is an unanswered customer that nobody sees again — the failure is silent, which is exactly the kind a model should not be able to cause.',
  },
  'POST /conversations/sync': {
    notExposed:
      'Org-wide backfill that re-pulls message history from the Meta APIs. Long-running, rate-limit sensitive, and it changes nothing about the answer to the question being asked — the inbox already syncs on its own schedule.',
  },
  'DELETE /conversations/:id': {
    notExposed:
      'Permanently destroys a customer message thread. That transcript is the record of what was promised to a real person, and it is the first thing anyone reaches for in a complaint or a consent dispute.',
  },
});
