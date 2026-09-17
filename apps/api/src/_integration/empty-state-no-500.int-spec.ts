import request from 'supertest';
/**
 * Batch — empty-state crash sweep (asserted over HTTP against a real DB).
 *
 * The single highest-volume *functional* escape class in the issue review
 * (release-safety-strategy.md, Pillar 2): a list endpoint that 500s on an org
 * with NO data. The failure mode is an empty-array / null-deref inside the list
 * service — e.g. BOR-70 (`inArray([])` builds invalid SQL), ENG-380/339
 * (`undefined.length`). A fresh org exercises exactly that path: every child
 * table is empty, so any service that derives an `IN (...)` filter or maps over
 * a "first row" without guarding will throw.
 *
 * This is the integration mirror of the E2E dashboard sweep
 * (apps/app-e2e/src/dashboard/empty-state-sweep.spec.ts): this proves the API
 * never 500s on empty data; the E2E proves the UI renders the empty state. The
 * bug class lives in fast, deterministic SQL — so the *gate* lives here, not in
 * Playwright (the pyramid principle).
 *
 * Each endpoint is a param-free member-open list GET. We assert:
 *   - status < 500 (the actual contract: empty data must never crash), AND
 *   - status === 200 (these are unconditional list reads — a 4xx would mean a
 *     required query param, which would be a separate, surprising regression).
 */
import { AppointmentsController } from '../appointments/appointments.controller.js';
import { ConversationsController } from '../conversations/conversations.controller.js';
import { LeadsController } from '../leads/leads.controller.js';
import { OffersController } from '../offers/offers.controller.js';
import { OrganizationServicesController } from '../organization-services/organization-services.controller.js';
import { ServiceCategoriesController } from '../service-categories/service-categories.controller.js';
import { SocialPostsController } from '../social-posts/social-posts.controller.js';
import { VideosController } from '../videos/videos.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
} from './harness.js';

/**
 * Each entry is a constructor-free controller whose `@Get()` list endpoint is a
 * pure DB read (no required query params, no external service on the empty
 * path). Role is the lowest that can list, so RoleGuard is exercised too.
 */
const LIST_ENDPOINTS: Array<{
  // biome-ignore lint/suspicious/noExplicitAny: controllers vary by type
  controller: any;
  path: string;
  role: 'member' | 'admin' | 'owner';
}> = [
  { controller: LeadsController, path: '/leads', role: 'member' },
  { controller: OffersController, path: '/offers', role: 'member' },
  {
    controller: OrganizationServicesController,
    path: '/organization-services',
    role: 'member',
  },
  {
    controller: ServiceCategoriesController,
    path: '/service-categories',
    role: 'member',
  },
  { controller: SocialPostsController, path: '/social-posts', role: 'member' },
  {
    controller: ConversationsController,
    path: '/conversations',
    role: 'member',
  },
  { controller: VideosController, path: '/videos', role: 'member' },
  {
    controller: AppointmentsController,
    path: '/appointments',
    role: 'owner',
  },
];

describe('Batch — empty-state list endpoints never 500', () => {
  for (const { controller, path, role } of LIST_ENDPOINTS) {
    it(`GET ${path} on a no-data org returns 200, not 500`, async () => {
      // A brand-new org with one member and ZERO domain rows in every table.
      const org = await seedOrgWithMember(role);

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(controller, {
          userId: org.userId,
          organizationId: org.organizationId,
        });
        const res = await request(h.app.getHttpServer()).get(path);

        // The bug class: empty data → 500. This is the gated assertion.
        expect(res.status).toBeLessThan(500);
        // These are unconditional list reads; a non-200 would be a surprise.
        expect(res.status).toBe(200);
      } finally {
        await h?.close();
      }
    });
  }
});
