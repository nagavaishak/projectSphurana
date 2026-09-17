import { defineCoverage } from '../coverage.types.js';

/**
 * PATIENT-PORTAL-ACCESS — 1 endpoint, 0 tools. The staff-side mint of a
 * one-time portal sign-in link for a customer ("Copy portal link" on the
 * patient profile).
 *
 * Withheld because the artefact it produces IS a credential: whoever holds
 * the URL signs in as that customer, no further challenge. The product treats
 * handing it over as a deliberate human act — the UI copies it to the
 * clipboard with an explicit warning that it signs the customer straight in.
 * A model minting sign-in links (or being injected into minting one and
 * pasting it into the wrong conversation) is exactly the leak that design
 * guards against. If Claire should ever help here, the safe shape is asking
 * a HUMAN to press the existing button, not pressing it herself.
 */
export const patientPortalAccessCoverage = defineCoverage(
  'patient-portal-access',
  {
    'POST /patient-portal-access/:leadId': {
      notExposed:
        'Mints a one-time link that signs a named customer straight into their portal — a bearer credential. Only a human should create and hand over a credential for another person; a prompt-injected mint-and-paste would be account takeover.',
    },
  }
);
