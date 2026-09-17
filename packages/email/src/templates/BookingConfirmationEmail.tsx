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

export interface BookingConfirmationEmailProps {
  leadName: string;
  serviceName: string;
  formattedDate: string;
  formattedTime: string;
  appointmentDuration: number;
  organizationName: string;
  organizationAddress?: string;
  /**
   * Patient self-serve cancel/reschedule link. Optional: token issuance can
   * fail without sinking the booking, and older bookings predate it — the
   * template falls back to "contact us" rather than rendering a dead button.
   */
  manageUrl?: string;
  /**
   * The clinic's patient portal (ENG-647): sign in to see and manage ALL
   * bookings, not just this one. Optional so older call sites and orgs
   * without the portal keep working unchanged.
   */
  portalUrl?: string;
}

export function BookingConfirmationEmail({
  leadName,
  serviceName,
  formattedDate,
  formattedTime,
  appointmentDuration,
  organizationName,
  organizationAddress,
  manageUrl,
  portalUrl,
}: BookingConfirmationEmailProps) {
  const primaryManageUrl = manageUrl ?? portalUrl;
  return (
    <Html>
      <Head />
      <Preview>
        Your {serviceName} appointment is confirmed for {formattedDate}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={section}>
            <Text style={heading}>Booking confirmed</Text>
            <Text style={text}>Hi {leadName},</Text>
            <Text style={text}>
              Your appointment has been confirmed. Here are the details:
            </Text>
            <Section style={detailsBox}>
              <Text style={detailsTitle}>{serviceName}</Text>
              <Text style={detailsText}>
                {formattedDate} at {formattedTime}
              </Text>
              <Text style={detailsText}>
                Duration: {appointmentDuration} minutes
              </Text>
              {organizationAddress && (
                <Text style={detailsText}>Location: {organizationAddress}</Text>
              )}
            </Section>
            {primaryManageUrl ? (
              <>
                <Text style={text}>
                  Need to change your plans? You can reschedule or cancel this
                  booking yourself.
                </Text>
                <Section style={buttonWrap}>
                  <Button style={button} href={primaryManageUrl}>
                    Manage your booking
                  </Button>
                </Section>
                {manageUrl && portalUrl && (
                  <Text style={text}>
                    You can also see all your bookings in{' '}
                    <a href={portalUrl} style={link}>
                      your patient portal
                    </a>
                    .
                  </Text>
                )}
              </>
            ) : (
              <Text style={text}>
                If you need to reschedule or cancel, please contact us as soon
                as possible.
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

BookingConfirmationEmail.PreviewProps = {
  leadName: 'Sarah',
  serviceName: 'Lip Filler Consultation',
  formattedDate: 'Monday, 15 March 2026',
  formattedTime: '10:00 AM',
  appointmentDuration: 30,
  organizationName: 'Glow Aesthetics',
  organizationAddress: '12 Main Street, Dublin 2',
  manageUrl:
    'https://www.borradh.io/sites/glow-aesthetics/book/manage/preview-token',
  portalUrl: 'https://www.borradh.io/sites/glow-aesthetics/portal',
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

const buttonWrap = {
  margin: '20px 0',
};

const link = {
  color: '#1f2937',
  textDecoration: 'underline',
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
