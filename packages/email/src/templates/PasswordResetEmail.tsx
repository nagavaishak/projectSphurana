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

export interface PasswordResetEmailProps {
  name: string;
  resetUrl: string;
}

export function PasswordResetEmail({
  name,
  resetUrl,
}: PasswordResetEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Reset your password</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={section}>
            <Text style={heading}>Reset your password</Text>
            <Text style={text}>Hi {name},</Text>
            <Text style={text}>
              We received a request to reset your password. Click the button
              below to choose a new one.
            </Text>
            <Button style={button} href={resetUrl}>
              Reset Password
            </Button>
            <Text style={text}>
              This link will expire in 1 hour. If you didn't request a password
              reset, you can safely ignore this email — your password will not
              be changed.
            </Text>
            <Hr style={hr} />
            <Text style={footer}>
              If the button doesn't work, copy and paste this link into your
              browser:
            </Text>
            <Text style={link}>{resetUrl}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

PasswordResetEmail.PreviewProps = {
  name: 'John Doe',
  resetUrl: 'https://example.com/reset-password?token=abc123',
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
