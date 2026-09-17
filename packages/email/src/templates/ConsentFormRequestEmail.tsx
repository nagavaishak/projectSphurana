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

export interface ConsentFormRequestEmailProps {
  patientName: string;
  clinicName: string;
  /** Titles of the consent form(s) the patient needs to complete. */
  formTitles: string[];
  /** How many forms are waiting — drives the "You have N form(s) to sign." line. */
  pendingFormCount: number;
  /**
   * One-tap magic sign-in link (`${marketingUrl}/sites/${slug}/portal/access?token=…`) —
   * falls back to the plain portal home when a link couldn't be minted.
   */
  portalUrl: string;
}

// Deliberately styled to mirror BookingConfirmationEmail — same card, dark
// button and "your patient portal" footer link — so the consent request that
// follows a booking reads as one coherent pair, not two unrelated emails.
export function ConsentFormRequestEmail({
  patientName,
  clinicName,
  formTitles,
  pendingFormCount,
  portalUrl,
}: ConsentFormRequestEmailProps) {
  const plural = pendingFormCount !== 1;
  return (
    <Html>
      <Head />
      <Preview>
        You have {String(pendingFormCount)} {plural ? 'forms' : 'form'} to sign
        at {clinicName}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={section}>
            <Text style={heading}>
              {plural ? 'Consent forms' : 'A consent form'} to complete
            </Text>
            <Text style={text}>Hi {patientName},</Text>
            <Text style={text}>
              You have{' '}
              <strong>
                {pendingFormCount} {plural ? 'forms' : 'form'} to sign
              </strong>{' '}
              before your upcoming appointment at {clinicName}:
            </Text>
            <Section style={detailsBox}>
              {formTitles.map((title) => (
                <Text key={title} style={detailsText}>
                  • {title}
                </Text>
              ))}
            </Section>
            <Section style={buttonWrap}>
              <Button style={button} href={portalUrl}>
                Open portal →
              </Button>
            </Section>
            <Text style={text}>
              The button signs you in securely — no password or code needed. It
              only takes a couple of minutes.
            </Text>
            <Hr style={hr} />
            <Text style={footer}>
              Best regards,
              <br />
              {clinicName}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

ConsentFormRequestEmail.PreviewProps = {
  patientName: 'Jane',
  clinicName: 'Glow Aesthetics',
  formTitles: ['Laser Treatment Consent', 'Medical History'],
  pendingFormCount: 2,
  portalUrl: 'https://example.com/sites/glow/portal/access?token=abc123',
};

// Styles — kept identical to BookingConfirmationEmail on purpose.
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

const detailsBox = {
  backgroundColor: '#f5f5f5',
  padding: '16px',
  borderRadius: '8px',
  margin: '16px 0',
};

const detailsText = {
  fontSize: '16px',
  color: '#374151',
  margin: '4px 0',
};

const hr = {
  borderColor: '#e5e7eb',
  margin: '32px 0',
};

const footer = {
  fontSize: '14px',
  color: '#6b7280',
};

const buttonWrap = {
  margin: '20px 0',
};

const button = {
  backgroundColor: '#1f2937',
  borderRadius: '8px',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: '600',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '12px 20px',
};
