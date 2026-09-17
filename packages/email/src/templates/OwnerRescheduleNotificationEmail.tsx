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

export interface OwnerRescheduleNotificationEmailProps {
  ownerName: string;
  clientName: string;
  appointmentTitle: string;
  oldFormattedDate: string;
  oldFormattedTime: string;
  newFormattedDate: string;
  newFormattedTime: string;
  clientEmail: string | null;
  clientPhone: string | null;
  organizationName: string;
}

/**
 * Clinic-facing notification when a customer reschedules their own appointment
 * from the patient portal. Sent to the organization owner (the customer gets a
 * separate AppointmentRescheduleEmail from the managed-appointment service).
 */
export function OwnerRescheduleNotificationEmail({
  ownerName,
  clientName,
  appointmentTitle,
  oldFormattedDate,
  oldFormattedTime,
  newFormattedDate,
  newFormattedTime,
  clientEmail,
  clientPhone,
  organizationName,
}: OwnerRescheduleNotificationEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        Booking rescheduled: {clientName} — now {newFormattedDate} at{' '}
        {newFormattedTime}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={section}>
            <Text style={heading}>Booking Rescheduled</Text>
            <Text style={text}>Hi {ownerName},</Text>
            <Text style={text}>
              A customer has rescheduled their booking at{' '}
              <strong>{organizationName}</strong>.
            </Text>
            <Section style={detailsBox}>
              <Text style={detailsMainTitle}>{appointmentTitle}</Text>
              <Text style={detailsTitle}>Previous Time</Text>
              <Text style={oldDateText}>
                <s>
                  {oldFormattedDate} at {oldFormattedTime}
                </s>
              </Text>
              <Text style={detailsTitle}>New Time</Text>
              <Text style={newDateText}>
                {newFormattedDate} at {newFormattedTime}
              </Text>
            </Section>
            <Text style={subheading}>Client Details</Text>
            <Text style={detailsText}>Name: {clientName}</Text>
            {clientEmail && (
              <Text style={detailsText}>Email: {clientEmail}</Text>
            )}
            {clientPhone && (
              <Text style={detailsText}>Phone: {clientPhone}</Text>
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

OwnerRescheduleNotificationEmail.PreviewProps = {
  ownerName: 'Jane',
  clientName: 'John Doe',
  appointmentTitle: 'Botox: John Doe',
  oldFormattedDate: 'Monday, January 20, 2025',
  oldFormattedTime: '02:00 PM',
  newFormattedDate: 'Tuesday, January 21, 2025',
  newFormattedTime: '03:00 PM',
  clientEmail: 'john@example.com',
  clientPhone: '+353 87 123 4567',
  organizationName: 'Glow Clinic',
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
  backgroundColor: '#f5f5f5',
  padding: '16px',
  borderRadius: '8px',
  margin: '16px 0',
};

const detailsMainTitle = {
  fontSize: '16px',
  fontWeight: '600',
  color: '#1f2937',
  margin: '4px 0 12px',
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

const newDateText = {
  fontSize: '16px',
  fontWeight: '600',
  color: '#059669',
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
