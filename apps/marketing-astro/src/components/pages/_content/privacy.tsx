import { Container } from '@/components/marketing/container';
// Rendered statically (not via the Termly JS embed) so the policy is present in the
// server-rendered HTML. Meta's App Review crawler does not execute JavaScript, and a
// client-injected policy reads to it as a page with no privacy statements.
// Keep in sync with the Termly source document (privacy policy
// 11c69824-fa02-4d60-ac72-d0eab50c1e32) whenever that document is edited.
import policyHtml from './privacy-policy.html?raw';

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen py-10 md:py-20 lg:py-32">
      <Container className="max-w-4xl">
        <article
          className="legal-doc"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted first-party legal copy, checked into the repo
          dangerouslySetInnerHTML={{ __html: policyHtml }}
        />
      </Container>
    </div>
  );
}
