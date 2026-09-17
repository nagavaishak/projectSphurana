import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AdminTerminalModule } from '../admin-terminal/index.js';
import { AdminModule } from '../admin/index.js';
import { AiContentModule } from '../ai-content/index.js';
import { AnalyticsModule } from '../analytics/index.js';
import { ApiKeysModule } from '../api-keys/index';
import { AppVersionModule } from '../app-version';
import { AppointmentsModule } from '../appointments/appointments.module';
import { AssetsModule } from '../assets/assets.module';
import { AssistantModule } from '../assistant/index.js';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { BlockedTimeModule } from '../blocked-time/index.js';
import { BookingFormsModule } from '../booking-forms/index.js';
import { BookingWorkerModule } from '../booking-worker/index';
import { CampaignWorkerModule } from '../campaign-worker/index';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { CdnModule } from '../cdn/cdn.module';
import { ChatbotWorkerModule } from '../chatbot-worker/index';
import { ChatbotsModule } from '../chatbots/index.js';
import { ClaireAdCreationContextModule } from '../claire-ad-creation-context/index.js';
import { ClaireRecommendationsModule } from '../claire-recommendations/index.js';
import { ClaireWorkerModule } from '../claire-worker/index';
import {
  LocationGuard,
  MemberGuard,
  PaidPlanInterceptor,
  RequestContextMiddleware,
  RequestLoggerMiddleware,
  ResponseContractInterceptor,
  RlsInterceptor,
  SanitizeErrorsFilter,
} from '../common';
import { FlyThrottlerGuard } from '../common/guards/fly-throttler.guard';
import { RedisThrottlerStorage } from '../common/guards/redis-throttler.storage';
import { ConsentFormsModule } from '../consent-forms/consent-forms.module.js';
import { ContentBatchesModule } from '../content-batches/index.js';
import { ConversationsModule } from '../conversations/index.js';
import { DebugModule } from '../debug/index.js';
import { DepositsModule } from '../deposits/index.js';
import { DocumentImportWorkerModule } from '../document-import-worker/index';
import { DocumentImportsModule } from '../document-imports/index.js';
import { FaceGroupsModule } from '../face-groups/index.js';
import { GiftCardsModule } from '../gift-cards/index.js';
import { GraphicsModule } from '../graphics/graphics.module';
import { HealthModule } from '../health';
import { IntakeFormsModule } from '../intake-forms/index.js';
import { IntegrationsModule } from '../integrations';
import { InventoryModule } from '../inventory/index.js';
import { KnowledgeWorkerModule } from '../knowledge-worker/index';
import { LeadFirstTouchWorkerModule } from '../lead-first-touch-worker/index';
import { LeadFormsModule } from '../lead-forms/index.js';
import { LeadsModule } from '../leads/leads.module';
import { LocationOpeningHoursModule } from '../location-opening-hours/index.js';
import { MembershipsModule } from '../memberships/index.js';
import { MetaAdsModule } from '../meta-ads/meta-ads.module';
import { MetaCampaignsModule } from '../meta-campaigns/meta-campaigns.module';
import { MicrositesModule } from '../microsites/index.js';
import { NotificationPreferencesModule } from '../notification-preferences/index.js';
import { NotificationsModule } from '../notifications/index.js';
import { OffersModule } from '../offers/index.js';
import { OnboardingModule } from '../onboarding/index.js';
import { OrgDefaultsModule } from '../org-defaults/index.js';
import { OrganizationLocationsModule } from '../organization-locations/index.js';
import { OrganizationServicesModule } from '../organization-services/index.js';
import { OrganizationModule } from '../organization/organization.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PackagesModule } from '../packages/index.js';
import { PatientAuthModule } from '../patient-auth/index.js';
import { PatientBookingsModule } from '../patient-bookings/patient-bookings.module.js';
import { PatientDocumentsModule } from '../patient-documents/patient-documents.module.js';
import { PaymentsModule } from '../payments/index.js';
import { PlacesModule } from '../places/index.js';
import { PractitionersModule } from '../practitioners/index.js';
import { RecommendationsModule } from '../recommendations/index.js';
import { ResourcesModule } from '../resources/index.js';
import { SalesModule } from '../sales/index.js';
import { SchedulerModule } from '../scheduler';
import { ServiceCategoriesModule } from '../service-categories/index.js';
import { ShiftsModule } from '../shifts/index.js';
import { SocialPostsModule } from '../social-posts/index.js';
import { TerminalModule } from '../terminal/index.js';
import { TestingModule } from '../testing/index';
import { TimeOffModule } from '../time-off/index.js';
import { TimesheetsModule } from '../timesheets/index.js';
import { TrainingHubModule } from '../training-hub/training-hub.module';
import { UploadModule } from '../upload/upload.module';
import { UsersModule } from '../users/users.module';
import { V1Module } from '../v1/index';
import { VenueModule } from '../venue/index.js';
import { VideosModule } from '../videos/videos.module';
import { VoiceCloningModule } from '../voice-cloning/index.js';
import { VoiceIngestWorkerModule } from '../voice-ingest-worker/index';
import { WageConfigsModule } from '../wage-configs/index.js';
import { BillingWebhooksModule } from '../webhooks/billing/index.js';
import { GoogleCalendarWebhooksModule } from '../webhooks/google-calendar/index.js';
import { MetaWebhooksModule } from '../webhooks/meta/meta-webhooks.module';
import { StripeConnectWebhooksModule } from '../webhooks/stripe-connect/index.js';
import { WhatsAppWebhooksModule } from '../webhooks/whatsapp/index.js';
import { WebsiteAnalysisModule } from '../website-analysis/index.js';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    // Load .env from workspace root
    ConfigModule.forRoot({
      envFilePath: '../../.env',
      isGlobal: true,
    }),

    // Rate limiting — Redis-backed, shared across instances.
    // Loose global backstop: 600 requests/min per CLIENT IP (keyed via
    // FlyThrottlerGuard's Fly-Client-IP tracker, not the rotating Fly proxy IP).
    // This is intentionally generous — it only catches egregious abuse on
    // otherwise-undecorated routes. Sensitive endpoints set their own strict
    // limits with @Throttle() (e.g. AuthController). Use @SkipThrottle() on
    // webhooks/health. Locally: effectively disabled (10k/min) so dev/e2e aren't
    // blocked (the storage also no-ops when E2E_SEED_TOKEN is set).
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'default',
          ttl: 60_000,
          limit: process.env.NODE_ENV === 'production' ? 600 : 10_000,
        },
      ],
      storage: new RedisThrottlerStorage(),
    }),

    // Health check module (BetterStack uptime monitoring)
    AppVersionModule,
    HealthModule,

    // Auth module with custom controller using @borradh-workspace/features
    AuthModule,
    // Users module
    UsersModule,
    // Organizations module (RESTful /organizations routes)
    OrganizationsModule,
    // Organization module (session-specific /organization routes)
    OrganizationModule,
    // Organization Services module (service management for tagging)
    OrganizationServicesModule,
    // Service Categories module (custom per-org categories)
    ServiceCategoriesModule,
    // Packages module (service bundles sold at a single price)
    PackagesModule,
    // Organization Locations module (multi-location support)
    OrganizationLocationsModule,
    // Practitioners module (multi-staff booking)
    PractitionersModule,
    // Scheduling: blocked time types + blocked time (unavailability successor)
    BlockedTimeModule,
    // Scheduling: practitioner time off
    TimeOffModule,
    // Scheduling: weekly shift patterns + date overrides
    ShiftsModule,
    // Scheduling: per-practitioner wage / auto-clock configuration
    WageConfigsModule,
    // Per-location opening hours (standing schedule + per-date exceptions)
    LocationOpeningHoursModule,
    // Scheduling: rooms & equipment — the SECOND availability source, after
    // shifts. A misconfigured room makes a service unbookable exactly as a
    // missing rota does.
    ResourcesModule,
    // Website Analysis module (AI-powered website content extraction)
    WebsiteAnalysisModule,
    // Upload module (S3 presigned URLs)
    UploadModule,
    // Videos module
    VideosModule,
    // Assets module
    AssetsModule,
    // Leads module
    LeadsModule,
    // Messaging Campaigns module
    CampaignsModule,
    // Chatbots module (automated Messenger/Instagram DM bots)
    ChatbotsModule,
    // Booking lifecycle worker (BullMQ worker for reminders, deposit expiry,
    // calendar sync — off the request path and off the single-replica cron)
    BookingWorkerModule,
    // Chatbot flow worker (BullMQ worker for chatbot flow execution)
    ChatbotWorkerModule,
    // Campaign send worker (BullMQ worker for messaging-campaign sends)
    CampaignWorkerModule,
    // Knowledge update worker (BullMQ worker for knowledge base updates)
    KnowledgeWorkerModule,
    LeadFirstTouchWorkerModule,
    // Claire classify worker (BullMQ worker for business-profile classification)
    ClaireWorkerModule,
    // Document match worker (BullMQ worker reading imported documents, ENG-784)
    DocumentImportWorkerModule,
    // Conversations module (chatbot inbox and messaging)
    ConversationsModule,
    // CDN module (CloudFront signed cookies)
    CdnModule,
    // Training Hub module
    TrainingHubModule,
    // Meta Ads modules
    MetaCampaignsModule,
    MetaAdsModule,
    // Google Calendar webhooks module (push notifications for calendar sync)
    GoogleCalendarWebhooksModule,
    // Meta webhooks module (Lead form notifications + Messenger/Instagram messaging)
    MetaWebhooksModule,
    // WhatsApp webhooks module (WhatsApp Cloud API messaging)
    WhatsAppWebhooksModule,
    // Stripe Connect webhooks module (Deposit payments)
    StripeConnectWebhooksModule,
    // Stripe customer billing webhook — alias path under /webhooks/billing
    // so the borradh-webhooks router can fan it out to per-PR previews.
    // Legacy /billing/webhook route still works (in BillingModule) — this
    // is parallel, not a replacement.
    BillingWebhooksModule,
    // Appointments module
    AppointmentsModule,
    // Deposits module (Stripe Connect deposits for appointments)
    DepositsModule,
    // Payments module (general-purpose Stripe Connect payments)
    PaymentsModule,
    // Sales / POS module (sales, items, tips, tenders)
    SalesModule,
    // Gift cards module (balance ledger; issue/redeem via sales)
    GiftCardsModule,
    // Stripe Terminal module (connection tokens + readers)
    TerminalModule,
    // Graphics module (static content image generation)
    GraphicsModule,
    // Scheduler module (background cron/interval jobs)
    SchedulerModule,
    // Billing module (Stripe subscriptions and credits)
    BillingModule,
    // Integrations module (OAuth connections for Calendar, Email, etc.)
    IntegrationsModule,
    // Inventory module (products, stock, stock orders, stock takes)
    InventoryModule,
    // Booking Forms module (public booking pages)
    BookingFormsModule,
    PatientAuthModule,
    PatientBookingsModule,
    ConsentFormsModule,
    PatientDocumentsModule,
    DocumentImportsModule,
    VenueModule,

    IntakeFormsModule,
    // Social Posts module (content calendar and social media publishing)
    SocialPostsModule,
    // Content Batches module (monthly bulk organic content + accept/regenerate review)
    ContentBatchesModule,
    // Lead Forms module (Meta lead gen form management)
    LeadFormsModule,
    // Recommendations module (AI recommendations for Meta Ads)
    RecommendationsModule,
    // Offers module (reusable offer management for videos/ads)
    OffersModule,
    // Memberships module (membership plans + lead memberships)
    MembershipsModule,
    // Microsites module (public host resolution + document reads for the
    // tenant-facing website; see docs/plans/microsites.md §9)
    MicrositesModule,
    // Onboarding module (Claire-guided Typeform-style onboarding flow)
    OnboardingModule,
    // Face Groups module (face detection and before/after grouping)
    FaceGroupsModule,
    // AI Content module (AI-generated ad copy and social post captions)
    AiContentModule,
    // Assistant module (AI assistant usage tracking and rate limiting)
    AssistantModule,
    // Claire recommendations module (list/dismiss/action for Claire-Owner toasts)
    ClaireRecommendationsModule,
    // Claire ad-creation context module (recommendation engine read endpoint
    // + business-profile axis overrides + market position setter)
    ClaireAdCreationContextModule,
    // Admin module (Bull Board queue monitoring)
    AdminModule,
    // Admin Terminal module (global admin org browser + impersonation)
    AdminTerminalModule,
    // Debug module (Sentry testing)
    DebugModule,
    // API key management module (session authenticated)
    ApiKeysModule,
    // Public API v1 module (API key authenticated)
    V1Module,
    // Notification preferences module (user notification settings)
    NotificationPreferencesModule,
    // Push notifications module (device token registration)
    NotificationsModule,
    // Places module (Google Places autocomplete proxy)
    PlacesModule,
    // Voice cloning module (voice style analysis and ingest)
    VoiceCloningModule,
    // Voice ingest worker (BullMQ worker for voice ingest pipeline)
    VoiceIngestWorkerModule,
    // Analytics module (S3 snapshot backfill endpoint)
    AnalyticsModule,
    // Testing module (E2E seed data - disabled in production)
    TestingModule,
    // Org Defaults module (per-org Claire defaults — ad budget, video orientation, etc.)
    OrgDefaultsModule,
    // Timesheets module (time entries / clock-in / breaks)
    TimesheetsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global exception filter - sanitizes 5xx error messages so internal
    // details (SQL, stack traces, etc.) never reach the frontend
    { provide: APP_FILTER, useClass: SanitizeErrorsFilter },
    // Global rate-limiting guard — applies the default throttler to every
    // route, keyed on the real client IP (Fly-Client-IP) rather than the
    // rotating Fly proxy IP. Per-route @Throttle() overrides still apply;
    // @SkipThrottle() opts out (webhooks/health).
    { provide: APP_GUARD, useClass: FlyThrottlerGuard },
    // Global Member Guard - Verifies user is a member of the active organization
    // Automatically skips for unauthenticated routes or routes without org context
    // Use @SkipMemberCheck() to opt out explicitly
    { provide: APP_GUARD, useClass: MemberGuard },
    // Global Location Guard - Validates the optional X-Location-Id header
    // against the active organization and publishes it as
    // request.activeLocationId for @ActiveLocation(). No header = org-wide,
    // which is the pre-existing behaviour of every endpoint.
    { provide: APP_GUARD, useClass: LocationGuard },
    // RLS Interceptor - Establishes the per-request RLS AsyncLocalStorage
    // context. MUST be registered first so it is the OUTERMOST interceptor:
    // NestJS runs APP_INTERCEPTORs in registration order, and downstream
    // interceptors (PaidPlanInterceptor) call withOrgScope-wrapped services
    // that read this context. If it ran after them, those services would throw
    // "withOrgScope called without an RLS organization context" under
    // enforcement, 403-ing every paid-plan-gated route.
    { provide: APP_INTERCEPTOR, useClass: RlsInterceptor },
    // Paid Plan Interceptor - Rejects requests from expired-trial organizations.
    // Runs after guards (so user/org context is available) and inside the RLS
    // context established above (so getSubscription can read org-scoped data).
    { provide: APP_INTERCEPTOR, useClass: PaidPlanInterceptor },
    // Response-Contract Interceptor - validates responses of methods annotated
    // with @ResponseContract(schema) against the shared contracts Zod schema.
    // Registered LAST so it is the INNERMOST interceptor (closest to the
    // handler), validating the value the handler actually returned before the
    // outer interceptors see it. Report mode by default (logs a mismatch);
    // strict throws, gated by isFeatureOn('response-parse-strict'). Unannotated
    // routes pass straight through.
    { provide: APP_INTERCEPTOR, useClass: ResponseContractInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // CSRF Origin-validation middleware (CsrfMiddleware) is intentionally NOT
    // applied here yet — re-enabling it needs the E2E harness updated to send
    // an Origin on every cookie-authed request. Tracked as a follow-up.
    consumer
      .apply(RequestContextMiddleware, RequestLoggerMiddleware)
      .forRoutes('*');
  }
}
