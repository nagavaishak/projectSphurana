import { defineCoverage } from '../coverage.types.js';

/**
 * ORGANIZATION-LOCATIONS — 7 endpoints, 0 tools. The org's physical sites. A
 * location is the anchor the rest of the scheduling stack hangs off: opening
 * hours, shifts, practitioner assignments and venue pages are all per-location.
 *
 * The read is the gap that matters, and it is one Claire is already tripping
 * over — `claire_setPendingOfferLocations` asks the model which locations an
 * offer applies to, while nothing in her toolset can tell her what those
 * locations ARE. She is being asked to pick from a list she cannot read.
 *
 * The writes are org-shape changes an owner makes rarely, from a form with an
 * address autocomplete attached, so they stay out.
 */
export const organizationLocationsCoverage = defineCoverage(
  'organization-locations',
  {
    // ---- reads -----------------------------------------------------------
    'GET /organization-locations': { undecided: 'ENG-CLAIRE-LOCATIONS-READ' },

    // ---- writes ----------------------------------------------------------
    'POST /organization-locations': {
      notExposed:
        'Opening a new site is a real-world business event with an address, and the form behind it is driven by the Google Places autocomplete so the address is verified as it is typed. Claire has no verified address to supply, and a phantom location makes itself bookable.',
    },
    'PUT /organization-locations/:id': {
      notExposed:
        'Edits the address, contact details and public-facing particulars of a physical site. These are facts about the world that the owner knows and Claire does not, and an incorrect address sends customers to the wrong door.',
    },
    'POST /organization-locations/:id/set-primary': {
      notExposed:
        'Repoints the org’s default site, which changes where new bookings, staff and opening hours default to across the whole product. It is a one-line call with organisation-wide blast radius and no obvious signal that anything moved.',
    },
    'GET /organization-locations/:id/catalog': {
      notExposed:
        "The join rows behind the branch setup screen, and meaningless without that screen's framing: an id absent from this response is NOT unavailable at the branch — an entity assigned nowhere is available everywhere. Handing a model a list whose silences invert its meaning is worse than handing it nothing.",
    },
    'PUT /organization-locations/:id/catalog': {
      notExposed:
        'Decides which practitioners, services, products, plans and promotions a branch offers. The write is additive by construction, but the read it would need is the one thing that makes it dangerous: an empty assignment set means "available at EVERY branch", so a model reasoning from "this branch has no services listed" would conclude the opposite of the truth. This is a setup screen an owner works through once, with the whole catalogue in front of them.',
    },
    'DELETE /organization-locations/:id': {
      notExposed:
        'Removes a site along with the scheduling scaffolding hung off it — opening hours, shifts and practitioner assignments are all per-location. Closing a branch is a decision the owner makes once, not something to be inferred from a sentence.',
    },
  }
);
