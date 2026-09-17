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

export interface InvitationEmailProps {
  inviterName: string;
  organizationName: string;
  invitationUrl: string;
  role: string;
  /** Invited person's first name (from the owner's Profile panel), used to greet. */
  firstName?: string;
  /** Human-readable expiry date, e.g. "January 15, 2026". */
  expiresAt?: string;
}

export function InvitationEmail({
  inviterName,
  organizationName,
  invitationUrl,
  role,
  firstName,
  expiresAt,
}: InvitationEmailProps) {
  const greeting = firstName ? `Hi ${firstName},` : "You're invited!";

  return (
    <Html>
      <Head />
      <Preview>You've been invited to join {organizationName}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={section}>
            <Text style={heading}>{greeting}</Text>
            <Text style={text}>
              <strong>{inviterName}</strong> has invited you to join{' '}
              <strong>{organizationName}</strong> as a {role}.
            </Text>
            <Text style={text}>
              Click the button below to accept the invitation and join the team.
            </Text>
            <Button style={button} href={invitationUrl}>
              Accept Invitation
            </Button>
            <Text style={text}>
              {expiresAt
                ? `This invitation expires on ${expiresAt}. If you don't want to join this team, you can safely ignore this email.`
                : "This invitation will expire in 7 days. If you don't want to join this team, you can safely ignore this email."}
            </Text>
            <Hr style={hr} />
            <Text style={footer}>
              If the button doesn't work, copy and paste this link into your
              browser:
            </Text>
            <Text style={link}>{invitationUrl}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

InvitationEmail.PreviewProps = {
  inviterName: 'John Doe',
  organizationName: 'Acme Inc',
  invitationUrl: 'https://example.com/accept-invitation?token=abc123',
  role: 'member',
  firstName: 'Jane',
  expiresAt: 'January 15, 2026',
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

const link = {
  fontSize: '14px',
  color: '#2563eb',
  wordBreak: 'break-all' as const,
};
