import { isPathAllowed } from './path-whitelist.js';

describe('isPathAllowed', () => {
  it('allows whitelisted paths', () => {
    expect(isPathAllowed('videos')).toBe(true);
    expect(isPathAllowed('assistant/context')).toBe(true);
    expect(isPathAllowed('organization-services/abc-123')).toBe(true);
    expect(isPathAllowed('meta-campaigns/abc/insights')).toBe(true);
  });

  // Regression: the leadForms port (ports/lead-forms.adapter.ts) calls these
  // paths via the base fetcher, which honours only this shared whitelist — not
  // a tool's additionalAllowedPaths. When they were missing, every Claire
  // lead-form create failed with "This action is not available." (ENG-545).
  it('allows the lead-forms capability paths', () => {
    expect(isPathAllowed('lead-forms')).toBe(true); // POST create
    expect(isPathAllowed('lead-forms/abc-123')).toBe(true); // GET/PUT :id
    expect(isPathAllowed('lead-forms?limit=50')).toBe(true); // query stripped
  });

  // Regression (Phase 7): create-draft-video hydrates its clip strip from
  // `GET assets/:id` inside a Promise.allSettled, and create-draft-ad /
  // replace-ad-creative resolve an asset-creative preview the same way. When
  // `assets/:id` was absent from the whitelist every one of those fetches
  // failed silently — the clip strip and asset preview came back empty with
  // no surfaced error. `by-service/:id` (a two-segment path) stays distinct.
  it('allows the single-asset hydration path assets/:id', () => {
    expect(isPathAllowed('assets/abc-123')).toBe(true);
    expect(isPathAllowed('assets/clr8f9k2h0000')).toBe(true);
    expect(isPathAllowed('assets/abc-123?urlFormat=blob')).toBe(true);
    // by-service still resolves via its own two-segment pattern.
    expect(isPathAllowed('assets/by-service/svc-1')).toBe(true);
  });

  // Whitelisted ⊇ called: every assets path a Claire tool actually fetches
  // must be reachable. If a tool starts calling a new assets sub-path, add it
  // here and to the whitelist together.
  it('covers every assets path Claire tools call', () => {
    const calledAssetPaths = [
      'assets', // list-library-images, asset-ref search (query stripped)
      'assets/by-service/svc-1', // list-library-images (service filter)
      'assets/asset-id-1', // create-draft-video / -ad / replace-creative
    ];
    for (const path of calledAssetPaths) {
      expect(isPathAllowed(path)).toBe(true);
    }
  });

  it('rejects non-whitelisted paths', () => {
    expect(isPathAllowed('admin/secrets')).toBe(false);
    expect(isPathAllowed('foo/bar')).toBe(false);
    expect(isPathAllowed('users')).toBe(false);
  });

  it('strips query strings before matching', () => {
    expect(isPathAllowed('videos?status=ready')).toBe(true);
    expect(isPathAllowed('offers?isActive=true&limit=50')).toBe(true);
  });

  it('rejects path-traversal-style payloads', () => {
    expect(isPathAllowed('videos/../admin')).toBe(false);
    expect(isPathAllowed('../etc/passwd')).toBe(false);
  });

  it('honours additionalAllowedPaths extension', () => {
    expect(isPathAllowed('custom-endpoint', [/^custom-endpoint$/])).toBe(true);
    expect(isPathAllowed('custom-endpoint')).toBe(false);
  });
});
