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

export interface AppointmentReminderEmailProps {
  leadName: string;
  appointmentTitle: string;
  formattedDate: string;
  formattedTime: string;
  timeUntil: string;
  organizationName: string;
  /**
   * Postal address of the BRANCH this appointment is at — not the org's.
   * Optional and omitted entirely when absent: an appointment with no branch
   * on file (every pre-backfill row) renders no location line at all. Falling
   * back to another branch would tell a Cork patient to drive to Dublin, which
   * is worse than telling them nothing.
   */
  organizationAddress?: string;
  /** How many consent forms are still unsigned for this appointment (0 = none). */
  pendingFormCount?: number;
  /** Portal link to complete the forms — shown only when there are forms pending. */
  portalUrl?: string;
}

export function AppointmentReminderEmail({
  leadName,
  appointmentTitle,
  formattedDate,
  formattedTime,
  timeUntil,
  organizationName,
  organizationAddress,
  pendingFormCount = 0,
  portalUrl,
}: AppointmentReminderEmailProps) {
  const hasForms = pendingFormCount > 0;
  const plural = pendingFormCount !== 1;
  return (
    <Html>
      <Head />
      <Preview>Your appointment is coming up in {timeUntil}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={section}>
            <Text style={heading}>Appointment reminder</Text>
            <Text style={text}>Hi {leadName},</Text>
            <Text style={text}>
              Your appointment is coming up in <strong>{timeUntil}</strong>.
            </Text>
            <Section style={detailsBox}>
              <Text style={detailsTitle}>{appointmentTitle}</Text>
              <Text style={detailsText}>
                {formattedDate} at {formattedTime}
              </Text>
              {organizationAddress && (
                <Text style={detailsText}>Location: {organizationAddress}</Text>
              )}
            </Section>
            {hasForms && (
              <>
                <Text style={text}>
                  <strong>
                    You have {pendingFormCount} {plural ? 'forms' : 'form'} to
                    complete
                  </strong>{' '}
                  before your appointment.
                </Text>
                {portalUrl && (
                  <Text style={text}>
                    Please complete{' '}
                    <a href={portalUrl} style={link}>
                      {plural ? 'them' : 'it'} in your patient portal
                    </a>
                    .
                  </Text>
                )}
              </>
            )}
            <Text style={text}>
              If you need to reschedule, please contact us as soon as possible.
            </Text>
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

AppointmentReminderEmail.PreviewProps = {
  leadName: 'John',
  appointmentTitle: 'Consultation',
  formattedDate: 'Monday, January 20, 2025',
  formattedTime: '02:00 PM',
  timeUntil: '24 hours',
  organizationName: 'Acme Co',
  organizationAddress: '12 Main Street, Dublin 2',
  pendingFormCount: 1,
  portalUrl: 'https://example.com/sites/acme/portal/access?token=abc123',
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

const hr = {
  borderColor: '#e5e7eb',
  margin: '32px 0',
};

const footer = {
  fontSize: '14px',
  color: '#6b7280',
};

const link = {
  color: '#1f2937',
  fontWeight: '600',
  textDecoration: 'underline',
};
