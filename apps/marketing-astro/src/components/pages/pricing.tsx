'use client';

import { MarketingShell } from '@/components/marketing-shell';
import type { RuntimeConfig } from '@/shims/runtime-config';
import Content from './_content/pricing';

export function PricingPage({ config }: { config: RuntimeConfig }) {
  return (
    <MarketingShell config={config}>
      <Content />
    </MarketingShell>
  );
}
