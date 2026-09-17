import request from 'supertest';
/**
 * Fresha domain — social posts (OUR-SIDE behaviour, asserted over HTTP against a
 * real DB).
 *
 * Exercises the real Nest HTTP pipeline + real social-post feature services +
 * real SQL, with only the AuthGuard faked (identity stamped by the harness).
 * SocialPostsController carries @UseGuards(AuthGuard, RoleGuard); the write
 * routes (create/update/delete) declare @RequireRole('admin'), the read routes
 * (list/get) only need membership.
 *
 * SCOPE: only the routes that touch OUR database are exercised. The
 * publish (POST :id/publish) and sync (POST /sync) routes reach out to
 * Facebook/Instagram Graph API and are deliberately NOT driven here.
 *
 * Five facets are proven end to end:
 *   a. HAPPY ROUND-TRIP (compose a draft) — an admin composes a post with no
 *      `scheduledAt`; `createSocialPost` persists it with status 'draft'
 *      (derived: no scheduledAt + no explicit status → 'draft'), it appears in
 *      the list, and is readable by id. Create returns the row directly (201);
 *      `listSocialPosts` returns `{ items, total, limit, offset }`.
 *   b. SCHEDULE — composing WITH a `scheduledAt` derives status 'scheduled' and
 *      persists the timestamp; and updating an existing draft to set
 *      `scheduledAt` flips it to 'scheduled' and persists (PUT :id).
 *   c. UPDATE — an admin edits the caption/title of a draft and it reads back.
 *   d. ORG ISOLATION — the list run as an org-A member returns only org-A posts;
 *      a cross-org GET and a cross-org PUT of an org-B post id → 404 (the get /
 *      update services WHERE on `id AND organizationId`).
 *   e. ROLE + DTO VALIDATION — a plain member composing → 403 (@RequireRole
 *      'admin'); an admin composing with an empty body → 400 (title, mediaType,
 *      mediaUrl and platforms/pageIds are all required).
 *
 * The create/update DTOs require `platforms` OR `pageIds`; passing an explicit
 * `platforms: ['facebook']` keeps the whole flow inside our DB (the `pageIds`
 * branch would look up metaAdsPage rows).
 */
import { SocialPostsController } from '../social-posts/social-posts.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
} from './harness.js';

const IMG = 'https://example.com/media/photo.jpg';

const draftBody = (overrides: Record<string, unknown> = {}) => ({
  title: `Post ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  caption: 'Come see us this summer',
  mediaType: 'image',
  mediaUrl: IMG,
  platforms: ['facebook'],
  ...overrides,
});

describe('Fresha domain — social posts (HTTP, our-side only)', () => {
  describe('happy round-trip — compose a draft (admin)', () => {
    it('create draft → list includes it → get reads it back', async () => {
      const admin = await seedOrgWithMember('admin');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(SocialPostsController, {
          userId: admin.userId,
          organizationId: admin.organizationId,
        });
        const server = h.app.getHttpServer();

        const body = draftBody();
        const create = await request(server).post('/social-posts').send(body);
        expect(create.status).toBe(201);
        const postId: string = create.body.id;
        expect(postId).toBeTruthy();
        expect(create.body.title).toBe(body.title);
        expect(create.body.organizationId).toBe(admin.organizationId);
        expect(create.body.createdById).toBe(admin.userId);
        // No scheduledAt supplied → derived status 'draft', scheduledAt null.
        expect(create.body.status).toBe('draft');
        expect(create.body.scheduledAt).toBeNull();
        expect(create.body.platforms).toEqual(['facebook']);

        // list (returns { items, total, limit, offset }) includes it
        const list = await request(server).get('/social-posts');
        expect(list.status).toBe(200);
        expect(Array.isArray(list.body.items)).toBe(true);
        const ids = list.body.items.map((p: { id: string }) => p.id);
        expect(ids).toContain(postId);

        // get reads the persisted row back
        const get = await request(server).get(`/social-posts/${postId}`);
        expect(get.status).toBe(200);
        expect(get.body.id).toBe(postId);
        expect(get.body.title).toBe(body.title);
        expect(get.body.status).toBe('draft');
      } finally {
        await h?.close();
      }
    });
  });

  describe('schedule (persist scheduledAt)', () => {
    it('composing WITH scheduledAt → status scheduled + timestamp persisted', async () => {
      const admin = await seedOrgWithMember('admin');
      const when = new Date(Date.now() + 24 * 60 * 60 * 1000);

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(SocialPostsController, {
          userId: admin.userId,
          organizationId: admin.organizationId,
        });
        const server = h.app.getHttpServer();

        const create = await request(server)
          .post('/social-posts')
          .send(draftBody({ scheduledAt: when.toISOString() }));
        expect(create.status).toBe(201);
        expect(create.body.status).toBe('scheduled');
        const postId: string = create.body.id;

        // Read back over HTTP — timestamp round-trips as an ISO string.
        const get = await request(server).get(`/social-posts/${postId}`);
        expect(get.status).toBe(200);
        expect(get.body.status).toBe('scheduled');
        expect(new Date(get.body.scheduledAt).getTime()).toBe(when.getTime());
      } finally {
        await h?.close();
      }
    });

    it('updating a draft to set scheduledAt → flips to scheduled and persists (PUT)', async () => {
      const admin = await seedOrgWithMember('admin');
      const when = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(SocialPostsController, {
          userId: admin.userId,
          organizationId: admin.organizationId,
        });
        const server = h.app.getHttpServer();

        const create = await request(server)
          .post('/social-posts')
          .send(draftBody());
        expect(create.status).toBe(201);
        expect(create.body.status).toBe('draft');
        const postId: string = create.body.id;

        const update = await request(server)
          .put(`/social-posts/${postId}`)
          .send({ scheduledAt: when.toISOString() });
        expect(update.status).toBe(200);
        expect(update.body.status).toBe('scheduled');

        const get = await request(server).get(`/social-posts/${postId}`);
        expect(get.status).toBe(200);
        expect(get.body.status).toBe('scheduled');
        expect(new Date(get.body.scheduledAt).getTime()).toBe(when.getTime());
      } finally {
        await h?.close();
      }
    });
  });

  describe('update (edit a draft)', () => {
    it('admin edits title + caption → reads back', async () => {
      const admin = await seedOrgWithMember('admin');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(SocialPostsController, {
          userId: admin.userId,
          organizationId: admin.organizationId,
        });
        const server = h.app.getHttpServer();

        const create = await request(server)
          .post('/social-posts')
          .send(draftBody());
        expect(create.status).toBe(201);
        const postId: string = create.body.id;

        const newTitle = `Edited ${Date.now()}`;
        const update = await request(server)
          .put(`/social-posts/${postId}`)
          .send({ title: newTitle, caption: 'Updated copy' });
        expect(update.status).toBe(200);
        expect(update.body.title).toBe(newTitle);
        expect(update.body.caption).toBe('Updated copy');

        const get = await request(server).get(`/social-posts/${postId}`);
        expect(get.body.title).toBe(newTitle);
        expect(get.body.caption).toBe('Updated copy');
      } finally {
        await h?.close();
      }
    });
  });

  describe('org isolation', () => {
    it('list returns only org-A posts; cross-org GET and PUT of an org-B post → 404', async () => {
      const orgA = await seedOrgWithMember('admin');
      const orgB = await seedOrgWithMember('admin');

      let hA: IntegrationApp | undefined;
      let hB: IntegrationApp | undefined;
      try {
        hA = await buildControllerApp(SocialPostsController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const serverA = hA.app.getHttpServer();
        const aPost = await request(serverA)
          .post('/social-posts')
          .send(draftBody());
        expect(aPost.status).toBe(201);
        const aId: string = aPost.body.id;

        hB = await buildControllerApp(SocialPostsController, {
          userId: orgB.userId,
          organizationId: orgB.organizationId,
        });
        const bPost = await request(hB.app.getHttpServer())
          .post('/social-posts')
          .send(draftBody());
        expect(bPost.status).toBe(201);
        const bId: string = bPost.body.id;

        // org A's list contains its own post and NOT org B's.
        const list = await request(serverA).get('/social-posts');
        expect(list.status).toBe(200);
        const ids = list.body.items.map((p: { id: string }) => p.id);
        expect(ids).toContain(aId);
        expect(ids).not.toContain(bId);

        // org A cannot read org B's post by id → 404 (get service WHERE
        // `id AND organizationId`).
        const crossGet = await request(serverA).get(`/social-posts/${bId}`);
        expect(crossGet.status).toBe(404);

        // org A cannot mutate org B's post → 404 (update service WHERE
        // `id AND organizationId`).
        const crossPut = await request(serverA)
          .put(`/social-posts/${bId}`)
          .send({ caption: 'hijack attempt' });
        expect(crossPut.status).toBe(404);

        // sanity: org A's own post IS reachable + mutable.
        const ownGet = await request(serverA).get(`/social-posts/${aId}`);
        expect(ownGet.status).toBe(200);
      } finally {
        await hA?.close();
        await hB?.close();
      }
    });
  });

  describe('role + DTO validation', () => {
    it('a plain member composing → 403 (@RequireRole admin)', async () => {
      const member = await seedOrgWithMember('member');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(SocialPostsController, {
          userId: member.userId,
          organizationId: member.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/social-posts')
          .send(draftBody());
        expect(res.status).toBe(403);
      } finally {
        await h?.close();
      }
    });

    it('an admin composing with an empty body → 400', async () => {
      const admin = await seedOrgWithMember('admin');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(SocialPostsController, {
          userId: admin.userId,
          organizationId: admin.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/social-posts')
          .send({});
        expect(res.status).toBe(400);
      } finally {
        await h?.close();
      }
    });
  });
});
