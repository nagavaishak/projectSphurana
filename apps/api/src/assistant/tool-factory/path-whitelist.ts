/**
 * Allowed API path patterns for assistant tool calls.
 *
 * Lifted verbatim from the v2 controller so the factory enforces the same
 * whitelist that the existing tools rely on. New tools may extend this on a
 * per-tool basis via `additionalAllowedPaths` on `defineTool` config — those
 * are composed at call time without mutating this array.
 *
 * Each pattern matches against the path *without* its query string.
 * Prevents prompt injection from reaching arbitrary internal endpoints.
 */
export const ALLOWED_API_PATHS: readonly RegExp[] = [
  // Videos
  /^videos$/,
  /^videos\/generate-script$/,
  /^videos\/[a-zA-Z0-9_-]+$/,
  /^videos\/[a-zA-Z0-9_-]+\/export$/,
  /^videos\/[a-zA-Z0-9_-]+\/synthesize$/,
  /^videos\/[a-zA-Z0-9_-]+\/job$/,
  /^videos\/[a-zA-Z0-9_-]+\/draft-config$/,
  // Assets
  /^assets$/,
  /^assets\/by-service\/[a-zA-Z0-9_-]+$/,
  // GET assets/:id — hydrates a single library asset (name, type, blob/
  // thumbnail URL, duration). Called by create-draft-video (clip hydration,
  // inside a Promise.allSettled), create-draft-ad and replace-ad-creative
  // (asset-creative preview), AND the no-silent-substitution asset resolver.
  // Its omission silently failed every one of those fetches inside their
  // best-effort try/catch, so clip strips and asset previews came back empty
  // with no error (Phase 7). `by-service/:id` above has a slash so it cannot
  // be matched by this single-segment pattern.
  /^assets\/[a-zA-Z0-9_-]+$/,
  // Organization context
  /^assistant\/context$/,
  /^organization-services$/,
  /^organization-services\/[a-zA-Z0-9_-]+$/,
  // Claire recommendation engine
  /^claire\/ad-creation-context$/,
  // Offers
  /^offers$/,
  /^offers\/[a-zA-Z0-9_-]+$/,
  // Social posts
  /^social-posts$/,
  /^social-posts\/suggest-timing$/,
  /^social-posts\/[a-zA-Z0-9_-]+$/,
  /^social-posts\/[a-zA-Z0-9_-]+\/publish$/,
  // AI content
  /^ai-content\/generate$/,
  // Graphics
  /^graphics$/,
  /^graphics\/[a-zA-Z0-9_-]+$/,
  /^graphics\/[a-zA-Z0-9_-]+\/regenerate$/,
  // Meta integrations
  /^integrations\/meta-ads\/integration$/,
  // Chatbot kill switch (Phase 8, finding #65) — the three per-channel
  // toggle endpoints behind `chatbots_setEnabled`. All three are PUT-only
  // toggles of a single boolean; the destructive-tool confirmation flow
  // gates them before any call is made.
  /^integrations\/instagram\/chatbot$/,
  /^integrations\/meta-ads-pages\/[a-zA-Z0-9_-]+\/chatbot$/,
  /^integrations\/whatsapp\/[a-zA-Z0-9_-]+\/chatbot$/,
  // Meta campaigns
  /^meta-campaigns$/,
  /^meta-campaigns\/[a-zA-Z0-9_-]+$/,
  /^meta-campaigns\/[a-zA-Z0-9_-]+\/insights$/,
  /^meta-campaigns\/[a-zA-Z0-9_-]+\/diagnose$/,
  /^meta-campaigns\/[a-zA-Z0-9_-]+\/learning-status$/,
  /^meta-campaigns\/[a-zA-Z0-9_-]+\/pause$/,
  // Resume sits beside pause deliberately. Whitelisting only the stop half
  // is how Claire ended up able to halt an owner's spend and not restart it.
  /^meta-campaigns\/[a-zA-Z0-9_-]+\/resume$/,
  /^meta-campaigns\/[a-zA-Z0-9_-]+\/resume$/,
  // Meta ads
  /^meta-ads$/,
  /^meta-ads\/campaigns\/[a-zA-Z0-9_-]+$/,
  /^meta-ads\/[a-zA-Z0-9_-]+\/publish$/,
  // Lead forms. These back the `ctx.ports.leadForms` capability
  // (create/update/get in `ports/lead-forms.adapter.ts`), which the
  // createLeadForm/updateLeadForm tools call. Ports are built from the base
  // fetcher and never see a tool's `additionalAllowedPaths`, so — like every
  // other ported capability above — their paths must live on this shared list.
  // Without them, every Claire lead-form create failed the whitelist and
  // surfaced as "This action is not available." (ENG-545).
  /^lead-forms$/,
  /^lead-forms\/[a-zA-Z0-9_-]+$/,
  // Rooms & equipment. These back the `ctx.ports.resources` capability
  // (`ports/resources.adapter.ts`). Listed here for the same reason lead-forms
  // is: ports are built from the BASE fetcher and never see a tool's
  // `additionalAllowedPaths`, so a ported path that lives only on a tool's
  // extension fails the whitelist on every call and surfaces as "This action
  // is not available." (ENG-545). `resources` and `resources/categories` are
  // read+write; the rest are the write surface the port exposes.
  /^resources$/,
  /^resources\/categories$/,
  /^resources\/categories\/[a-zA-Z0-9_-]+$/,
  /^resources\/reorder$/,
  /^resources\/requirements\/[a-zA-Z0-9_-]+$/,
  // Single-segment `:id` LAST, mirroring the controller's own route order —
  // the patterns above have a slash, so this cannot shadow them.
  /^resources\/[a-zA-Z0-9_-]+$/,
];

/**
 * Returns true if `path` matches at least one whitelist pattern. Strips the
 * query string before matching so the patterns don't have to anticipate
 * `?foo=bar` suffixes.
 *
 * Pass `additionalAllowedPaths` to extend the whitelist for a specific call
 * (e.g. a tool that needs a path the main list doesn't cover). Extensions are
 * not mutated into the shared array — the factory composes per-tool.
 */
export function isPathAllowed(
  path: string,
  additionalAllowedPaths?: readonly RegExp[]
): boolean {
  const pathOnly = path.split('?')[0];
  if (ALLOWED_API_PATHS.some((pattern) => pattern.test(pathOnly))) return true;
  if (additionalAllowedPaths?.some((pattern) => pattern.test(pathOnly))) {
    return true;
  }
  return false;
}
