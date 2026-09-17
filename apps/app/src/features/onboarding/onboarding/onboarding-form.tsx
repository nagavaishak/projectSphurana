import {
  MultiStepForm,
  type StepConfig,
} from '@/components/ui/multi-step-form';
import { useGetSession } from '@/features/auth/api/get-session';
import { useCreateLocation } from '@/features/organization-locations/api/create-location';
import type { CreateLocationInput } from '@/features/organization-locations/api/types';
import { useCreateService } from '@/features/organization-services/api/create-service';
// TODO: Re-enable when integrations are built
// import { useInitiateStripeConnect } from '@/features/integrations/api';
import { useCreateOrganization } from '@/features/organization/api/create-organization';
import { useListOrganizations } from '@/features/organization/api/list-organizations';
import { setActiveOrganizationIfNeeded } from '@/features/organization/api/set-active-organization';
import { useCreatePractitioner } from '@/features/practitioners/api/create-practitioner';
import { useLinkPractitionerToUser } from '@/features/practitioners/api/link-me';
import { useUploadImage } from '@/features/upload';
import { useAnalyzeWebsite } from '@/features/website-analysis';
import { logError } from '@/lib/log-error';
import { useResolvedRoutes } from '@/lib/use-routes';
import { apiClient } from '@borradh-workspace/api-client';
import { businessTypeValues } from '@borradh-workspace/api-client/types';
import { servicePriceTypeValues } from '@borradh-workspace/labels';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Step1BusinessInfo } from './tabs/step-1-business-info';
import { Step2BusinessType } from './tabs/step-2-business-type';
import { Step3WebsiteAnalysis } from './tabs/step-3-website-analysis';
import { Step6Locations } from './tabs/step-6-locations';
// TODO: Re-enable when integrations are built
// import { Step6StripeConnect } from './tabs/step-6-stripe-connect';
// import { Step7Deposits } from './tabs/step-7-deposits';
import { Step7OpeningHours } from './tabs/step-7-opening-hours';
import { Step8Credibility } from './tabs/step-8-credibility';
import { StepBookingLinks } from './tabs/step-booking-links';
// TODO: Re-enable when integrations are built
// import { StepConnectBooking } from './tabs/step-connect-booking';
// import { StepDepositSystemSelect } from './tabs/step-deposit-system-select';
import { StepDoYouProvideServices } from './tabs/step-do-you-provide-services';
import { StepPractitioners } from './tabs/step-practitioners';

// SessionStorage key for persisting form state across OAuth redirects
const ONBOARDING_FORM_STATE_KEY = 'borradh_onboarding_form_state';

interface SavedOnboardingState {
  formValues: Record<string, unknown>;
  organizationId: string;
}

// Location schema
const locationSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  addressLine1: z.string().min(1, 'Address is required'),
  addressLine2: z.string().optional(),
  city: z.string().min(1, 'City is required'),
  county: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().min(1, 'Country is required'),
  isPrimary: z.boolean(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
});

// Onboarding schema - redesigned with booking/payments flow
const onboardingSchema = z.object({
  // Step 1: Business Info
  companyLogo: z.instanceof(File).optional().nullable(),
  companyName: z.string().min(1, 'Company name is required'),
  businessType: z.enum(businessTypeValues, {
    message: 'Please select a business type',
  }),

  // Step 2: Website Scanner (optional)
  websiteUrl: z
    .string()
    .transform((v) => {
      if (!v) return v;
      const trimmed = v.trim();
      if (trimmed && !/^https?:\/\//i.test(trimmed))
        return `https://${trimmed}`;
      return trimmed;
    })
    .pipe(z.string().url('Invalid website URL'))
    .optional()
    .or(z.literal('')),
  facebookPageUrl: z
    .string()
    .transform((v) => {
      if (!v) return v;
      const trimmed = v.trim();
      if (trimmed && !/^https?:\/\//i.test(trimmed))
        return `https://${trimmed}`;
      return trimmed;
    })
    .pipe(z.string().url('Invalid Facebook URL'))
    .optional()
    .or(z.literal('')),
  bookingSystemUrl: z
    .string()
    .transform((v) => {
      if (!v) return v;
      const trimmed = v.trim();
      if (trimmed && !/^https?:\/\//i.test(trimmed))
        return `https://${trimmed}`;
      return trimmed;
    })
    .pipe(z.string().url('Invalid booking system URL'))
    .optional()
    .or(z.literal('')),

  // Services (populated by website analysis, created during org creation)
  services: z.array(z.string()).default([]),
  // Brand tone & ICP (populated by website analysis, handled by backend)
  targetAudienceDescription: z.string().optional().default(''),
  brandVoice: z.array(z.string()).optional().default([]),
  suggestedCredibilityLines: z.array(z.string()).optional().default([]),

  // Locations
  locations: z
    .array(locationSchema, {
      message: 'Add at least one location',
    })
    .min(1, 'Add at least one location'),

  // Practitioners / Team members (optional — step skipped for now)
  practitioners: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().min(1),
        email: z.string().email(),
        title: z.string().optional(),
        phone: z.string().optional(),
      })
    )
    .default([]),

  // Opening Hours
  businessHours: z.record(
    z.string(),
    z.object({
      from: z.number().int().min(0).max(1440),
      to: z.number().int().min(0).max(1440),
    })
  ),

  // Credibility Line
  credibilityLine: z.string().min(1, 'Choose or write a credibility line'),

  // Booking system choice
  bookingSystemChoice: z
    .enum(['borradh', 'calendly', 'timely', 'fresha', 'phorest', 'not_listed'])
    .default('borradh'),

  // Account-level booking & deposit links
  bookingLink: z.string().url().optional().or(z.literal('')),
  depositLink: z.string().url().optional().or(z.literal('')),

  // Deposit system choice
  depositSystemChoice: z.enum(['stripe', 'link', 'none']).default('none'),

  // Per-service details (keyed by service name)
  serviceDetails: z
    .record(
      z.string(),
      z.object({
        appointmentDuration: z.number().int().min(5).max(480).optional(),
        requiresDeposit: z.boolean().default(false),
        depositAmountCents: z.number().int().min(100).optional(),
        // Structured price, not freeform text: the analyzer returns a
        // classified anchor (priceType + priceAmount) alongside its prose, and
        // that is what the service model stores. The old `pricingDescription`
        // carried the analyzer's full multi-point blurb, which routinely blew
        // its length cap and failed the wizard's final validation.
        priceType: z.enum(servicePriceTypeValues).optional(),
        priceCents: z.number().int().min(0).optional(),
      })
    )
    .default({}),

  // Stripe Connect
  stripeConnected: z.boolean().default(false),

  // Colors (populated by website analysis)
  primaryColor: z.string().optional().default('#7c3aed'),
  secondaryColor: z.string().optional().default('#f5f5f5'),

  // Whether the org owner personally provides services
  ownerProvidesServices: z.boolean().default(false),
});

type OnboardingFormData = z.infer<typeof onboardingSchema>;

// Step schemas for validation
const step1Schema = onboardingSchema.pick({ companyName: true });
const step1bSchema = onboardingSchema.pick({ businessType: true });
const step2Schema = z.object({});
const step6Schema_locations = onboardingSchema.pick({ locations: true });
const step4Schema = z.object({
  businessHours: z
    .record(z.string(), z.object({ from: z.number(), to: z.number() }))
    .refine(
      (obj) => Object.keys(obj).length > 0,
      'Set at least one day of opening hours'
    ),
});
const step5Schema = onboardingSchema.pick({ credibilityLine: true });
const stepPractitionersSchema = onboardingSchema.pick({ practitioners: true });
// Booking links / payment links / Stripe / deposits / calendar steps have no required form fields - passthrough
const bookingLinksStepSchema = z.object({});
// TODO: Re-enable when integrations are built
// const depositSystemSelectStepSchema = z.object({});
// const stripeConnectStepSchema = z.object({});
// const depositsStepSchema = z.object({});
// const connectBookingStepSchema = z.object({});
const ownerProvidesServicesSchema = z.object({});

const BASE_DEFAULT_VALUES: OnboardingFormData = {
  companyLogo: null,
  companyName: '',
  businessType: '' as OnboardingFormData['businessType'],
  locations: [],
  practitioners: [],
  websiteUrl: '',
  facebookPageUrl: '',
  bookingSystemUrl: '',
  services: [],
  targetAudienceDescription: '',
  brandVoice: [],
  suggestedCredibilityLines: [],
  businessHours: {
    '1': { from: 540, to: 1020 }, // Mon 9am-5pm
    '2': { from: 540, to: 1020 },
    '3': { from: 540, to: 1020 },
    '4': { from: 540, to: 1020 },
    '5': { from: 540, to: 1020 },
  },
  bookingSystemChoice: 'borradh' as const,
  bookingLink: '',
  depositLink: '',
  depositSystemChoice: 'none' as const,
  serviceDetails: {},
  credibilityLine: '',
  stripeConnected: false,
  primaryColor: '#7c3aed',
  secondaryColor: '#f5f5f5',
  ownerProvidesServices: false,
};

export function OnboardingForm() {
  const { user, isLoading: isSessionLoading } = useGetSession();
  const { data: organizations, isLoading: isOrgsLoading } =
    useListOrganizations();
  const navigate = useNavigate();
  // Dashboard routes are location-scoped since #927; the resolved routes hook
  // is what turns a bare 'home' into this org's branch path.
  const routes = useResolvedRoutes();

  // Detect OAuth return (Google Calendar, Stripe, or Booking) and restore saved form state
  const [oauthReturn] = useState<
    | (SavedOnboardingState & {
        source?: 'calendar' | 'stripe' | 'booking';
        bookingAccountId?: string;
      })
    | null
  >(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);

    const isCalendarReturn =
      params.get('integration') === 'calendar' &&
      params.get('status') === 'connected';
    const isStripeReturn =
      params.get('stripe') === 'connected' ||
      (params.get('integration') === 'stripe' &&
        params.get('status') === 'connected');
    const isBookingReturn =
      params.get('integration') === 'booking' &&
      params.get('status') === 'connected';

    if (!isCalendarReturn && !isStripeReturn && !isBookingReturn) return null;

    const saved = sessionStorage.getItem(ONBOARDING_FORM_STATE_KEY);
    if (!saved) return null;

    try {
      const parsed = JSON.parse(saved) as SavedOnboardingState;
      sessionStorage.removeItem(ONBOARDING_FORM_STATE_KEY);
      return {
        ...parsed,
        source: isStripeReturn
          ? 'stripe'
          : isBookingReturn
            ? 'booking'
            : 'calendar',
        bookingAccountId: isBookingReturn
          ? params.get('accountId') || ''
          : undefined,
      };
    } catch {
      return null;
    }
  });

  // Track created organization (ref for idempotency, no re-renders needed)
  const organizationIdRef = useRef<string | null>(
    oauthReturn?.organizationId ?? null
  );

  // TODO: Re-enable when integrations are built
  // const [stripeConnected, setStripeConnected] = useState(
  //   oauthReturn?.source === 'stripe' ||
  //     !!oauthReturn?.formValues?.stripeConnected
  // );
  // const [bookingChoice, setBookingChoice] = useState<string>(
  //   (oauthReturn?.formValues?.bookingSystemChoice as string) || 'borradh'
  // );
  // const [bookingAccountId] = useState(
  //   oauthReturn?.source === 'booking'
  //     ? oauthReturn.bookingAccountId || ''
  //     : ''
  // );
  // const [depositChoice, setDepositChoice] = useState<string>(
  //   (oauthReturn?.formValues?.depositSystemChoice as string) || 'none'
  // );

  // Prevent organizations-exist redirect when org was just created or returning from OAuth
  const hasCompletedOnboardingRef = useRef(!!oauthReturn);
  const formDataRef = useRef<OnboardingFormData | null>(null);

  // Upload hook for company logo
  const { uploadAsync: uploadImage } = useUploadImage({ purpose: 'profile' });

  // Organization creation hook (suppress success toast)
  // Writes go through their operation's mutation hook — never an inline
  // apiClient.post (form-contract source rule). `organizationId` is omitted on
  // purpose: the API injects the ACTIVE org, which Step 3 below sets before any
  // of these run.
  const { createServiceAsync } = useCreateService();
  const { createLocationAsync } = useCreateLocation();
  const { createPractitionerAsync } = useCreatePractitioner();
  const { linkMeAsync } = useLinkPractitionerToUser();

  const { executeAsync: createOrganizationAsync } = useCreateOrganization({
    showSuccessToast: false,
    onError: (error) => {
      toast.error(error.message || 'Failed to create organization');
    },
  });

  // Website analysis hook
  const { analyzeWebsiteAsync, isAnalyzing } = useAnalyzeWebsite();

  // TODO: Re-enable when integrations are built
  // const { initiateStripeConnect, isInitiating: isConnectingStripe } =
  //   useInitiateStripeConnect({ returnTo: '/onboarding' });

  // Clean URL params on OAuth return
  useEffect(() => {
    if (oauthReturn) {
      window.history.replaceState({}, '', '/onboarding');
    }
  }, [oauthReturn]);

  // Redirect to sign-in if not authenticated
  useEffect(() => {
    if (!isSessionLoading && !user?.id) {
      const timer = setTimeout(() => {
        navigate({ to: '/sign-in' });
      }, 500);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isSessionLoading, user?.id, navigate]);

  // Redirect if already onboarded (has organizations)
  useEffect(() => {
    const handleExistingOrganizations = async () => {
      if (
        !hasCompletedOnboardingRef.current &&
        !isOrgsLoading &&
        organizations.length > 0
      ) {
        try {
          await setActiveOrganizationIfNeeded(false);
        } catch (err) {
          console.warn('Error setting active organization:', err);
        }
        // Same reasoning as handleSubmit: someone who already has an org has
        // already been through this, and lands in the product rather than on a
        // plan picker.
        navigate({ to: routes.home });
      }
    };
    handleExistingOrganizations();
  }, [isOrgsLoading, organizations, navigate, routes.home]);

  // Still loading or redirecting
  if (isSessionLoading || isOrgsLoading || !user?.id) {
    return <div>Loading...</div>;
  }

  // If user has organizations and not completing onboarding, show nothing while redirecting
  if (!hasCompletedOnboardingRef.current && organizations.length > 0) {
    return <div>Setting up your account...</div>;
  }

  // TODO: Re-enable when integrations are built (used for OAuth redirect state persistence)
  // const saveFormState = (form: UseFormReturn<OnboardingFormData>) => {
  //   const values = form.getValues();
  //   const { companyLogo: _logo, ...serializableValues } = values;
  //   const state: SavedOnboardingState = {
  //     formValues: serializableValues,
  //     organizationId: organizationIdRef.current ?? '',
  //   };
  //   sessionStorage.setItem(ONBOARDING_FORM_STATE_KEY, JSON.stringify(state));
  // };

  /**
   * Race a promise against a timeout. Resolves to the result or undefined on timeout.
   */
  const withTimeout = <T,>(
    promise: Promise<T>,
    ms: number
  ): Promise<T | undefined> =>
    Promise.race([
      promise,
      new Promise<undefined>((resolve) =>
        setTimeout(() => resolve(undefined), ms)
      ),
    ]);

  /**
   * Create the organization and save services/locations/practitioners.
   * Called via onBeforeContinue on the credibility step (idempotent).
   *
   * Strategy:
   * 1. Create org + set active org (critical — blocks on failure)
   * 2. Save services, locations, practitioners in parallel with per-request timeout
   * 3. Fire-and-forget: invitations, link-me, booking-forms sync (never block)
   */
  const createOrganization = async (
    form: UseFormReturn<OnboardingFormData>
  ): Promise<boolean> => {
    // Already created — skip
    if (organizationIdRef.current) return true;

    // Prevent redirect while creating
    hasCompletedOnboardingRef.current = true;

    const data = form.getValues();

    try {
      // ── Step 1: Upload logo (optional, best-effort) ──────────────────
      let companyLogoUrl: string | undefined;
      if (data.companyLogo instanceof File) {
        try {
          const result = await withTimeout(
            uploadImage(data.companyLogo),
            10_000
          );
          companyLogoUrl = result?.url;
        } catch {
          console.warn('Logo upload failed, continuing without logo');
        }
      }

      // ── Step 2: Create organization (critical) ───────────────────────
      const org = await createOrganizationAsync({
        name: data.companyName,
        ...(companyLogoUrl && { logo: companyLogoUrl }),
        businessType: data.businessType,
        websiteUrl: data.websiteUrl || undefined,
        facebookPageUrl: data.facebookPageUrl || undefined,
        brandVoice: data.brandVoice,
        targetAudienceDescription: data.targetAudienceDescription,
        credibilityLine: data.credibilityLine,
        primaryColor: data.primaryColor,
        secondaryColor: data.secondaryColor,
        businessHours:
          data.businessHours && Object.keys(data.businessHours).length > 0
            ? data.businessHours
            : undefined,
        defaultBookingLink: data.bookingLink || undefined,
        // `depositLink` is no longer sent — deposits are collected in the
        // booking flow, not by pasting a static payment URL. The step that
        // used to capture one (StepDepositSystemSelect) is already out of the
        // flow, so nothing collects it either.
        primaryCalendarType: (() => {
          const choice = data.bookingSystemChoice;
          if (choice === 'fresha') return 'fresha';
          if (choice === 'phorest') return 'phorest';
          return 'borradh';
        })(),
      });

      if (!org?.id) {
        hasCompletedOnboardingRef.current = false;
        toast.error('Failed to create organization. Please try again.');
        return false;
      }

      // Store org id immediately so retries skip org creation
      organizationIdRef.current = org.id;

      // ── Step 3: Set active organization (must complete before parallel requests) ─
      // RoleGuard reads activeOrganizationId from the session, so it must be set
      // before any @RequireRole-protected endpoints (e.g. POST /practitioners).
      try {
        await setActiveOrganizationIfNeeded(false, org.id);
      } catch (err) {
        console.warn('Error setting active organization:', err);
      }

      // ── Step 4: Save services, locations, practitioners sequentially ──
      // Requests are serialized to avoid exhausting the database connection pool.
      // With 15+ services, parallel requests caused connections to hang and timeout.
      const REQUEST_TIMEOUT = 15_000;

      let failedServices = 0;
      const servicesList = data.services ?? [];
      for (const serviceName of servicesList) {
        const details = data.serviceDetails?.[serviceName];
        try {
          const result = await withTimeout(
            createServiceAsync({
              name: serviceName,
              category: 'treatment',
              appointmentDuration: details?.appointmentDuration || 30,
              requiresDeposit: details?.requiresDeposit || false,
              depositAmountCents: details?.depositAmountCents || undefined,
              priceType: details?.priceType,
              priceCents: details?.priceCents,
              // The inline apiClient.post omitted these and let the API default
              // them; the typed hook requires them. Values are the backend
              // defaults verbatim (create-service.schema.ts) — no behaviour change.
              sortOrder: 0,
              isCustom: true,
              isActive: true,
            }),
            REQUEST_TIMEOUT
          );
          if (result === undefined) failedServices++;
        } catch (err) {
          console.error(`Failed to create service "${serviceName}":`, err);
          failedServices++;
        }
      }

      let failedLocations = 0;
      const locationsList = data.locations ?? [];
      for (const [i, loc] of locationsList.entries()) {
        try {
          const result = await withTimeout(
            createLocationAsync({
              name: loc.name || undefined,
              addressLine1: loc.addressLine1,
              city: loc.city,
              county: loc.county || undefined,
              postalCode: loc.postalCode || undefined,
              country: loc.country as CreateLocationInput['country'],
              isPrimary: i === 0,
              latitude: loc.latitude ?? undefined,
              longitude: loc.longitude ?? undefined,
            }),
            REQUEST_TIMEOUT
          );
          if (result === undefined) failedLocations++;
        } catch (err) {
          console.error('Failed to create location:', err);
          failedLocations++;
        }
      }

      let failedPractitioners = 0;
      const practitionersList = data.practitioners ?? [];
      for (const p of practitionersList) {
        // The typed contract requires a name; the inline post shipped undefined
        // and let the API 400 it into the failure count. Count it here instead.
        // Hoisted: narrowing a property does not survive into the closure below.
        const practitionerName = p.name;
        // `email` is REQUIRED by create-practitioner on this branch
        // (create-practitioner.schema.ts: z.string().email()), while this legacy
        // wizard still treats it as optional. The old inline apiClient.post was
        // untyped, so an email-less practitioner shipped and came back a 400 that
        // landed in this same failure count. Same outcome, made explicit — but the
        // step's UI should require an email. See the practitioners step.
        const practitionerEmail = p.email;
        if (!practitionerName || !practitionerEmail) {
          failedPractitioners++;
          continue;
        }
        try {
          const result = await withTimeout(
            createPractitionerAsync({
              name: practitionerName,
              email: practitionerEmail,
              title: p.title || undefined,
              phone: p.phone || undefined,
            }),
            REQUEST_TIMEOUT
          );
          if (result === undefined) failedPractitioners++;
        } catch (err) {
          console.error(`Failed to create practitioner "${p.name}":`, err);
          failedPractitioners++;
        }
      }

      if (failedServices === servicesList.length && servicesList.length > 0) {
        toast.error(
          'Failed to save services. You can add them from the dashboard.'
        );
      }
      if (
        failedLocations === locationsList.length &&
        locationsList.length > 0
      ) {
        toast.error(
          'Failed to save locations. You can add them from the dashboard.'
        );
      }
      if (
        failedPractitioners === practitionersList.length &&
        practitionersList.length > 0
      ) {
        toast.error(
          'Failed to save team members. You can add them from the dashboard.'
        );
      }

      // ── Step 5: Fire-and-forget secondary operations ─────────────────
      // Invitations
      for (const p of data.practitioners ?? []) {
        if (!p.email || p.email.toLowerCase() === user?.email?.toLowerCase())
          continue;
        apiClient
          .post(`organizations/${org.id}/invitations`, {
            email: p.email,
            role: 'member',
          })
          .catch((err) => console.error(`Failed to invite ${p.email}:`, err));
      }

      // Link org creator to their practitioner record
      linkMeAsync().catch(() => {});

      return true;
    } catch (error) {
      // If org was already created, don't block — let user continue
      if (organizationIdRef.current) {
        logError('onboarding.postCreate', error);
        return true;
      }
      hasCompletedOnboardingRef.current = false;
      logError('onboarding.createOrganization', error);
      toast.error('Failed to complete setup. Please try again.');
      return false;
    }
  };

  // Base steps (1-8)
  const baseSteps: (StepConfig<OnboardingFormData> & { _id: string })[] = [
    {
      _id: 'business-name',
      id: 'business-name',
      schema: step1Schema,
      component: (form) => {
        formDataRef.current = form.getValues();
        return <Step1BusinessInfo form={form} />;
      },
    },
    {
      _id: 'business-type',
      id: 'business-type',
      schema: step1bSchema,
      component: (form) => {
        formDataRef.current = form.getValues();
        return <Step2BusinessType form={form} />;
      },
    },
    {
      _id: 'website-scanner',
      id: 'website-scanner',
      schema: step2Schema,
      processingButtonText: 'Analysing...',
      onBeforeContinue: async (form) => {
        const websiteUrl = form.getValues('websiteUrl');
        const bookingSystemUrl = form.getValues('bookingSystemUrl');

        // Skip analysis if no URLs provided
        if (!websiteUrl && !bookingSystemUrl) return true;

        try {
          const result = await analyzeWebsiteAsync({
            // At least one URL is guaranteed truthy by the guard above
            websiteUrl: (websiteUrl || bookingSystemUrl) as string,
            facebookPageUrl: form.getValues('facebookPageUrl') || undefined,
            bookingSystemUrl: bookingSystemUrl || undefined,
          });

          if (result.services?.length) {
            const serviceNames = result.services.map((s) => s.name);
            form.setValue('services', serviceNames, { shouldDirty: true });

            // Seed serviceDetails from the analyzer's STRUCTURED price. Its
            // `priceAmount` is in whole local-currency units (150 for "£150");
            // the service model stores cents.
            const currentDetails = form.getValues('serviceDetails') || {};
            const updatedDetails = { ...currentDetails };
            for (const svc of result.services) {
              const priceCents =
                svc.priceAmount === undefined
                  ? undefined
                  : Math.round(svc.priceAmount * 100);
              const existing = updatedDetails[svc.name];
              if (!existing) {
                updatedDetails[svc.name] = {
                  appointmentDuration: 30,
                  requiresDeposit: false,
                  priceType: svc.priceType,
                  priceCents,
                };
              } else if (svc.priceType && !existing.priceType) {
                updatedDetails[svc.name] = {
                  ...existing,
                  priceType: svc.priceType,
                  priceCents,
                };
              }
            }
            form.setValue('serviceDetails', updatedDetails, {
              shouldDirty: true,
            });
          }
          if (result.targetAudienceDescription) {
            form.setValue(
              'targetAudienceDescription',
              result.targetAudienceDescription,
              { shouldDirty: true }
            );
          }
          if (result.brandVoice?.length) {
            form.setValue('brandVoice', result.brandVoice, {
              shouldDirty: true,
            });
          }
          if (result.suggestedCredibilityLines?.length) {
            form.setValue(
              'suggestedCredibilityLines',
              result.suggestedCredibilityLines,
              { shouldDirty: true }
            );
          }
          if (result.primaryColor) {
            form.setValue('primaryColor', result.primaryColor, {
              shouldDirty: true,
            });
          }
          if (result.secondaryColor) {
            form.setValue('secondaryColor', result.secondaryColor, {
              shouldDirty: true,
            });
          }
          if (result.locations?.length) {
            const mappedLocations = result.locations.map(
              (loc: {
                name?: string;
                addressLine1: string;
                city: string;
                county?: string;
                postalCode?: string;
                country: string;
                latitude?: number;
                longitude?: number;
              }) => ({
                id: crypto.randomUUID(),
                name: loc.name || '',
                addressLine1: loc.addressLine1,
                addressLine2: '',
                city: loc.city,
                county: loc.county || '',
                postalCode: loc.postalCode || '',
                country: loc.country,
                isPrimary: false,
                latitude: loc.latitude ?? null,
                longitude: loc.longitude ?? null,
              })
            );
            form.setValue('locations', mappedLocations, { shouldDirty: true });
          }
          if (
            result.businessHours &&
            Object.keys(result.businessHours).length > 0
          ) {
            // Snap times to the nearest 30-min interval within the UI's
            // supported range (6 AM–11 PM) so the Select dropdowns can
            // display them correctly.
            const MIN_TIME = 360; // 6:00 AM
            const MAX_TIME = 1380; // 11:00 PM
            const INTERVAL = 30;
            const snap = (m: number) =>
              Math.max(
                MIN_TIME,
                Math.min(MAX_TIME, Math.round(m / INTERVAL) * INTERVAL)
              );

            const snapped: Record<string, { from: number; to: number }> = {};
            for (const [day, hours] of Object.entries(result.businessHours)) {
              const h = hours as { from: number; to: number };
              const from = snap(h.from);
              let to = snap(h.to);
              // Ensure 'to' is after 'from'
              if (to <= from) to = Math.min(from + INTERVAL, MAX_TIME);
              snapped[day] = { from, to };
            }

            form.setValue('businessHours', snapped, {
              shouldDirty: true,
            });
          }
          if (result.practitioners?.length) {
            const existingPractitioners = form.getValues('practitioners') || [];
            const existingNames = new Set(
              existingPractitioners.map((p: { name: string }) =>
                p.name.toLowerCase().trim()
              )
            );
            const newPractitioners = result.practitioners
              .filter(
                (p: { name: string }) =>
                  !existingNames.has(p.name.toLowerCase().trim())
              )
              .map((p: { name: string; title?: string }) => ({
                id: crypto.randomUUID(),
                name: p.name,
                email: '',
                title: p.title || undefined,
              }));
            form.setValue(
              'practitioners',
              [...existingPractitioners, ...newPractitioners],
              { shouldDirty: true }
            );
          }

          return true;
        } catch {
          toast.error(
            "We couldn't analyze your website/booking system. You can fill in the details manually."
          );
          return true;
        }
      },
      component: (form) => {
        formDataRef.current = form.getValues();
        return <Step3WebsiteAnalysis form={form} isAnalyzing={isAnalyzing} />;
      },
    },
    {
      _id: 'locations',
      id: 'locations',
      schema: step6Schema_locations,
      component: (form) => {
        formDataRef.current = form.getValues();
        return <Step6Locations form={form} />;
      },
    },
    {
      _id: 'practitioners',
      id: 'practitioners',
      schema: stepPractitionersSchema,
      component: (form) => {
        formDataRef.current = form.getValues();
        return <StepPractitioners form={form} />;
      },
    },
    {
      _id: 'booking-system-select',
      id: 'booking-system-select',
      schema: bookingLinksStepSchema,
      component: (form) => {
        formDataRef.current = form.getValues();
        return <StepBookingLinks form={form} />;
      },
    },
    // TODO: Re-enable deposit system selection when integrations are built
    // {
    //   _id: 'deposit-system-select',
    //   id: 'deposit-system-select',
    //   schema: depositSystemSelectStepSchema,
    //   onBeforeContinue: async (form) => {
    //     const choice = form.getValues('depositSystemChoice');
    //     setDepositChoice(choice || 'none');
    //     return true;
    //   },
    //   component: (form) => {
    //     formDataRef.current = form.getValues();
    //     return <StepDepositSystemSelect form={form} />;
    //   },
    // },
    // Services are created from the website-analysis list during org creation
    {
      _id: 'opening-hours',
      id: 'opening-hours',
      schema: step4Schema,
      component: (form) => {
        formDataRef.current = form.getValues();
        return <Step7OpeningHours form={form} />;
      },
    },
    {
      _id: 'credibility',
      id: 'credibility',
      schema: step5Schema,
      processingButtonText: 'Setting up...',
      onBeforeContinue: createOrganization,
      component: (form) => {
        formDataRef.current = form.getValues();
        return <Step8Credibility form={form} />;
      },
    },
    // TODO: Re-enable connect-booking step when integrations are built
    // ...(bookingChoice === 'calendly' || bookingChoice === 'timely'
    //   ? [
    //       {
    //         _id: 'connect-booking',
    //         id: 'connect-booking',
    //         schema: connectBookingStepSchema,
    //         component: (form: UseFormReturn<OnboardingFormData>) => {
    //           formDataRef.current = form.getValues();
    //           return (
    //             <StepConnectBooking
    //               form={form}
    //               bookingAccountId={bookingAccountId}
    //               provider={bookingChoice as 'calendly' | 'timely'}
    //               onSaveFormState={() => saveFormState(form)}
    //             />
    //           );
    //         },
    //       },
    //     ]
    //   : []),
    // TODO: Re-enable stripe-connect step when deposits are built
    // ...(depositChoice === 'stripe'
    //   ? [
    //       {
    //         _id: 'stripe-connect',
    //         id: 'stripe-connect',
    //         schema: stripeConnectStepSchema,
    //         component: (form: UseFormReturn<OnboardingFormData>) => {
    //           formDataRef.current = form.getValues();
    //           return (
    //             <Step6StripeConnect
    //               form={form}
    //               onConnectStripe={() => {
    //                 saveFormState(form);
    //                 initiateStripeConnect();
    //               }}
    //               isConnectingStripe={isConnectingStripe}
    //             />
    //           );
    //         },
    //         onBeforeContinue: async (form: UseFormReturn<OnboardingFormData>) => {
    //           const isConnected = form.getValues('stripeConnected');
    //           setStripeConnected(!!isConnected);
    //           return true;
    //         },
    //       },
    //     ]
    //   : []),
  ];

  // TODO: Re-enable deposits + calendar conditional steps when built
  const conditionalSteps: (StepConfig<OnboardingFormData> & {
    _id: string;
  })[] = [];

  // if (stripeConnected) {
  //   conditionalSteps.push({
  //     _id: 'deposits',
  //     id: 'deposits',
  //     schema: depositsStepSchema,
  //     onBeforeContinue: async (form) => {
  //       const details = form.getValues('serviceDetails') || {};
  //       const services = form.getValues('services') || [];
  //       const updates = services
  //         .filter((svc) => details[svc]?.requiresDeposit)
  //         .map((svc) => ({
  //           name: svc,
  //           requiresDeposit: true,
  //           depositAmountCents: details[svc]?.depositAmountCents,
  //         }));
  //
  //       if (updates.length > 0) {
  //         try {
  //           const orgServices = await apiClient.get<{
  //             items: { id: string; name: string }[];
  //           }>('organization-services');
  //           for (const update of updates) {
  //             const existing = orgServices.items?.find(
  //               (s) => s.name === update.name
  //             );
  //             if (existing) {
  //               await apiClient.put(`organization-services/${existing.id}`, {
  //                 requiresDeposit: update.requiresDeposit,
  //                 depositAmountCents: update.depositAmountCents,
  //               });
  //             }
  //           }
  //         } catch (err) {
  //           console.error('Failed to save deposit settings:', err);
  //         }
  //       }
  //       return true;
  //     },
  //     component: (form: UseFormReturn<OnboardingFormData>) => {
  //       formDataRef.current = form.getValues();
  //       return <Step7Deposits form={form} />;
  //     },
  //   });
  // }

  conditionalSteps.push({
    _id: 'owner-provides-services',
    id: 'owner-provides-services',
    schema: ownerProvidesServicesSchema,
    component: (form: UseFormReturn<OnboardingFormData>) => {
      formDataRef.current = form.getValues();
      return <StepDoYouProvideServices form={form} />;
    },
  });

  const allSteps: (StepConfig<OnboardingFormData> & { _id: string })[] = [
    ...baseSteps,
    ...conditionalSteps,
  ];

  const steps: StepConfig<OnboardingFormData>[] = allSteps;

  // Seed the signed-up user as the first team member
  const userAsPractitioner = user
    ? {
        id: user.id,
        name: user.name || '',
        email: user.email || '',
        title: '',
      }
    : null;

  // Compute default values (merge with restored OAuth state if returning)
  const defaultValues: OnboardingFormData = oauthReturn
    ? {
        ...BASE_DEFAULT_VALUES,
        ...(oauthReturn.formValues as Partial<OnboardingFormData>),
        companyLogo: null, // File objects can't be restored from sessionStorage
        // Mark Stripe as connected if returning from Stripe OAuth
        ...(oauthReturn.source === 'stripe' && { stripeConnected: true }),
      }
    : {
        ...BASE_DEFAULT_VALUES,
        practitioners: userAsPractitioner ? [userAsPractitioner] : [],
      };

  // Compute initial step for OAuth returns
  const getInitialStep = () => {
    if (!oauthReturn) return undefined;
    if (oauthReturn.source === 'booking') {
      const idx = allSteps.findIndex((s) => s._id === 'connect-booking');
      return idx >= 0 ? idx : undefined;
    }
    // Find the step index by _id based on what OAuth flow we returned from
    const targetId = 'stripe-connect';
    const idx = allSteps.findIndex((s) => s._id === targetId);
    return idx >= 0 ? idx : baseSteps.length;
  };
  const initialStep = getInitialStep();

  const handleSubmit = async (data: OnboardingFormData) => {
    // Org was already created in onBeforeContinue on the credibility step
    hasCompletedOnboardingRef.current = true;

    // Services are already created above with whatever the website scan found.
    // Missing prices are filled in later from Catalog → Services rather than in
    // a blocking funnel step.
    //
    // Finish INTO THE PRODUCT, not into a pricing page. Customers arrive here
    // having already bought on a sales call — an onboarding specialist attaches
    // the Stripe subscription they paid for — so a plan-selection screen at the
    // end asks them to buy something they own, and does it at the moment they
    // were promised they were finished.
    //
    // /billing stays reachable from the sidebar for plan and credit
    // management, and the paid-plan guards on the API still hold, so nothing
    // is given away by not asking here.
    navigate({
      to: data.ownerProvidesServices ? '/setup-profile' : routes.home,
    });
  };

  return (
    <MultiStepForm
      steps={steps}
      defaultValues={defaultValues}
      fullSchema={onboardingSchema}
      onSubmit={handleSubmit}
      submitButtonText="Complete Setup"
      continueButtonText="Continue"
      initialStep={initialStep}
    />
  );
}
