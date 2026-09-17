import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';

export interface StuckConversationItem {
  conversationId: string;
  organizationName: string;
  externalUserName: string | null;
  platformLabel: string;
  lastUserMessage: string;
  lastUserMessageAt: string;
  dashboardUrl: string | null;
}

export interface StuckConversationsAlertEmailProps {
  stuckConversations: StuckConversationItem[];
  staleMinutes: number;
}

export function StuckConversationsAlertEmail({
  stuckConversations,
  staleMinutes,
}: StuckConversationsAlertEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        {stuckConversations.length} chatbot conversation
        {stuckConversations.length === 1 ? '' : 's'} stuck without a reply
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={section}>
            <Text style={heading}>⚠️ Stuck Conversations Alert</Text>
            <Text style={text}>
              {stuckConversations.length} conversation
              {stuckConversations.length === 1 ? ' has' : 's have'} been waiting
              for a bot reply for more than {staleMinutes} minutes.
            </Text>

            {stuckConversations.map((conv) => (
              <Section key={conv.conversationId} style={cardStyle}>
                <Text style={cardTitle}>
                  {conv.externalUserName ?? 'Unknown'} — {conv.organizationName}
                </Text>
                <Text style={cardMeta}>
                  {conv.platformLabel} · waiting since {conv.lastUserMessageAt}
                </Text>
                <Text style={cardMessage}>
                  &ldquo;{conv.lastUserMessage.slice(0, 200)}
                  {conv.lastUserMessage.length > 200 ? '…' : ''}&rdquo;
                </Text>
                {conv.dashboardUrl && (
                  <Text style={cardLink}>
                    <a href={conv.dashboardUrl} style={link}>
                      View conversation →
                    </a>
                  </Text>
                )}
              </Section>
            ))}

            <Hr style={hr} />
            <Text style={footer}>
              This alert fires every 10 minutes for conversations stuck in
              bot_handling with an unanswered user message.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

StuckConversationsAlertEmail.PreviewProps = {
  stuckConversations: [
    {
      conversationId: 'abc123',
      organizationName: 'Glow Aesthetics',
      externalUserName: 'Jane Fleming',
      platformLabel: 'Facebook Messenger',
      lastUserMessage:
        'Hi do you have any availability next Tuesday for a Japanese head spa please?',
      lastUserMessageAt: '2026-03-31 06:47',
      dashboardUrl: 'https://app.borradh.io/dashboard/conversations?id=abc123',
    },
    {
      conversationId: 'def456',
      organizationName: 'Flawless Faces',
      externalUserName: 'Anne Cole',
      platformLabel: 'Facebook Messenger',
      lastUserMessage: 'where are you based thanks',
      lastUserMessageAt: '2026-03-30 07:19',
      dashboardUrl: 'https://app.borradh.io/dashboard/conversations?id=def456',
    },
  ],
  staleMinutes: 15,
} satisfies StuckConversationsAlertEmailProps;

const main = {
  backgroundColor: '#f6f9fc',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '20px 0 48px',
  marginBottom: '64px',
};

const section = {
  padding: '0 48px',
};

const heading = {
  fontSize: '24px',
  fontWeight: '600',
  color: '#991b1b',
  margin: '40px 0 20px',
};

const text = {
  fontSize: '16px',
  lineHeight: '26px',
  color: '#374151',
};

const cardStyle = {
  backgroundColor: '#fef2f2',
  padding: '16px',
  borderRadius: '8px',
  margin: '12px 0',
  borderLeft: '4px solid #dc2626',
};

const cardTitle = {
  fontSize: '16px',
  fontWeight: '600',
  color: '#1f2937',
  margin: '0 0 4px',
};

const cardMeta = {
  fontSize: '13px',
  color: '#6b7280',
  margin: '0 0 8px',
};

const cardMessage = {
  fontSize: '14px',
  color: '#374151',
  margin: '0 0 8px',
  fontStyle: 'italic' as const,
};

const cardLink = {
  fontSize: '14px',
  margin: '0',
};

const link = {
  color: '#2563eb',
  textDecoration: 'underline',
};

const hr = {
  borderColor: '#e5e7eb',
  margin: '32px 0',
};

const footer = {
  fontSize: '13px',
  color: '#9ca3af',
};
