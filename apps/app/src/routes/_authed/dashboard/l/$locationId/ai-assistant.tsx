import { createFileRoute } from '@tanstack/react-router';

import { DashboardPage } from '@/components/app/dashboard-page';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveOrganization } from '@/features/organization';
import { useGetDefaultVoiceScript } from '@/features/voice-scripts';

import { ChatbotPageToggles } from './ai-assistant/-components/chatbot-page-toggles';
import { DirectiveCard } from './ai-assistant/-components/directive-card';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/ai-assistant'
)({
  component: AiAssistantPage,
});

function AiAssistantPage() {
  const { data: organization, isLoading } = useActiveOrganization();
  const { script: voiceScript } = useGetDefaultVoiceScript({
    queryConfig: { enabled: !!organization?.id },
  });

  return (
    // No `fillHeight`: the instructions box is a fixed, resizable height now,
    // so the page scrolls normally like every other. Owning the viewport only
    // made sense when the editor stretched to fill it.
    <DashboardPage
      description="Tell Claire how to answer, then test her before customers do."
      title="AI Assistant"
    >
      <title>AI Assistant | Borradh</title>

      {isLoading ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      ) : organization ? (
        // One column: the instructions, then the channels they apply to. The
        // side column is gone with the voice-caller and test-call panels that
        // filled it — a lone Channels card in a 340px rail left the page
        // lopsided, and the instructions want the width.
        <div className="flex flex-col gap-4">
          <DirectiveCard
            chatbotSystemPrompt={organization.chatbotSystemPrompt ?? null}
            organizationId={organization.id}
            voiceScript={voiceScript}
          />

          <Card>
            <CardHeader className="space-y-1.5">
              <CardTitle className="text-base">Channels</CardTitle>
              <CardDescription>
                Where the chatbot replies to messages.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChatbotPageToggles />
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-center text-destructive">
          Failed to load organization. Please try again.
        </div>
      )}
    </DashboardPage>
  );
}
