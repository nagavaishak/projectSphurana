import { createApiFetch } from './api-fetch.js';

describe('createApiFetch', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('forwards bearer authorization for header-authenticated web sessions', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const apiFetch = createApiFetch({
      authorization: 'Bearer test-session-token',
      port: 3000,
    });

    await apiFetch('organization-services?limit=100');

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:3000/organization-services?limit=100',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer test-session-token',
        }),
      })
    );
  });

  // Regression for ENG-545. The leadForms port is built from the BASE fetcher
  // (no additionalAllowedPaths), so `POST lead-forms` must be reachable purely
  // via the shared whitelist. Before the fix this threw "This action is not
  // available." and every Claire lead-form create failed.
  it('allows the leadForms port to POST lead-forms via the base fetcher', async () => {
    // A fresh Response per call — a body can only be read once.
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ id: 'form_1', status: 'draft' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    // No additionalAllowedPaths — mirrors how ctx.ports is constructed.
    const apiFetch = createApiFetch({ authorization: 'Bearer t', port: 3000 });

    await expect(
      apiFetch('lead-forms', { method: 'POST', body: { name: 'x' } })
    ).resolves.toEqual({ id: 'form_1', status: 'draft' });
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:3000/lead-forms',
      expect.objectContaining({ method: 'POST' })
    );

    // The read-back / update path (lead-forms/:id) must be reachable too.
    await apiFetch('lead-forms/form_1');
    expect(fetchSpy).toHaveBeenLastCalledWith(
      'http://localhost:3000/lead-forms/form_1',
      expect.objectContaining({ method: 'GET' })
    );
  });

  // ── Branch scoping (location redesign §3.3) ──────────────────────────────
  // Claire's tools do not query the database; they call the same HTTP
  // endpoints the app does. So scoping HER is scoping this hop — if the header
  // does not ride along, every tool reads the org-wide catalogue and she quotes
  // the base price to a customer of a branch that charges something else. That
  // failure is silent: the response shape is identical either way.
  //
  // This is the plumbing half of the risk. The behavioural half — whether she
  // ASKS which branch when an org has several — needs the held-out eval, which
  // is not on this branch.

  it('sends the branch as X-Location-Id when a location is in scope', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const apiFetch = createApiFetch({
      authorization: 'Bearer t',
      port: 3000,
      locationId: 'loc_cork',
    });

    await apiFetch('organization-services?limit=100');

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:3000/organization-services?limit=100',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-location-id': 'loc_cork' }),
      })
    );
  });

  it('sends NO location header when no branch is in scope', async () => {
    // Absent must mean org-wide, not "no results" — that is what lets the API
    // ship ahead of a client that does not send the header yet.
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const apiFetch = createApiFetch({ authorization: 'Bearer t', port: 3000 });

    await apiFetch('organization-services?limit=100');

    const headers = fetchSpy.mock.calls[0]?.[1]?.headers as Record<
      string,
      string
    >;
    expect(headers).not.toHaveProperty('x-location-id');
  });

  it('carries the branch on the WhatsApp worker path too', async () => {
    // The worker authenticates with acts-as headers rather than a cookie, and
    // those are built in a separate branch of the same function — so the
    // location has to be attached AFTER that fork, not inside one arm of it.
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const apiFetch = createApiFetch({
      internalAuth: {
        token: 'secret',
        userId: 'user_1',
        organizationId: 'org_1',
      },
      port: 3000,
      locationId: 'loc_cork',
    });

    await apiFetch('organization-services?limit=100');

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-acts-as-user-id': 'user_1',
          'x-location-id': 'loc_cork',
        }),
      })
    );
  });
});
