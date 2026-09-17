import { defineCoverage } from '../coverage.types.js';

/**
 * CHATBOTS — 1 endpoint, 0 tools. The whole area is a single SSE test harness:
 * it loads the org's implicit customer-facing chatbot config and streams a
 * reply to a message you type into the settings preview pane.
 *
 * The decision is the recursion one. This endpoint runs a DIFFERENT model — the
 * customer chatbot — using the org's live persona and knowledge base. A tool
 * here would have one assistant drive another, then read the second one's
 * output back in as tool-result text, which is both an unbounded call chain and
 * a clean prompt-injection path (whatever the chatbot says becomes trusted
 * input to Claire). It is also an SSE stream Claire cannot consume.
 */
export const chatbotsCoverage = defineCoverage('chatbots', {
  'POST /chatbots/test-chat': {
    notExposed:
      'Streams a reply from the customer-facing chatbot, i.e. a second model. Claire driving it and reading its output back as a tool result is a model-puppeting-a-model loop with no budget, and the reply becomes untrusted text laundered into her context. It is also SSE, which the tool transport cannot consume — the preview pane in settings is the surface for this.',
  },
});
