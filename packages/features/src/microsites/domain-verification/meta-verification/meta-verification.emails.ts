/**
 * One email per REASON, because the reasons need different actions.
 *
 * "We couldn't verify your domain with Meta" is a useless notice: the person
 * reading it cannot tell whether to call their old agency, finish Business
 * Verification, or reconnect the integration. Each body below names the ONE
 * thing that will actually fix it and where to do it.
 *
 * A transient failure is deliberately absent — nobody is emailed about a Meta
 * outage the poller will ride out.
 */

import type { MetaVerificationOutcome } from './meta-verification.types.js';

export interface HumanActionEmail {
  subject: string;
  html: string;
}

export const humanActionEmail = (
  outcome: MetaVerificationOutcome,
  host: string
): HumanActionEmail | null => {
  switch (outcome) {
    case 'conflict':
      return {
        subject: `Action needed: ${host} is claimed in another Meta account`,
        html: `
  <p>We tried to verify <strong>${host}</strong> in your Meta Business
  account automatically, but Meta says the domain is already claimed by a
  <strong>different</strong> business account.</p>
  <p>Meta allows only one owner per domain, so this cannot be resolved from our
  side no matter how many times we try. Usually it means the domain was
  verified in a previous agency's Business Manager, or in a personal one.</p>
  <p><strong>What fixes it:</strong> in the Business Manager that currently
  holds it, go to Business Settings → Brand Safety → Domains, select
  <code>${host}</code> and remove it. We will claim it automatically within a
  few minutes of it being released.</p>
  <p>Until then, your ads keep running — but conversions from iPhones will be
  under-reported.</p>`,
      };

    case 'business_unverified':
      return {
        subject: 'Action needed: finish Business Verification with Meta',
        html: `
  <p>To verify <strong>${host}</strong> for your ads, Meta requires your
  Business Manager to have completed <strong>Business Verification</strong>.
  Yours has not, and that blocks the whole domain step — the domain itself is
  fine.</p>
  <p><strong>What fixes it:</strong> Meta Business Settings → Security Centre →
  Start Verification. You will need your business registration details. Meta
  usually reviews it within a few days.</p>
  <p>Once it is approved we will verify the domain automatically — there is
  nothing for you to paste anywhere.</p>`,
      };

    case 'permission_denied':
      return {
        subject: 'Action needed: reconnect Meta to finish domain setup',
        html: `
  <p>We could not verify <strong>${host}</strong> because the connected Meta
  account does not have permission to manage domains for your business.</p>
  <p><strong>What fixes it:</strong> reconnect Meta from Settings →
  Integrations, signing in as someone with an <strong>admin</strong> role on
  the business (not just on the ad account). If your ad account is a personal
  one, you will need to create a Business Manager first.</p>`,
      };

    case 'token_unavailable':
      return {
        subject: `Action needed: verify ${host} in Meta Business Settings`,
        html: `
  <p>Your domain <strong>${host}</strong> is registered in your Meta Business
  account, but Meta did not give us the verification code we normally place on
  your website for you.</p>
  <p><strong>What fixes it:</strong> Business Settings → Brand Safety →
  Domains → <code>${host}</code>, and complete verification using the DNS TXT
  record Meta shows you. This is the one case where we cannot do it for you.</p>`,
      };

    default:
      return null;
  }
};
