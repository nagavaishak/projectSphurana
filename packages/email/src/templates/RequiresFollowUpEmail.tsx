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

export interface RequiresFollowUpEmailProps {
  ownerName: string;
  customerName: string;
  platform: string;
  followUpReason: string;
  conversationSnippet: string;
  dashboardUrl: string | null;
  organizationName: string;
}

export function RequiresFollowUpEmail({
  ownerName,
  customerName,
  platform,
  followUpReason,
  conversationSnippet,
  dashboardUrl,
  organizationName,
}: RequiresFollowUpEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        Requires Follow-Up: {customerName} asked about {followUpReason}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={section}>
            <Text style={heading}>Requires Follow-Up</Text>
            <Text style={text}>Hi {ownerName},</Text>
            <Text style={text}>
              A customer needs your attention. <strong>{customerName}</strong>{' '}
              asked about something the chatbot couldn&apos;t answer on{' '}
              {platform}.
            </Text>
            <Section style={detailsBox}>
              <Text style={detailsTitle}>What they asked about</Text>
              <Text style={detailsText}>{followUpReason}</Text>
            </Section>
            <Text style={subheading}>Recent Messages</Text>
            <Section style={snippetBox}>
              <Text style={snippetText}>{conversationSnippet}</Text>
            </Section>
            {dashboardUrl && (
              <Text style={text}>
                View the full conversation in your dashboard:{' '}
                <a href={dashboardUrl} style={link}>
                  Open Conversation
                </a>
              </Text>
            )}
            <Hr style={hr} />
            <Text style={footer}>
              Best regards,
              <br />
              {organizationName}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

RequiresFollowUpEmail.PreviewProps = {
  ownerName: 'Sarah',
  customerName: 'Emily',
  platform: 'Instagram',
  followUpReason: 'Asked about teeth whitening',
  conversationSnippet:
    "Emily: do you do teeth whitening?\nClaire: oh that's a good one to ask about. i don't have the full details on that one right now but let me flag this for sarah and she'll get back to you directly about it",
  dashboardUrl: 'https://app.borradh.io/dashboard/conversations?id=abc123',
  organizationName: 'Glow Aesthetics',
};

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
  color: '#1f2937',
  margin: '40px 0 20px',
};

const subheading = {
  fontSize: '16px',
  fontWeight: '600',
  color: '#1f2937',
  margin: '20px 0 8px',
};

const text = {
  fontSize: '16px',
  lineHeight: '26px',
  color: '#374151',
};

const detailsBox = {
  backgroundColor: '#fef3c7',
  padding: '16px',
  borderRadius: '8px',
  margin: '16px 0',
  borderLeft: '4px solid #f59e0b',
};

const detailsTitle = {
  fontSize: '16px',
  fontWeight: '600',
  color: '#1f2937',
  margin: '4px 0',
};

const detailsText = {
  fontSize: '16px',
  color: '#374151',
  margin: '4px 0',
};

const snippetBox = {
  backgroundColor: '#f5f5f5',
  padding: '16px',
  borderRadius: '8px',
  margin: '16px 0',
};

const snippetText = {
  fontSize: '14px',
  color: '#374151',
  margin: '4px 0',
  whiteSpace: 'pre-line' as const,
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
  fontSize: '14px',
  color: '#6b7280',
};
