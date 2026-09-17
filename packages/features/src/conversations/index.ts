export * from './models/index.js';
export * from './services/index.js';
export * from './tools/index.js';

// Which BRANCH a conversation is about. Exported because the booking link
// Claire sends is only correct when it names the SAME branch whose prices she
// quoted, and that agreement is asserted against a real database
// (`claire-booking-link-branch.int-spec.ts`) rather than assumed.
export { resolveConversationBranch } from './shared/resolve-conversation-branch.js';
