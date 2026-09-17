import { createFileRoute } from '@tanstack/react-router';

import { redirectToBranch } from '@/features/organization-locations/redirect-to-branch';

/** Chatbot moved into the AI Assistant page. Kept as a redirect for old links. */
export const Route = createFileRoute('/_authed/dashboard/chatbots')({
  beforeLoad: ({ context }) =>
    redirectToBranch(context.queryClient, '/ai-assistant'),
});
