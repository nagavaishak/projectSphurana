import { db, socialPost } from '@borradh-workspace/database';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
/**
 * CHARACTERIZATION — SocialPostsController
 * (apps/api/src/social-posts/social-posts.controller.ts).
 *
 * Companion to `social-posts.int-spec.ts`, which pins the compose/schedule/edit
 * round-trip, list+get org isolation, and the create role/DTO gates. This file
 * deliberately does NOT repeat those; it pins what that file leaves uncovered
 * before the orchestration moves into use cases:
 *
 *   - `publish` (POST :id/publish) — the fattest handler: pre-flight fetch,
 *     two 409 state guards, fire-and-forget background publish, and a SYNTHETIC
 *     response (`{ ...post, status: 'publishing' }`) that is NOT what is stored.
 *   - `resignCdnUrl` / `signPostMedia` — the URL shape returned by the read
 *     routes.
 *   - `delete` and `sync`, and the @RequireRole('admin') boundary on the write
 *     routes.
 *
 * REAL: HTTP pipeline, RoleGuard, feature services, SQL. FAKED: AuthGuard only.
 * Writes are READ BACK FROM POSTGRES.
 *
 * META BOUNDARY (deliberate, not stubbed): publish and sync both need a
 * connected Meta integration. The test orgs have none, so:
 *   - `syncSocialPosts` returns FORBIDDEN before any Graph API call → 403. That
 *     IS the pinned behaviour; the happy sync path is unreachable here.
 *   - `publishSocialPost` is fired WITHOUT await and fails the same way in the
 *     background. Only the SYNCHRONOUS part of the handler is asserted below —
 *     the response and the state guards. The post's eventual stored status is
 *     decided asynchronously and is deliberately NOT asserted (it would race).
 *
 * CDN BOUNDARY: `resignCdnUrl` only rewrites URLs whose origin matches
 * `getCdnUrl()`. The integration env configures no CloudFront key pair, so
 * `isCdnEnabled()` is false and every URL passes through untouched. The
 * assertions below are written to hold in EITHER configuration: they use
 * off-CDN origins (the `parsed.origin !== cdnOrigin` early return) and an
 * unparseable URL (the `catch` early return), which are pass-through in both.
 * The re-signing branch itself cannot be exercised without CloudFront creds.
 */
import { SocialPostsController } from '../social-posts/social-posts.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
} from './harness.js';

const FORBIDDEN = 403;
const NOT_FOUND = 404;
const CONFLICT = 409;

const IMG = 'https://media.example.com/assets/photo.jpg';
const THUMB = 'https://media.example.com/assets/photo-thumb.jpg';

const draftBody = (overrides: Record<string, unknown> = {}) => ({
  title: `Post ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  caption: 'Come see us this summer',
  mediaType: 'image',
  mediaUrl: IMG,
  platforms: ['facebook'],
  ...overrides,
});

const readPost = async (id: string, organizationId: string) =>
  db.query.socialPost.findFirst({
    where: and(
      eq(socialPost.id, id),
      eq(socialPost.organizationId, organizationId)
    ),
  });

describe('CHARACTERIZATION — social-posts controller (publish, media URLs, delete)', () => {
  describe('POST /social-posts/:id/publish — fat handler', () => {
    it('returns the post with a SYNTHETIC status of "publishing" (the stored status is not changed synchronously)', async () => {
      // Protects: the handler's response contract. It spreads the PRE-flight
      // post and overrides `status: 'publishing'` — that value is invented by
      // the controller, not read from the DB, and every other field is the row
      // as it was BEFORE publishing started. A refactor that returns the
      // service's result instead would change what the client sees.
      const admin = await seedOrgWithMember('admin');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(SocialPostsController, {
          userId: admin.userId,
          organizationId: admin.organizationId,
        });
        const server = h.app.getHttpServer();

        const body = draftBody();
        const created = await request(server).post('/social-posts').send(body);
        expect(created.status).toBe(201);
        const id: string = created.body.id;
        expect(created.body.status).toBe('draft');

        const published = await request(server).post(
          `/social-posts/${id}/publish`
        );
        expect(published.status).toBe(201);
        expect(published.body.id).toBe(id);
        expect(published.body.status).toBe('publishing');
        // …the rest of the payload is the pre-flight row, verbatim.
        expect(published.body.title).toBe(body.title);
        expect(published.body.caption).toBe('Come see us this summer');
        expect(published.body.mediaUrl).toBe(IMG);
        expect(published.body.organizationId).toBe(admin.organizationId);

        // NOTE: the DB status after this point is decided by the detached
        // background publish (which fails here — no Meta integration), so it is
        // intentionally not asserted.
      } finally {
        await h?.close();
      }
    });

    it('a post already in status "published" → 409 "Post has already been published"', async () => {
      // Protects: the first state guard, INCLUDING its exact message, and that
      // it rejects BEFORE anything is handed to the publish service.
      const admin = await seedOrgWithMember('admin');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(SocialPostsController, {
          userId: admin.userId,
          organizationId: admin.organizationId,
        });
        const server = h.app.getHttpServer();

        const created = await request(server)
          .post('/social-posts')
          .send(draftBody());
        const id: string = created.body.id;
        await db
          .update(socialPost)
          .set({ status: 'published' })
          .where(eq(socialPost.id, id));

        const res = await request(server).post(`/social-posts/${id}/publish`);
        expect(res.status).toBe(CONFLICT);
        expect(res.body.message).toBe('Post has already been published');

        // untouched
        expect((await readPost(id, admin.organizationId))?.status).toBe(
          'published'
        );
      } finally {
        await h?.close();
      }
    });

    it('a post already in status "publishing" → 409 "Post is currently being published"', async () => {
      // Protects: the second state guard (the double-submit lock) and its message.
      const admin = await seedOrgWithMember('admin');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(SocialPostsController, {
          userId: admin.userId,
          organizationId: admin.organizationId,
        });
        const server = h.app.getHttpServer();

        const created = await request(server)
          .post('/social-posts')
          .send(draftBody());
        const id: string = created.body.id;
        await db
          .update(socialPost)
          .set({ status: 'publishing' })
          .where(eq(socialPost.id, id));

        const res = await request(server).post(`/social-posts/${id}/publish`);
        expect(res.status).toBe(CONFLICT);
        expect(res.body.message).toBe('Post is currently being published');
      } finally {
        await h?.close();
      }
    });

    it("publishing an unknown id → 404, and another org's post → 404", async () => {
      // Protects: the pre-flight getSocialPost is org-scoped, so publish can
      // never be aimed at a post outside the caller's org.
      const orgA = await seedOrgWithMember('admin');
      const orgB = await seedOrgWithMember('admin');

      let hB: IntegrationApp | undefined;
      let hA: IntegrationApp | undefined;
      try {
        hB = await buildControllerApp(SocialPostsController, {
          userId: orgB.userId,
          organizationId: orgB.organizationId,
        });
        const bPost = await request(hB.app.getHttpServer())
          .post('/social-posts')
          .send(draftBody());
        const bId: string = bPost.body.id;

        hA = await buildControllerApp(SocialPostsController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const serverA = hA.app.getHttpServer();

        expect(
          (await request(serverA).post('/social-posts/sp_nope/publish')).status
        ).toBe(NOT_FOUND);
        expect(
          (await request(serverA).post(`/social-posts/${bId}/publish`)).status
        ).toBe(NOT_FOUND);

        // org B's post never entered publishing.
        expect((await readPost(bId, orgB.organizationId))?.status).toBe(
          'draft'
        );
      } finally {
        await hA?.close();
        await hB?.close();
      }
    });

    it('a plain member cannot publish → 403 (@RequireRole admin)', async () => {
      // Protects: the role gate on publish (RoleGuard is real here).
      const orgOwner = await seedOrgWithMember('admin');
      const plain = await seedOrgWithMember('member', {
        organizationId: orgOwner.organizationId,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(SocialPostsController, {
          userId: orgOwner.userId,
          organizationId: orgOwner.organizationId,
        });
        const server = h.app.getHttpServer();
        const created = await request(server)
          .post('/social-posts')
          .send(draftBody());
        const id: string = created.body.id;

        h.actAs({ userId: plain.userId, organizationId: plain.organizationId });
        const res = await request(server).post(`/social-posts/${id}/publish`);
        expect(res.status).toBe(FORBIDDEN);

        // still a draft — the guard ran before the handler.
        expect((await readPost(id, orgOwner.organizationId))?.status).toBe(
          'draft'
        );
      } finally {
        await h?.close();
      }
    });
  });

  describe('media URL signing on read (resignCdnUrl / signPostMedia)', () => {
    it('GET :id returns an off-CDN mediaUrl and thumbnailUrl BYTE-IDENTICAL to what is stored', async () => {
      // Protects: resignCdnUrl's origin check — a URL that is not on our CDN is
      // returned untouched (no query string appended, no re-hosting). This holds
      // whether or not CloudFront is configured, so it is a stable pin.
      const admin = await seedOrgWithMember('admin');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(SocialPostsController, {
          userId: admin.userId,
          organizationId: admin.organizationId,
        });
        const server = h.app.getHttpServer();

        const created = await request(server)
          .post('/social-posts')
          .send(draftBody());
        const id: string = created.body.id;
        await db
          .update(socialPost)
          .set({ thumbnailUrl: THUMB })
          .where(eq(socialPost.id, id));

        const got = await request(server).get(`/social-posts/${id}`);
        expect(got.status).toBe(200);
        expect(got.body.mediaUrl).toBe(IMG);
        expect(got.body.thumbnailUrl).toBe(THUMB);
        // and it really is the stored value, not an echo of the request
        const row = await readPost(id, admin.organizationId);
        expect(got.body.mediaUrl).toBe(row?.mediaUrl);
        expect(got.body.thumbnailUrl).toBe(row?.thumbnailUrl);
      } finally {
        await h?.close();
      }
    });

    it('a null thumbnailUrl stays null; an unparseable mediaUrl is passed through unchanged', async () => {
      // Protects: the two early returns in resignCdnUrl — `!url` and the
      // `catch` around `new URL(url)`. A stored non-URL must NOT crash the read
      // route or be nulled out.
      const admin = await seedOrgWithMember('admin');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(SocialPostsController, {
          userId: admin.userId,
          organizationId: admin.organizationId,
        });
        const server = h.app.getHttpServer();

        const created = await request(server)
          .post('/social-posts')
          .send(draftBody());
        const id: string = created.body.id;
        expect(created.body.thumbnailUrl).toBeNull();

        await db
          .update(socialPost)
          .set({ mediaUrl: 'not-a-url' })
          .where(eq(socialPost.id, id));

        const got = await request(server).get(`/social-posts/${id}`);
        expect(got.status).toBe(200);
        expect(got.body.mediaUrl).toBe('not-a-url');
        expect(got.body.thumbnailUrl).toBeNull();
      } finally {
        await h?.close();
      }
    });

    it('GET / applies the same treatment to every item in the list', async () => {
      // Protects: signPostMedia is mapped over list items, not just applied on
      // the single-get route.
      const admin = await seedOrgWithMember('admin');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(SocialPostsController, {
          userId: admin.userId,
          organizationId: admin.organizationId,
        });
        const server = h.app.getHttpServer();

        const created = await request(server)
          .post('/social-posts')
          .send(draftBody());
        const id: string = created.body.id;
        await db
          .update(socialPost)
          .set({ thumbnailUrl: THUMB })
          .where(eq(socialPost.id, id));

        const list = await request(server).get('/social-posts');
        expect(list.status).toBe(200);
        const item = list.body.items.find((p: { id: string }) => p.id === id);
        expect(item).toBeTruthy();
        expect(item.mediaUrl).toBe(IMG);
        expect(item.thumbnailUrl).toBe(THUMB);
      } finally {
        await h?.close();
      }
    });
  });

  describe('DELETE /social-posts/:id', () => {
    it('an admin delete removes the row from Postgres', async () => {
      // Protects: delete actually deletes (the existing spec stops at update).
      const admin = await seedOrgWithMember('admin');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(SocialPostsController, {
          userId: admin.userId,
          organizationId: admin.organizationId,
        });
        const server = h.app.getHttpServer();

        const created = await request(server)
          .post('/social-posts')
          .send(draftBody());
        const id: string = created.body.id;

        const removed = await request(server).delete(`/social-posts/${id}`);
        expect(removed.status).toBe(200);
        expect(removed.body).toEqual({ success: true });
        expect(await readPost(id, admin.organizationId)).toBeUndefined();
        expect((await request(server).get(`/social-posts/${id}`)).status).toBe(
          NOT_FOUND
        );
      } finally {
        await h?.close();
      }
    });

    it('a plain member cannot delete → 403 and the row survives', async () => {
      // Protects: @RequireRole('admin') on delete, asserted against the DB so a
      // guard regression cannot hide behind a 403-shaped response.
      const orgAdmin = await seedOrgWithMember('admin');
      const plain = await seedOrgWithMember('member', {
        organizationId: orgAdmin.organizationId,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(SocialPostsController, {
          userId: orgAdmin.userId,
          organizationId: orgAdmin.organizationId,
        });
        const server = h.app.getHttpServer();
        const created = await request(server)
          .post('/social-posts')
          .send(draftBody());
        const id: string = created.body.id;

        h.actAs({ userId: plain.userId, organizationId: plain.organizationId });
        expect(
          (await request(server).delete(`/social-posts/${id}`)).status
        ).toBe(FORBIDDEN);
        expect(await readPost(id, orgAdmin.organizationId)).toBeTruthy();
      } finally {
        await h?.close();
      }
    });

    it("deleting another org's post → 404 and the row survives", async () => {
      // Protects: org scoping on the delete service's WHERE clause.
      const orgA = await seedOrgWithMember('admin');
      const orgB = await seedOrgWithMember('admin');

      let hB: IntegrationApp | undefined;
      let hA: IntegrationApp | undefined;
      try {
        hB = await buildControllerApp(SocialPostsController, {
          userId: orgB.userId,
          organizationId: orgB.organizationId,
        });
        const bPost = await request(hB.app.getHttpServer())
          .post('/social-posts')
          .send(draftBody());
        const bId: string = bPost.body.id;

        hA = await buildControllerApp(SocialPostsController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        expect(
          (await request(hA.app.getHttpServer()).delete(`/social-posts/${bId}`))
            .status
        ).toBe(NOT_FOUND);
        expect(await readPost(bId, orgB.organizationId)).toBeTruthy();
      } finally {
        await hA?.close();
        await hB?.close();
      }
    });
  });

  describe('routes that stop at the Meta boundary', () => {
    it('POST /social-posts/sync with no Meta integration → 403 (mapped from FORBIDDEN)', async () => {
      // Protects: the sync handler's error mapping. syncSocialPosts refuses
      // before any Graph API call when the org has no active integration, and
      // the controller surfaces that as 403 — not 500. The successful sync path
      // needs real Meta credentials and is NOT covered here.
      const admin = await seedOrgWithMember('admin');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(SocialPostsController, {
          userId: admin.userId,
          organizationId: admin.organizationId,
        });
        const res = await request(h.app.getHttpServer()).post(
          '/social-posts/sync'
        );
        expect(res.status).toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });

    it('GET /social-posts/suggest-timing falls back to industry defaults with no history', async () => {
      // Protects: the suggest-timing route is reachable (it is declared BEFORE
      // the `:id` route, so it must not be swallowed by it) and returns the
      // no-data fallback shape.
      const admin = await seedOrgWithMember('admin');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(SocialPostsController, {
          userId: admin.userId,
          organizationId: admin.organizationId,
        });
        const res = await request(h.app.getHttpServer()).get(
          '/social-posts/suggest-timing?platform=facebook'
        );
        expect(res.status).toBe(200);
        expect(res.body.dataSource).toBe('industry_defaults');
        expect(res.body.postsAnalyzed).toBe(0);
        expect(res.body.suggestions).toHaveLength(1);
        expect(res.body.suggestions[0].platform).toBe('facebook');
      } finally {
        await h?.close();
      }
    });
  });
});
