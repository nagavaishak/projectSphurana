import { defineCoverage } from '../coverage.types.js';

/**
 * SERVICE-CATEGORIES — 5 endpoints, 0 tools. The headings the service menu is
 * grouped under ("Colour", "Cutting", "Treatments"), ordered for display on the
 * public booking page.
 *
 * Claire has full CRUD over SERVICES and none at all over the categories they
 * sit in, which is the incoherence worth recording: `context_createService`
 * puts a new service somewhere in the menu without her being able to see, let
 * alone choose, the headings available. That is the read.
 *
 * The writes are the taxonomy itself. A category is created once and then
 * outlives hundreds of services, so the ratio of "value of Claire creating one"
 * to "damage from Claire creating a near-duplicate of one that exists" is bad.
 */
export const serviceCategoriesCoverage = defineCoverage('service-categories', {
  // ---- reads -------------------------------------------------------------
  'GET /service-categories': { undecided: 'ENG-CLAIRE-SERVICE-CATEGORIES' },

  // ---- writes ------------------------------------------------------------
  'POST /service-categories': {
    notExposed:
      'Adds a heading to the public service menu. Categories are long-lived and few; a model that cannot currently read the existing list would reliably create "Colouring" alongside "Colour", splitting the menu a customer browses in two and leaving the owner to merge them by hand.',
  },
  'PUT /service-categories/:id': {
    notExposed:
      'Renames or restyles a menu heading that is live on the booking page and already attached to every service beneath it. A rename Claire inferred from one sentence changes what every customer sees, with no reviewable diff.',
  },
  'DELETE /service-categories/:id': {
    notExposed:
      'Removes a heading that services are filed under, orphaning them in the menu. Destructive, publicly visible, and the owner is one click away from doing it in settings where the affected services are listed in front of them.',
  },
  'POST /service-categories/reorder': {
    notExposed:
      'Sets the order the menu headings appear in on the booking page. It takes the complete ordered id array a drag-and-drop list produces, is purely cosmetic, and reconstructing that array to move one heading is the kind of whole-payload rewrite that quietly loses entries.',
  },
});
