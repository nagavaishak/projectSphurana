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

export interface WeeklyDigestEmailProps {
  organizationName: string;
  recipientName: string;
  healthScore: number;
  healthTier: 'great' | 'good' | 'needs_attention' | 'critical';
  weekOverWeekChange: number | null;
  summary: string;
  metrics: {
    spend: { current: number; previous: number; currency: string };
    leads: { current: number; previous: number };
    cpl: { current: number | null; previous: number | null; currency: string };
    bestAd: { name: string; cpl: number } | null;
  };
  recommendations: Array<{
    priority: 'critical' | 'high' | 'medium' | 'low';
    title: string;
    description: string;
    actionText: string;
  }>;
  dashboardUrl: string;
  preferencesUrl: string;
}

const TIER_CONFIG = {
  great: { label: 'Great', color: '#16a34a', bg: '#f0fdf4' },
  good: { label: 'Good', color: '#2563eb', bg: '#eff6ff' },
  needs_attention: {
    label: 'Needs Attention',
    color: '#d97706',
    bg: '#fffbeb',
  },
  critical: { label: 'Critical', color: '#dc2626', bg: '#fef2f2' },
} as const;

const PRIORITY_COLORS = {
  critical: { color: '#dc2626', bg: '#fef2f2' },
  high: { color: '#d97706', bg: '#fffbeb' },
  medium: { color: '#2563eb', bg: '#eff6ff' },
  low: { color: '#6b7280', bg: '#f3f4f6' },
} as const;

function formatCurrency(cents: number, currency: string): string {
  const value = cents / 100;
  try {
    return new Intl.NumberFormat('en-IE', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function percentChange(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? '+100%' : '0%';
  const pct = ((current - previous) / previous) * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(0)}%`;
}

function trendArrow(
  current: number,
  previous: number,
  lowerIsBetter = false
): string {
  if (current === previous) return '→';
  const isUp = current > previous;
  const isGood = lowerIsBetter ? !isUp : isUp;
  return isGood ? '↑' : '↓';
}

export function WeeklyDigestEmail({
  organizationName,
  recipientName,
  healthScore,
  healthTier,
  weekOverWeekChange,
  summary,
  metrics,
  recommendations,
  dashboardUrl,
  preferencesUrl,
}: WeeklyDigestEmailProps) {
  const tier = TIER_CONFIG[healthTier];
  const changeSign =
    weekOverWeekChange !== null && weekOverWeekChange >= 0 ? '+' : '';

  return (
    <Html>
      <Head />
      <Preview>{summary}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={section}>
            {/* Header */}
            <Text style={heading}>Weekly Ad Performance</Text>
            <Text style={text}>Hi {recipientName},</Text>
            <Text style={text}>
              Here&apos;s your weekly performance summary for{' '}
              <strong>{organizationName}</strong>.
            </Text>

            {/* Health Score Badge */}
            <Section
              style={{ ...healthBadgeContainer, backgroundColor: tier.bg }}
            >
              <Text
                style={{
                  ...healthBadgeLabel,
                  color: tier.color,
                }}
              >
                {tier.label}
              </Text>
              <Text style={{ ...healthBadgeScore, color: tier.color }}>
                Score: {healthScore}/100
                {weekOverWeekChange !== null && (
                  <span style={{ fontSize: '14px', marginLeft: '8px' }}>
                    ({changeSign}
                    {weekOverWeekChange} pts)
                  </span>
                )}
              </Text>
            </Section>

            {/* Summary */}
            <Text style={{ ...text, fontWeight: '600', fontSize: '16px' }}>
              {summary}
            </Text>

            {/* Key Metrics */}
            <Text style={sectionTitle}>Key Metrics</Text>
            <Section style={metricsTable}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Metric</th>
                    <th style={thStyle}>This Week</th>
                    <th style={thStyle}>Last Week</th>
                    <th style={thStyle}>Change</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={tdStyle}>Spend</td>
                    <td style={tdStyle}>
                      {formatCurrency(
                        metrics.spend.current,
                        metrics.spend.currency
                      )}
                    </td>
                    <td style={tdStyle}>
                      {formatCurrency(
                        metrics.spend.previous,
                        metrics.spend.currency
                      )}
                    </td>
                    <td style={tdStyle}>
                      {percentChange(
                        metrics.spend.current,
                        metrics.spend.previous
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td style={tdStyleAlt}>Leads</td>
                    <td style={tdStyleAlt}>{metrics.leads.current}</td>
                    <td style={tdStyleAlt}>{metrics.leads.previous}</td>
                    <td style={tdStyleAlt}>
                      {percentChange(
                        metrics.leads.current,
                        metrics.leads.previous
                      )}{' '}
                      {trendArrow(
                        metrics.leads.current,
                        metrics.leads.previous
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td style={tdStyle}>Avg CPL</td>
                    <td style={tdStyle}>
                      {metrics.cpl.current !== null
                        ? formatCurrency(
                            metrics.cpl.current,
                            metrics.cpl.currency
                          )
                        : '—'}
                    </td>
                    <td style={tdStyle}>
                      {metrics.cpl.previous !== null
                        ? formatCurrency(
                            metrics.cpl.previous,
                            metrics.cpl.currency
                          )
                        : '—'}
                    </td>
                    <td style={tdStyle}>
                      {metrics.cpl.current !== null &&
                      metrics.cpl.previous !== null
                        ? `${percentChange(metrics.cpl.current, metrics.cpl.previous)} ${trendArrow(metrics.cpl.current, metrics.cpl.previous, true)}`
                        : '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </Section>

            {metrics.bestAd && (
              <Section style={bestAdBox}>
                <Text
                  style={{ margin: '0', fontSize: '13px', color: '#6b7280' }}
                >
                  Best performing ad
                </Text>
                <Text
                  style={{
                    margin: '4px 0 0',
                    fontSize: '15px',
                    fontWeight: '600',
                    color: '#1f2937',
                  }}
                >
                  {metrics.bestAd.name}
                </Text>
                <Text
                  style={{
                    margin: '2px 0 0',
                    fontSize: '14px',
                    color: '#16a34a',
                  }}
                >
                  {formatCurrency(metrics.bestAd.cpl, metrics.cpl.currency)} per
                  lead
                </Text>
              </Section>
            )}

            {/* Recommendations */}
            {recommendations.length > 0 && (
              <>
                <Text style={sectionTitle}>Top Recommendations</Text>
                {recommendations.map((rec, i) => {
                  const pColor = PRIORITY_COLORS[rec.priority];
                  return (
                    <Section key={i} style={recCard}>
                      <Text style={{ margin: '0 0 4px' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: '600',
                            textTransform: 'uppercase',
                            color: pColor.color,
                            backgroundColor: pColor.bg,
                          }}
                        >
                          {rec.priority}
                        </span>
                      </Text>
                      <Text
                        style={{
                          margin: '0',
                          fontSize: '15px',
                          fontWeight: '600',
                          color: '#1f2937',
                        }}
                      >
                        {rec.title}
                      </Text>
                      <Text
                        style={{
                          margin: '4px 0 0',
                          fontSize: '14px',
                          color: '#4b5563',
                        }}
                      >
                        {rec.description}
                      </Text>
                      <Text
                        style={{
                          margin: '4px 0 0',
                          fontSize: '13px',
                          fontWeight: '600',
                          color: '#2563eb',
                        }}
                      >
                        {rec.actionText}
                      </Text>
                    </Section>
                  );
                })}
              </>
            )}

            {/* CTA */}
            <Section style={{ textAlign: 'center' as const, margin: '32px 0' }}>
              <Button href={`${dashboardUrl}/dashboard/home`} style={ctaButton}>
                View All Recommendations
              </Button>
            </Section>
            <Section
              style={{ textAlign: 'center' as const, marginBottom: '24px' }}
            >
              <Text style={{ margin: '0' }}>
                <a
                  href={`${dashboardUrl}/dashboard/marketing/advertising`}
                  style={{ fontSize: '14px', color: '#2563eb' }}
                >
                  View Campaigns
                </a>
              </Text>
            </Section>

            <Hr style={hr} />

            {/* Footer */}
            <Text style={footer}>
              You&apos;re receiving this because you have weekly digest enabled.{' '}
              <a href={preferencesUrl} style={{ color: '#2563eb' }}>
                Manage preferences
              </a>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

WeeklyDigestEmail.PreviewProps = {
  organizationName: 'Glow Aesthetics',
  recipientName: 'Sarah',
  healthScore: 72,
  healthTier: 'good',
  weekOverWeekChange: 5,
  summary: 'Your ads generated 23 leads this week at €6.20 each.',
  metrics: {
    spend: { current: 14300, previous: 12800, currency: 'EUR' },
    leads: { current: 23, previous: 18 },
    cpl: { current: 622, previous: 711, currency: 'EUR' },
    bestAd: { name: 'Summer Glow Treatment - Before/After', cpl: 420 },
  },
  recommendations: [
    {
      priority: 'high' as const,
      title: 'Scale "Summer Glow" campaign',
      description:
        'This campaign is generating leads at €4.20 each — well below target. Consider increasing the daily budget.',
      actionText: 'Increase budget →',
    },
    {
      priority: 'medium' as const,
      title: 'Refresh "Winter Special" creative',
      description:
        'This ad has been running for 28 days and frequency is rising. Upload new content to keep it fresh.',
      actionText: 'Upload new content →',
    },
    {
      priority: 'low' as const,
      title: 'Post to your Facebook page',
      description:
        "You haven't posted in 10 days. Regular posts help your ad performance and page trust.",
      actionText: 'Create a post →',
    },
  ],
  dashboardUrl: 'https://app.borradh.io',
  preferencesUrl: 'https://app.borradh.io/dashboard/settings/notifications',
} satisfies WeeklyDigestEmailProps;

// =============================================================================
// STYLES
// =============================================================================

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
  maxWidth: '600px',
};

const section = {
  padding: '0 48px',
};

const heading = {
  fontSize: '24px',
  fontWeight: '600' as const,
  color: '#1f2937',
  margin: '40px 0 20px',
};

const text = {
  fontSize: '16px',
  lineHeight: '26px',
  color: '#374151',
};

const sectionTitle = {
  fontSize: '18px',
  fontWeight: '600' as const,
  color: '#1f2937',
  margin: '28px 0 12px',
};

const healthBadgeContainer = {
  padding: '16px 20px',
  borderRadius: '8px',
  margin: '20px 0',
};

const healthBadgeLabel = {
  fontSize: '20px',
  fontWeight: '700' as const,
  margin: '0',
};

const healthBadgeScore = {
  fontSize: '16px',
  fontWeight: '500' as const,
  margin: '4px 0 0',
};

const metricsTable = {
  margin: '0 0 16px',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  fontSize: '12px',
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
  borderBottom: '2px solid #e5e7eb',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: '14px',
  color: '#374151',
  borderBottom: '1px solid #f3f4f6',
};

const tdStyleAlt: React.CSSProperties = {
  ...tdStyle,
  backgroundColor: '#f9fafb',
};

const bestAdBox = {
  backgroundColor: '#f0fdf4',
  padding: '12px 16px',
  borderRadius: '8px',
  margin: '0 0 8px',
};

const recCard = {
  backgroundColor: '#f9fafb',
  padding: '14px 16px',
  borderRadius: '8px',
  margin: '0 0 8px',
};

const ctaButton = {
  backgroundColor: '#2563eb',
  color: '#ffffff',
  fontSize: '16px',
  fontWeight: '600' as const,
  padding: '12px 24px',
  borderRadius: '8px',
  textDecoration: 'none',
};

const hr = {
  borderColor: '#e5e7eb',
  margin: '32px 0',
};

const footer = {
  fontSize: '13px',
  color: '#9ca3af',
  lineHeight: '20px',
};
