import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';

export interface PatientOtpEmailProps {
  clinicName: string;
  /** The 6-digit sign-in code — the only thing this email exists to carry. */
  code: string;
}

/**
 * Portal v2 passwordless sign-in code (ENG-647).
 *
 * Deliberately minimal: clinic name, the code LARGE and centred, the expiry
 * line — nothing else. No buttons, no links (a link in a "here is your code"
 * email trains patients to click things that look like this one).
 */
export function PatientOtpEmail({ clinicName, code }: PatientOtpEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Your {clinicName} sign-in code</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={section}>
            <Text style={heading}>{clinicName}</Text>
            <Text style={text}>Your sign-in code is:</Text>
            <Text style={codeStyle}>{code}</Text>
            <Text style={text}>
              This code expires in 10 minutes. If you didn't request it, ignore
              this email.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

PatientOtpEmail.PreviewProps = {
  clinicName: 'Glow Aesthetics',
  code: '482913',
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
  fontSize: '20px',
  fontWeight: '600',
  color: '#1f2937',
  margin: '40px 0 20px',
};

const text = {
  fontSize: '16px',
  lineHeight: '26px',
  color: '#374151',
};

const codeStyle = {
  fontSize: '40px',
  fontWeight: '700',
  letterSpacing: '8px',
  color: '#1f2937',
  textAlign: 'center' as const,
  margin: '24px 0',
};
