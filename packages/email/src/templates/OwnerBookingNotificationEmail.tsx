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

export interface OwnerBookingNotificationEmailProps {
  ownerName: string;
  clientName: string;
  serviceName: string;
  appointmentTitle: string;
  formattedDate: string;
  formattedTime: string;
  clientEmail: string | null;
  clientPhone: string | null;
  clientNotes: string | null;
  practitionerName: string | null;
  organizationName: string;
}

export function OwnerBookingNotificationEmail({
  ownerName,
  clientName,
  serviceName,
  appointmentTitle,
  formattedDate,
  formattedTime,
  clientEmail,
  clientPhone,
  clientNotes,
  practitionerName,
  organizationName,
}: OwnerBookingNotificationEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        New Booking: {clientName} — {serviceName}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={section}>
            <Text style={heading}>New Booking</Text>
            <Text style={text}>Hi {ownerName},</Text>
            <Text style={text}>
              A new booking has been made at <strong>{organizationName}</strong>
              .
            </Text>
            <Section style={detailsBox}>
              <Text style={detailsTitle}>{appointmentTitle}</Text>
              <Text style={detailsText}>Service: {serviceName}</Text>
              <Text style={detailsText}>
                {formattedDate} at {formattedTime}
              </Text>
              {practitionerName && (
                <Text style={detailsText}>
                  Practitioner: {practitionerName}
                </Text>
              )}
            </Section>
            <Text style={subheading}>Client Details</Text>
            <Text style={detailsText}>Name: {clientName}</Text>
            {clientEmail && (
              <Text style={detailsText}>Email: {clientEmail}</Text>
            )}
            {clientPhone && (
              <Text style={detailsText}>Phone: {clientPhone}</Text>
            )}
            {clientNotes && (
              <>
                <Text style={subheading}>Notes</Text>
                <Text style={text}>{clientNotes}</Text>
              </>
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

OwnerBookingNotificationEmail.PreviewProps = {
  ownerName: 'Jane',
  clientName: 'John Doe',
  serviceName: 'Full Colour',
  appointmentTitle: 'Full Colour: John Doe',
  formattedDate: 'Monday, January 20, 2025',
  formattedTime: '02:00 PM',
  clientEmail: 'john@example.com',
  clientPhone: '+353 87 123 4567',
  clientNotes: null,
  practitionerName: 'Sarah',
  organizationName: 'Hair Studio',
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
