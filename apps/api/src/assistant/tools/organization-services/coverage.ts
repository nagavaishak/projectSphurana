import { defineCoverage } from '../coverage.types.js';

/**
 * ORGANIZATION-SERVICES — 11 endpoints, 5 tools. The service catalogue: what
 * the business sells, how long it takes and what it costs. It is the most
 * thoroughly covered area in this batch, and the one place where Claire already
 * has a full CRUD surface (`context_listServices`, `getServiceDetails`,
 * `createService`, `updateService`, `deleteService`).
 *
 * The shape of the decision here is about the PRICING MODEL. A service is not
 * one price: it is `priceType` + `priceCents` + an ordered list of named
 * variants ("single", "course of 3"). `createService` and `updateService` both
 * reach into the variants sub-resource to keep that model whole, which is why
 * three of the variant routes are exposed under those two tool names rather
 * than under variant tools of their own. What is deliberately NOT reachable is
 * anything that removes a variant or reshuffles display order — `updateService`
 * upserts by name and never deletes what you omit, and that asymmetry is the
 * safety property, not an oversight.
 */
export const organizationServicesCoverage = defineCoverage(
  'organization-services',
  {
    // ---- reads -----------------------------------------------------------
    'GET /organization-services': { exposed: 'context_listServices' },
    'GET /organization-services/:id': { exposed: 'context_getServiceDetails' },

    // Read by `updateService` before it upserts: variants are matched by name,
    // so the tool has to see the existing set first. Also inlined on each row
    // returned by `listServices`, so Claire reaches variants two ways.
    'GET /organization-services/:serviceId/variants': {
      exposed: 'context_updateService',
    },

    // ---- writes ----------------------------------------------------------
    // Catalogue edits are confirmation-gated across the board: a service's
    // price and duration are quoted to customers by the chatbot and printed on
    // ads, so a wrong edit is visible to the public within minutes.
    'POST /organization-services': {
      exposed: 'context_createService',
      confirm: true,
    },
    'POST /organization-services/:serviceId/variants': {
      exposed: 'context_createService',
      confirm: true,
    },
    'PUT /organization-services/:id': {
      exposed: 'context_updateService',
      confirm: true,
    },
    'PUT /organization-services/variants/:variantId': {
      exposed: 'context_updateService',
      confirm: true,
    },
    'DELETE /organization-services/:id': {
      exposed: 'context_deleteService',
      confirm: true,
    },

    // The ADD half of branch assignment, and the reason the PUT below stays
    // shut: this endpoint only inserts, rejects an empty list, and no-ops on a
    // service already offered everywhere — so none of the replace-or-reset
    // hazard applies to it.
    // Withheld while the ADD is exposed, and the asymmetry is the point:
    // adding a branch widens availability and is recoverable by removing it,
    // while removing one takes a service off a branch's booking page — and on a
    // service offered everywhere it first MATERIALISES the complement, so the
    // shape of what changed is not obvious from the request. A person should
    // see the branch list they are about to write.
    'DELETE /organization-services/:id/locations/:locationId': {
      notExposed:
        "Stops offering a service at one branch. The counterpart POST is exposed, this is not: removal narrows what customers can book, and against a service with no assignments it writes the complement (every OTHER branch) rather than deleting a row — a bigger, less obvious write than the request reads like. The withdrawal decision belongs with whoever answers for that branch's diary.",
    },

    'POST /organization-services/:id/locations': {
      exposed: 'context_addServiceLocations',
      confirm: true,
    },

    'PUT /organization-services/:id/locations': {
      notExposed:
        'Replaces which branches offer a service and what each one charges. The withholding reason is MECHANICAL, not general caution: the body is a full REPLACE whose EMPTY form means "offered at every branch", not "none" — the zero-rows-means-everywhere convention the read path is built on. So the natural model reasoning for "stop offering this in Cork" ("clear the list") publishes it EVERYWHERE at the org price instead, and `priceCentsOverride` is money a customer is quoted next. The failure is silent and the response shape is identical either way. Reachable once the shape is add/remove rather than replace-or-reset.',
    },
    'PUT /organization-services/:serviceId/variants/reorder': {
      notExposed:
        'Sets the display order of a service’s variants and nothing else — no price, no duration, no availability changes. It takes the complete ordered id array produced by dragging rows in the settings UI, which Claire would have to reconstruct wholesale to move one row, and a mistake silently reorders the price list a customer sees.',
    },
    'POST /organization-services/import-csv': {
      notExposed:
        'Takes the raw bytes of a spreadsheet the owner exported from their previous booking system, chosen in a file picker. Claire has no file to send and no way to see the one they picked, so there is nothing here for her to drive — and the write it performs (create a service) she already reaches through `context_createService`, one named service at a time and with a confirm.',
    },
    'POST /organization-services/seed': {
      notExposed:
        'Bulk-inserts a starter catalogue for a business type (barber, spa, nail salon…). It is an onboarding-wizard action run once on an empty org; against an org that already has services it appends a second full catalogue with no dedupe, leaving the owner to delete dozens of rows by hand.',
    },
    'DELETE /organization-services/variants/:variantId': {
      notExposed:
        'Destroys a priced variant. `updateService` deliberately upserts only and never removes variants the caller omitted — that asymmetry is what makes a partial update from a language model safe, and exposing the delete would hand back exactly the failure mode it was designed to prevent.',
    },
  }
);
