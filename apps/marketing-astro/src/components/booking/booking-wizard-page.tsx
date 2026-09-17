'use client';

/**
 * Island roots for the booking wizard and the manage-booking page.
 *
 * An Astro page can only hand a component plain serialisable props, so the
 * provider stack (runtime config → PostHog → theme → React Query + Toaster)
 * is assembled here rather than in the page. This mirrors
 * `@/components/pages/booking.tsx`, which does the same for the older /book
 * flow.
 *
 * `organizationSlug` and `orgContext` arrive as PROPS, resolved server-side by
 * the Astro page. Nothing under here derives the org from `window.location`.
 */

import { BookingProviders } from '@/components/providers/booking-providers';
import { PostHogProvider } from '@/components/providers/posthog-provider';
import { ThemeProvider } from '@/components/providers/theme-provider';
import type { MicrositeOrgContext } from '@/lib/microsite-org';
import {
  type RuntimeConfig,
  RuntimeConfigProvider,
} from '@/shims/runtime-config';

import { BookingWizardContent } from './booking-wizard-content';
import { ManageBookingContent } from './manage-booking-content';

function Shell({
  config,
  children,
}: {
  config: RuntimeConfig;
  children: React.ReactNode;
}) {
  return (
    <RuntimeConfigProvider config={config}>
      <PostHogProvider>
        {/*
          `forcedTheme` because the layout pins these pages light (BaseLayout
          `theme="light"`). Without it next-themes re-resolves "system" on
          hydration and puts `.dark` back on <html>, so a customer on a
          dark-mode phone would watch the clinic's booking page flip to dark a
          moment after it painted.
        */}
        <ThemeProvider
          attribute="class"
          forcedTheme="light"
          disableTransitionOnChange
        >
          {/*
            No `data-marketing` here on purpose.

            Booking is an APP surface that happens to be served from the
            marketing deployment. `data-marketing` opted it into Borradh's
            marketing palette, whose `--primary` is stock shadcn near-black —
            so every CTA in the flow rendered black instead of the brand blue
            it had in apps/app. Falling through to `:root` gives it the app
            palette copied from `apps/app/src/styles.css`, which is the one
            these components were designed against.
          */}
          <BookingProviders>{children}</BookingProviders>
        </ThemeProvider>
      </PostHogProvider>
    </RuntimeConfigProvider>
  );
}

export function BookingWizardPage({
  config,
  organizationSlug,
  orgContext,
  locationSlug,
  initialServiceId,
}: {
  config: RuntimeConfig;
  organizationSlug: string;
  orgContext: Pick<MicrositeOrgContext, 'basePath'>;
  /**
   * The branch, from `/sites/{org}/book/l/{locationSlug}`. Optional so the
   * legacy `/book` and `/book/{serviceId}` routes keep their pre-branch
   * behaviour (the API resolves the org's default branch when none is named).
   */
  locationSlug?: string;
  initialServiceId?: string;
}) {
  return (
    <Shell config={config}>
      <BookingWizardContent
        organizationSlug={organizationSlug}
        orgContext={orgContext}
        locationSlug={locationSlug}
        initialServiceId={initialServiceId}
      />
    </Shell>
  );
}

export function ManageBookingPage({
  config,
  organizationSlug,
  token,
}: {
  config: RuntimeConfig;
  organizationSlug: string;
  token: string;
}) {
  return (
    <Shell config={config}>
      <ManageBookingContent organizationSlug={organizationSlug} token={token} />
    </Shell>
  );
}
