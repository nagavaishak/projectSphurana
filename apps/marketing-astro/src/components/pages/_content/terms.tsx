'use client';

import { Container } from '@/components/marketing/container';
import { useEffect } from 'react';

export default function TermsOfServicePage() {
  useEffect(() => {
    if (document.getElementById('termly-jssdk')) return;

    const script = document.createElement('script');
    script.id = 'termly-jssdk';
    script.src = 'https://app.termly.io/embed-policy.min.js';
    document.body.appendChild(script);

    return () => {
      const existing = document.getElementById('termly-jssdk');
      if (existing) existing.remove();
    };
  }, []);

  return (
    <div className="min-h-screen py-10 md:py-20 lg:py-32">
      <Container className="max-w-4xl">
        <div
          // @ts-expect-error -- Termly uses a custom "name" attribute on divs
          name="termly-embed"
          data-id="ddfc5370-8a74-4ce9-bb10-dd015e5b9db4"
        />
      </Container>
    </div>
  );
}
