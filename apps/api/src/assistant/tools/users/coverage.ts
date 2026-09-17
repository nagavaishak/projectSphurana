import { defineCoverage } from '../coverage.types.js';

/**
 * USERS — 3 endpoints, 0 tools. The person account, as distinct from the
 * organization.
 *
 * Claire's subject is a BUSINESS. Practitioners, roles and rotas she reaches
 * through the practitioners and shifts areas, where the record is about
 * somebody's working life. This area is about somebody's identity: their name,
 * their avatar, their login. The two are easy to confuse and the distinction
 * is the reason all three stay closed — a "user" here is a human being with an
 * account, not a resource of the business.
 *
 * The read is also cross-tenant by id, which is enough on its own: it takes a
 * user id and resolves it, so nothing in the route shape confines it to the
 * org Claire is acting for.
 */
export const usersCoverage = defineCoverage('users', {
  'GET /users/:id': {
    notExposed:
      'Resolves a user account by id, with no organization in the path to scope it. Claire reads people as practitioners, where the record is about their working life rather than their identity.',
  },
  'PUT /users/:id': {
    notExposed:
      'Edits another person’s profile — their name and avatar as they appear to colleagues and, on booking pages, to customers. Changing how someone is presented to the public is theirs to do, not the business’s assistant’s.',
  },
  'DELETE /users/me': {
    notExposed:
      'Account deletion. It is the GDPR erasure path, it cascades through everything the person owns, and it is irreversible — the one act in the product where a misread instruction cannot be walked back at all.',
  },
});
