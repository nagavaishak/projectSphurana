import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Register #65 (Phase 8 — chatbot kill switch). An owner urgently needs the
 * customer chatbot turned OFF while it is live on customers, and historically
 * Claire had no tool for it and dead-ended. Now `chatbots_setEnabled` exists:
 * she routes to it, gates the flip behind a confirmation (toggle_chatbot), and
 * on approval reports the PERSISTED off state — quoting the tool's flag, not
 * echoing the request. No lecturing, no interrogating the reason first.
 */
const fixture: ClaireFixture = {
  id: 'register-65-chatbot-toggle-off',
  description:
    'Urgent chatbot-off request (register #65): Claire calls chatbots_setEnabled, presents a toggle_chatbot confirmation, then reports the persisted OFF state after approval.',
  category: 'confirmation',
  setup: { initialLoadedSkillIds: ['manage-customer-chats'] },
  turns: [
    {
      userMessage:
        "Turn the Instagram chatbot off now — it's replying to my customers and I need it stopped.",
      expect: {
        toolsCalled: ['chatbots_setEnabled'],
        confirmationPresented: 'toggle_chatbot',
        // No exclamation-mark theatrics on an urgent operational request.
        responseLacks: ['!', "i've turned it off", 'it is now off'],
      },
    },
    {
      userMessage: 'Yes, turn it off.',
      expect: {
        toolsCalled: ['chatbots_setEnabled'],
        responseContains: ['off'],
        // The "off" claim must be backed by the persisted flag the tool read
        // back, not by the request — truthful-state rule (ADR-005 / Phase 1).
        claimsRequireToolSupport: [
          { phrase: 'off', support: '"enabled":false' },
        ],
        responseLacks: ['!'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'chatbots_setEnabled',
    destructive: true,
    destructiveAction: 'toggle_chatbot',
    summarizeForConfirmation: (input) => ({
      title: `Turn chatbot ${input.enabled ? 'ON' : 'OFF'}: Instagram DMs`,
      fields: [
        { label: 'Channel', value: String(input.channel ?? 'instagram') },
        { label: 'Target', value: 'Instagram DMs' },
        { label: 'Action', value: input.enabled ? 'Turn ON' : 'Turn OFF' },
      ],
      resourceId: 'instagram:eval-org',
    }),
    respond: (input) => ({
      ok: true,
      data: {
        channel: input.channel ?? 'instagram',
        targetId: null,
        targetLabel: 'Instagram DMs',
        // Persisted flag read back from the toggle endpoint.
        enabled: input.enabled === true,
      },
    }),
  },
];

export default fixture;
