'use client';

import { MarketingShell } from '@/components/marketing-shell';
import { Container } from '@/components/marketing/container';
import type { RuntimeConfig } from '@/shims/runtime-config';
import Content from './_content/not-found';

export function NotFoundPage({ config }: { config: RuntimeConfig }) {
  return (
    <MarketingShell config={config}>
      <Container className="py-20 md:py-32">
        <Content />
      </Container>
    </MarketingShell>
  );
}
