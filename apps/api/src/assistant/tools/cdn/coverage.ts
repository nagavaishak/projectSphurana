import { defineCoverage } from '../coverage.types.js';

/**
 * CDN — 3 endpoints, 0 tools. CloudFront signed-cookie issuance for private
 * media, plus a status probe.
 *
 * These are BROWSER MECHANICS. The signed-cookie route sets `CloudFront-Policy`,
 * `-Signature` and `-Key-Pair-Id` on the response as domain-scoped cookies, so
 * that subsequent `<img>` and `<video>` requests from the same browser are
 * authorised at the edge without any URL rewriting. The whole design depends
 * on a cookie jar attached to a rendering surface. Claire has neither, and she
 * loads no media — she references assets by id and lets the frontend render
 * them.
 *
 * That also makes the cookies a bearer credential worth keeping out of a
 * model's context: they grant read access to the org's entire private media
 * prefix for their lifetime, not to one object.
 */
export const cdnCoverage = defineCoverage('cdn', {
  'POST /cdn/signed-cookies': {
    notExposed:
      'Sets CloudFront signed cookies so a browser can load private media directly from the edge. They are a bearer credential covering the org’s whole media prefix, and they are useless to a caller with no cookie jar and nothing to render.',
  },
  'POST /cdn/clear-cookies': {
    notExposed:
      'Expires those cookies on sign-out or org switch. Housekeeping for a browser session Claire is not part of.',
  },
  'GET /cdn/status': {
    notExposed:
      'Reports whether CDN signing is configured on this deployment, so the frontend knows whether to request cookies at all. An infrastructure readiness flag, not a fact about the business.',
  },
});
