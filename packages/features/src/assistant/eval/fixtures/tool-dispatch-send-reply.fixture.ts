import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Story 73 — send an approved reply to a customer.
 *
 * Manage-customer-chats skill: `sendReply` only makes sense once a draft
 * exists for the operator to approve. The skill's documented flow is
 * read-then-draft-then-send: `summariseConversation`/`draftReply` produce a
 * draft, the operator reviews it, and only when they say "send it" does
 * Claire call `sendReply`. `sendReply` is destructive (the factory requires
 * confirmation before the message is actually delivered), so it lands a
 * `confirmation_required` for the `send_reply` action.
 *
 * Observed model behaviour drove this two-turn shape: with NO drafted reply
 * in context, asking Claire to "send that reply" has nothing to send — she
 * summarises and routes to support rather than fabricating a message. So
 * turn 1 establishes a real draft (Claire reads the thread and drafts), and
 * turn 2 ("send it") is the approval that dispatches `sendReply`. This proves
 * the send tool is reachable from this skill on the genuine path, without
 * coupling to the full token round-trip.
 */
const fixture: ClaireFixture = {
  id: 'tool-dispatch-send-reply',
  description:
    'Manage-customer-chats: turn 1 Claire drafts a reply for Sarah on conv-1; turn 2 the operator approves ("send it") and Claire dispatches sendReply, which lands a confirmation_required before the message is delivered.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['manage-customer-chats'] },
  turns: [
    {
      userMessage:
        'Draft a reply to Sarah on conv-1 confirming Tuesday at 10am.',
      expect: {
        // A draft must exist before there's anything to send. The skill reads
        // the thread first; the assertion only requires the draft lands.
        toolsCalled: ['draftReply'],
        responseContains: ['Tuesday'],
      },
    },
    {
      userMessage: 'That looks good — send it.',
      expect: {
        toolsCalled: ['sendReply'],
        confirmationPresented: 'send_reply',
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
        conversationId: 'conv-1',
        customerName: 'Sarah Murphy',
        platform: 'whatsapp',
        summary:
          'Sarah asked to book a lip filler consult; she suggested Tuesday morning and is waiting on confirmation.',
        lastMessageFrom: 'customer',
      },
    }),
  },
  {
    name: 'draftReply',
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
  {
    name: 'sendReply',
    destructive: true,
    destructiveAction: 'send_reply',
    summarizeForConfirmation: (input) => ({
      title: 'Send reply',
      fields: [
        { label: 'Customer', value: 'Sarah Murphy' },
        { label: 'Channel', value: 'WhatsApp' },
        {
          label: 'Message',
          value: String(
            input.message ??
              'Hi Sarah, Tuesday at 10am works grand. See you then.'
          ),
        },
      ],
      resourceId: String(input.conversationId ?? 'conv-1'),
    }),
    respond: () => ({
      ok: true,
      data: { sent: true, conversationId: 'conv-1' },
    }),
  },
];

export default fixture;
