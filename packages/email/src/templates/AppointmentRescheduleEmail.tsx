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

export interface AppointmentRescheduleEmailProps {
  leadName: string;
  appointmentTitle: string;
  oldFormattedDate: string;
  oldFormattedTime: string;
  newFormattedDate: string;
  newFormattedTime: string;
  organizationName: string;
  /**
   * Postal address of the BRANCH this appointment is at — not the org's.
   * Optional and omitted entirely when absent: an appointment with no branch
   * on file (every pre-backfill row) renders no location line at all. Falling
   * back to another branch would tell a Cork patient to drive to Dublin, which
   * is worse than telling them nothing.
   */
  organizationAddress?: string;
  customMessage?: string;
}

export function AppointmentRescheduleEmail({
  leadName,
  appointmentTitle,
  oldFormattedDate,
  oldFormattedTime,
  newFormattedDate,
  newFormattedTime,
  organizationName,
  organizationAddress,
  customMessage,
}: AppointmentRescheduleEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        Your appointment has been rescheduled to {newFormattedDate} at{' '}
        {newFormattedTime}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={section}>
            <Text style={heading}>Appointment rescheduled</Text>
            <Text style={text}>Hi {leadName},</Text>
            <Text style={text}>
              Your appointment <strong>{appointmentTitle}</strong> has been
              rescheduled.
            </Text>
            <Section style={detailsBox}>
              <Text style={detailsTitle}>Previous time</Text>
              <Text style={oldDateText}>
                <s>
                  {oldFormattedDate} at {oldFormattedTime}
                </s>
              </Text>
              <Text style={detailsTitle}>New time</Text>
              <Text style={newDateText}>
                {newFormattedDate} at {newFormattedTime}
              </Text>
              {organizationAddress && (
                <Text style={detailsText}>Location: {organizationAddress}</Text>
              )}
            </Section>
            {customMessage && (
              <Section style={messageBox}>
                <Text style={messageLabel}>Message from your provider:</Text>
                <Text style={text}>{customMessage}</Text>
              </Section>
            )}
            <Text style={text}>
              If you have any questions or need to make changes, please contact
              us.
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

AppointmentRescheduleEmail.PreviewProps = {
  leadName: 'John',
  appointmentTitle: 'Consultation',
  oldFormattedDate: 'Monday, January 20, 2025',
  oldFormattedTime: '02:00 PM',
  newFormattedDate: 'Tuesday, January 21, 2025',
  newFormattedTime: '03:00 PM',
  organizationName: 'Acme Co',
  organizationAddress: '12 Main Street, Dublin 2',
  customMessage: 'Sorry for the inconvenience!',
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
  fontSize: '12px',
  fontWeight: '600',
  color: '#6b7280',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  margin: '8px 0 4px',
};

const oldDateText = {
  fontSize: '16px',
  color: '#9ca3af',
  margin: '4px 0 12px',
};

/**
 * The location line. Neutral grey, not the green `newDateText` — the address is
 * not what changed, and colouring it as a change would read as "you have been
 * moved to a different branch".
 */
const detailsText = {
  fontSize: '16px',
  color: '#374151',
  margin: '12px 0 4px',
};

const newDateText = {
  fontSize: '16px',
  fontWeight: '600',
  color: '#059669',
  margin: '4px 0',
};

const messageBox = {
  backgroundColor: '#eff6ff',
  padding: '16px',
  borderRadius: '8px',
  borderLeft: '4px solid #3b82f6',
  margin: '16px 0',
};

const messageLabel = {
  fontSize: '12px',
  fontWeight: '600',
  color: '#6b7280',
  margin: '0 0 4px',
};

const hr = {
  borderColor: '#e5e7eb',
  margin: '32px 0',
};

const footer = {
  fontSize: '14px',
  color: '#6b7280',
};
