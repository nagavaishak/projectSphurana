'use client';

// The marketing chrome: providers + navbar + footer. Each marketing page is
// rendered as a single React island wrapping its content in this shell, so
// theme / runtime-config / PostHog context flows through one React tree.
import { Footer } from '@/components/marketing/footer';
import { Navbar } from '@/components/marketing/navbar';
import { PostHogProvider } from '@/components/providers/posthog-provider';
import { ThemeProvider } from '@/components/providers/theme-provider';
import {
  type RuntimeConfig,
  RuntimeConfigProvider,
} from '@/shims/runtime-config';
import type { ReactNode } from 'react';

export function MarketingShell({
  config,
  children,
}: {
  config: RuntimeConfig;
  children: ReactNode;
}) {
  return (
    <RuntimeConfigProvider config={config}>
      <PostHogProvider>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <div data-marketing>
            <Navbar />
            <main className="bg-background text-foreground">{children}</main>
            <Footer />
          </div>
        </ThemeProvider>
      </PostHogProvider>
    </RuntimeConfigProvider>
  );
}
