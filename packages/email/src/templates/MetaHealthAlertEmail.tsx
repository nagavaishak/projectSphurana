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

export interface MetaHealthAlertItem {
  organizationName: string;
  checkName: string;
  detail: string;
  actionUrl?: string;
  actionLabel?: string;
}

export interface MetaHealthAlertEmailProps {
  alerts: MetaHealthAlertItem[];
}

export function MetaHealthAlertEmail({ alerts }: MetaHealthAlertEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        {alerts.length} Meta account issue{alerts.length === 1 ? '' : 's'}{' '}
        detected
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={section}>
            <Text style={heading}>Meta Account Health Alert</Text>
            <Text style={text}>
              {alerts.length} issue{alerts.length === 1 ? '' : 's'} detected
              across your customers&apos; Meta ad accounts.
            </Text>

            {alerts.map((alert, i) => (
              <Section key={i} style={cardStyle}>
                <Text style={cardTitle}>{alert.organizationName}</Text>
                <Text style={cardMeta}>{alert.checkName}</Text>
                <Text style={cardDetail}>{alert.detail}</Text>
                {alert.actionUrl && (
                  <Text style={cardLink}>
                    <a href={alert.actionUrl} style={link}>
                      {alert.actionLabel ?? 'Fix in Meta'} &rarr;
                    </a>
                  </Text>
                )}
              </Section>
            ))}

            <Hr style={hr} />
            <Text style={footer}>
              This alert checks every hour. Each issue is reported once per day
              until resolved.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

MetaHealthAlertEmail.PreviewProps = {
  alerts: [
    {
      organizationName: 'Glow Aesthetics',
      checkName: 'Payment Method',
      detail:
        'No valid payment method. Add a payment method in Meta Business Manager before launching ads.',
      actionUrl: 'https://business.facebook.com/billing_hub/payment_settings',
      actionLabel: 'Go to Meta Billing',
    },
    {
      organizationName: 'Flawless Faces',
      checkName: 'Account Status',
      detail:
        'Your ad account is disabled. This may be due to ads integrity violations.',
      actionUrl: 'https://business.facebook.com/accountquality',
      actionLabel: 'Check Account Quality',
    },
  ],
} satisfies MetaHealthAlertEmailProps;

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
  color: '#991b1b',
  margin: '40px 0 20px',
};

const text = {
  fontSize: '16px',
  lineHeight: '26px',
  color: '#374151',
};

const cardStyle = {
  backgroundColor: '#fef2f2',
  padding: '16px',
  borderRadius: '8px',
  margin: '12px 0',
  borderLeft: '4px solid #dc2626',
};

const cardTitle = {
  fontSize: '16px',
  fontWeight: '600',
  color: '#1f2937',
  margin: '0 0 4px',
};

const cardMeta = {
  fontSize: '14px',
  fontWeight: '500',
  color: '#b91c1c',
  margin: '0 0 8px',
};

const cardDetail = {
  fontSize: '14px',
  color: '#374151',
  margin: '0 0 8px',
};

const cardLink = {
  fontSize: '14px',
  margin: '0',
};

const link = {
  color: '#2563eb',
  textDecoration: 'underline',
};

const hr = {
  borderColor: '#e5e7eb',
  margin: '32px 0',
};

const footer = {
  fontSize: '13px',
  color: '#9ca3af',
};
