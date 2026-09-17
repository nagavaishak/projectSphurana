/**
 * Per-tool path-whitelist extension for the appointments tools.
 *
 * Each tool passes this via `additionalAllowedPaths` on `defineTool`. The
 * factory composes these with the shared `ALLOWED_API_PATHS` (in
 * `path-whitelist.ts`) at call time without mutating the shared list, so the
 * extension is scoped to appointments tools only.
 *
 * The patterns intentionally restrict to the `/appointments` family +
 * `/appointments/open-slots`. Lead/practitioner/service lookups are NOT
 * exposed here — those flow through the context tools' shared whitelist
 * (`/organization-services`, etc.) or through future C-06/C-09 tool
 * extensions.
 */
export const APPOINTMENTS_PATH_PATTERNS: readonly RegExp[] = [
  // `isPathAllowed` strips the query string before matching, so these match
  // both `/appointments` and `/appointments?<filters>`.
  /^appointments$/,
  /^appointments\/[a-zA-Z0-9_-]+$/,
  /^appointments\/open-slots$/,
];
