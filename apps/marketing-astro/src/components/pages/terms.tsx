'use client';

import { MarketingShell } from '@/components/marketing-shell';
import type { RuntimeConfig } from '@/shims/runtime-config';
import Content from './_content/terms';

export function TermsPage({ config }: { config: RuntimeConfig }) {
  return (
    <MarketingShell config={config}>
      <Content />
    </MarketingShell>
  );
}
