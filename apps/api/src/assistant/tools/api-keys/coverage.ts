import { defineCoverage } from '../coverage.types.js';

/**
 * API-KEYS — 4 endpoints, 0 tools. Management of the credentials that
 * authenticate third-party integrators against the `v1` public API.
 *
 * This is a CREDENTIAL LIFECYCLE surface, and the whole area turns on one
 * property: the secret is shown exactly once, at creation, and is never
 * retrievable again. That makes the create endpoint the single moment a live
 * credential exists in a response body — and a model's context is a place
 * secrets get logged, replayed into a transcript, and read back to whoever is
 * on the other end of a conversation, including an inbound customer message
 * that asked nicely.
 *
 * Nothing here answers a question an owner brings to Claire. Issuing and
 * revoking access for an external system is an act of delegation the owner
 * performs deliberately, in a settings screen, where they can see the scope
 * they are handing out and the list of who already holds one.
 */
export const apiKeysCoverage = defineCoverage('api-keys', {
  'GET /api-keys': {
    notExposed:
      'Lists the keys issued to third-party integrators — prefixes, scopes, last-used timestamps. It is the access-control roster for a surface Claire does not use, and reciting who holds a key is not an answer any owner comes to her for.',
  },
  'POST /api-keys': {
    notExposed:
      'Mints a new key and returns the secret in the response, the only time it is ever visible. Putting a live credential into a model’s context is how one ends up in a transcript, and prompt injection turns that transcript into an exfiltration path.',
  },
  'PATCH /api-keys/:id': {
    notExposed:
      'Edits a key’s scope or active flag. Widening scope silently grants an outside system more of the business’s data; narrowing it silently breaks that system’s integration, with no error the owner will see.',
  },
  'DELETE /api-keys/:id': {
    notExposed:
      'Revokes a key immediately and irreversibly. Whatever integration was using it stops working mid-flight, and the only fix is issuing a new key and updating the third party by hand.',
  },
});
