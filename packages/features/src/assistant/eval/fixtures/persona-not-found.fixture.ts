import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Story 83 — graceful not-found.
 *
 * The operator references a service that doesn't exist. The tool returns a
 * structured `NOT_FOUND` error (ok: false), and Claire must handle it
 * gracefully: tell the operator she doesn't have that service and pivot to
 * a useful next step (listing the org's actual active services), without
 * leaking internal error jargon (stack traces, codes, "undefined",
 * "exception").
 *
 * Observed model behaviour: rather than a bare "couldn't find", Claire says
 * "I don't have a cryo-facial service under that ID" and then lists the
 * org's real active services. That graceful recover-and-redirect IS the
 * intended persona behaviour — the assertion targets that pattern (a
 * not-having phrase plus a real service name from DEFAULT_ORG_CONTEXT)
 * rather than a single brittle string.
 */
const fixture: ClaireFixture = {
  id: 'persona-not-found',
  description:
    "Operator references a non-existent service id; getServiceDetails returns NOT_FOUND. Claire says she doesn't have it, lists the org's real active services, and surfaces no stack traces or error codes.",
  category: 'persona',
  setup: { initialLoadedSkillIds: ['manage-services'] },
  turns: [
    {
      userMessage: 'Show me the details for the cryo-facial service, svc-999.',
      expect: {
        toolsCalled: ['getServiceDetails'],
        // Graceful not-found: Claire names the service the operator asked
        // for (so it's clear she understood the request) and pivots to the
        // org's real catalogue (DEFAULT_ORG_CONTEXT lists "Lip filler"),
        // rather than a bare error.
        responseContains: ['cryo-facial', 'Lip filler'],
        responseLacks: [
          'stack',
          'NOT_FOUND',
          'undefined',
          'exception',
          'internal error',
        ],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'getServiceDetails',
    respond: () => ({
      ok: false,
      error: 'Service not found',
      code: 'NOT_FOUND',
    }),
  },
];

export default fixture;
