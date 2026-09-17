import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';

export interface NotificationEmailProps {
  recipientName?: string;
  title: string;
  body: string;
  actionUrl?: string;
  actionLabel?: string;
}

export function NotificationEmail({
  recipientName,
  title,
  body,
  actionUrl,
  actionLabel,
}: NotificationEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{title}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={section}>
            <Text style={text}>
              {recipientName ? `Hi ${recipientName},` : 'Hi there,'}
            </Text>
            <Text style={heading}>{title}</Text>
            <Text style={text}>{body}</Text>
            {actionUrl ? (
              <Button style={button} href={actionUrl}>
                {actionLabel ?? 'View'}
              </Button>
            ) : null}
            <Hr style={hr} />
            <Text style={footer}>
              You're receiving this email because of activity on your Borradh
              account.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

NotificationEmail.PreviewProps = {
  recipientName: 'John Doe',
  title: 'You have a new message',
  body: 'A new message was posted to one of your conversations. Open it to read the details and reply.',
  actionUrl: 'https://example.com/inbox',
  actionLabel: 'View Message',
};

// Styles
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

const text = {
  fontSize: '16px',
  lineHeight: '26px',
  color: '#374151',
};

const button = {
  backgroundColor: '#2563eb',
  borderRadius: '6px',
  color: '#ffffff',
  fontSize: '16px',
  fontWeight: '600',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'block',
  padding: '12px 24px',
  margin: '24px 0',
};

const hr = {
  borderColor: '#e5e7eb',
  margin: '32px 0',
};

const footer = {
  fontSize: '14px',
  color: '#6b7280',
};
