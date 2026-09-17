import { createFileRoute } from '@tanstack/react-router';

import { redirectToBranch } from '@/features/organization-locations/redirect-to-branch';

/** Chatbot settings moved to the AI Assistant page. Kept as a redirect for old links. */
export const Route = createFileRoute('/_authed/dashboard/settings/chatbot')({
  beforeLoad: ({ context }) =>
    redirectToBranch(context.queryClient, '/ai-assistant'),
});
