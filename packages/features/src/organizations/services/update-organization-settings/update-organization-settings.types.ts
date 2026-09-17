/**
 * Organization settings response type
 * Client-safe - no server dependencies
 */
export interface OrganizationSettingsResponse {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  websiteUrl: string | null;
  privacyPolicyUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  backgroundColor: string | null;
  tagline: string | null;
  brandStyleGuide: string | null;
  contentStyleTemplate: string | null;
  stylePreference: string | null;
  videoCaptionColor: string | null;
  videoCaptionFont: string | null;
  videoCaptionPosition: 'top' | 'center' | 'bottom' | null;
  videoMusicVolume: number | null;
  defaultBookingLink: string | null;
  depositEnabled: boolean | null;
  depositAmount: number | null;
  defaultDepositBasis: 'fixed' | 'percent';
  defaultDepositPercent: number | null;
  reschedulingNoticeRequiredHours: number | null;
  noShowOrLateCancelFeeCents: number | null;
  /** Portal self-rescheduling policy (ENG-647). NOT NULL column. */
  customerReschedulingEnabled: boolean;
  /** Portal self-cancellation policy (ENG-647). NOT NULL columns. */
  customerCancellationsEnabled: boolean;
  cancellationNoticeRequiredHours: number;
  credibilityLine: string | null;
  primaryCalendarAccountId: string | null;
  primaryCalendarType: string | null;
  contributeToAggregateInsights: boolean;
}
