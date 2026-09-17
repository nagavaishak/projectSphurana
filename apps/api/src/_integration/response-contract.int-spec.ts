/**
 * Provider-side response-contract validation (asserted over HTTP against a real
 * DB + the real Nest pipeline).
 *
 * Proves the `@ResponseContract(schema)` + `ResponseContractInterceptor`
 * mechanism end to end — the backend twin of the frontend's `parseResponse`:
 *
 *   a. REAL RESPONSE PARSES CLEAN (report) — GET /leads on the real
 *      LeadsController, annotated with `@ResponseContract(listLeadsResponseSchema)`,
 *      returns 200 and its body validates against the contract. This is the
 *      proof the annotated controller genuinely matches its contract on real
 *      serialized data (Dates → ISO strings) — no mismatch, so nothing logged.
 *   b. MISMATCH IS NON-FATAL + UNSTRIPPED (report) — a probe route whose handler
 *      returns a shape that does NOT satisfy its `@ResponseContract` schema still
 *      returns 200 with the body byte-for-byte unchanged (extra fields kept, not
 *      zod-stripped). The report-mode `logError` path runs (and must not throw).
 *   c. MISMATCH THROWS (strict) — the same probe route, with the
 *      `response-parse-strict` flag ON (injected via `withFlags`), fails the
 *      request (500) instead of passing through.
 *
 * NOTE: the report-mode `logError('api.responseContract', ...)` call fires on
 * mismatch (case b) but is not asserted — the observability named export is a
 * non-configurable SWC-compiled binding that `jest.spyOn` cannot redefine. The
 * 200-vs-500 split (report vs strict) is the deterministic proof the mismatch
 * is detected and routed by mode.
 *
 * The interceptor is registered here exactly as production registers it — an
 * `APP_INTERCEPTOR` provider — with `Reflector` (provided by the harness) and an
 * injected flag provider that pins report vs strict deterministically.
 */
import { randomUUID } from 'node:crypto';
import { listLeadsResponseSchema } from '@borradh-workspace/contracts';
import { asset, assetService, db } from '@borradh-workspace/database';
import { withFlags } from '@borradh-workspace/observability';
import { Controller, Get } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import request from 'supertest';
import { AppointmentsController } from '../appointments/appointments.controller.js';
import { AssetsController } from '../assets/assets.controller.js';
import {
  RESPONSE_CONTRACT_FLAG_PROVIDER,
  ResponseContract,
  ResponseContractInterceptor,
} from '../common/index.js';
import { LeadsController } from '../leads/leads.controller.js';
import { OffersController } from '../offers/offers.controller.js';
import { OrganizationServicesController } from '../organization-services/organization-services.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedAppointment,
  seedLead,
  seedOffer,
  seedOrgWithMember,
  seedService,
} from './harness.js';

/**
 * A throwaway controller whose handler deliberately returns a shape that does
 * NOT satisfy `listLeadsResponseSchema` (items must be an array, total a
 * number). `extra` is a field the schema doesn't model — used to prove report
 * mode passes the value through UNSTRIPPED.
 */
@Controller('contract-probe')
class ContractProbeController {
  @Get('bad')
  @ResponseContract(listLeadsResponseSchema)
  bad() {
    return { items: 'not-an-array', total: 'nope', extra: 'kept' };
  }
}

/** Register the interceptor as production does, with a pinned flag provider. */
function interceptorProviders(strict: boolean) {
  return [
    { provide: APP_INTERCEPTOR, useClass: ResponseContractInterceptor },
    {
      provide: RESPONSE_CONTRACT_FLAG_PROVIDER,
      useValue: withFlags(strict ? { 'response-parse-strict': true } : {}),
    },
  ];
}

describe('Response-contract interceptor (HTTP)', () => {
  describe('real response parses clean (report)', () => {
    it('GET /leads returns 200 and its body validates against the contract', async () => {
      const owner = await seedOrgWithMember('owner');
      await seedLead({
        organizationId: owner.organizationId,
        firstName: 'Ada',
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(
          LeadsController,
          { userId: owner.userId, organizationId: owner.organizationId },
          interceptorProviders(false)
        );

        const res = await request(h.app.getHttpServer())
          .get('/leads')
          .expect(200);

        // The real, serialized body (Dates → ISO strings) validates against the
        // contract the frontend also parses — the annotation genuinely holds.
        expect(listLeadsResponseSchema.safeParse(res.body).success).toBe(true);
        expect(res.body.items.length).toBeGreaterThanOrEqual(1);
      } finally {
        await h?.close();
      }
    });
  });

  /* ------------------------------------------------------------------ */
  /* STRICT-MODE PROOF for the newly annotated read routes.              */
  /*                                                                     */
  /* Report mode is non-breaking by design: a mismatch is logged and the  */
  /* body passes through. That makes wiring cheap — and makes "wired"     */
  /* worth nothing on its own, because a schema that CANNOT parse its own */
  /* endpoint looks identical to one that can. Three shipped schemas are  */
  /* exactly that (listVideos needs 26 columns off a 15-column SELECT;    */
  /* listAds needs 12 the SELECT omits; listAssetsByService needs an      */
  /* `uploader` join never made) — which is why those routes are          */
  /* deliberately NOT annotated.                                          */
  /*                                                                     */
  /* So each route proven here runs with the strict flag ON against real  */
  /* seeded rows: a projection that does not satisfy its contract FAILS   */
  /* the request, and therefore fails this suite.                         */
  /*                                                                     */
  /* NON-EMPTY DATA IS THE POINT. `{ items: [] }` parses against almost   */
  /* any list schema — including all three broken ones — so an empty-case */
  /* assertion would prove nothing.                                       */
  /* ------------------------------------------------------------------ */
  describe('newly annotated read routes parse under STRICT mode', () => {
    it('GET /appointments and /appointments/:id', async () => {
      const owner = await seedOrgWithMember('owner');
      const apptId = await seedAppointment({
        organizationId: owner.organizationId,
        assignedToId: owner.userId,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(
          AppointmentsController,
          { userId: owner.userId, organizationId: owner.organizationId },
          interceptorProviders(true)
        );
        const server = h.app.getHttpServer();

        const list = await request(server).get('/appointments').expect(200);
        expect(list.body.items.length).toBeGreaterThanOrEqual(1);

        await request(server).get(`/appointments/${apptId}`).expect(200);
      } finally {
        await h?.close();
      }
    });

    it('GET /organization-services and /organization-services/:id', async () => {
      const owner = await seedOrgWithMember('owner');
      const svcId = await seedService({ organizationId: owner.organizationId });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(
          OrganizationServicesController,
          { userId: owner.userId, organizationId: owner.organizationId },
          interceptorProviders(true)
        );
        const server = h.app.getHttpServer();

        const list = await request(server)
          .get('/organization-services')
          .expect(200);
        expect(list.body.items.length).toBeGreaterThanOrEqual(1);

        await request(server)
          .get(`/organization-services/${svcId}`)
          .expect(200);
      } finally {
        await h?.close();
      }
    });

    it('GET /assets/by-service/:id — the schema that could not parse its own endpoint', async () => {
      // REGRESSION PROOF. `listAssetsByServiceResponseSchema` used to type its
      // items as `assetSchema`, which REQUIRES `uploader` — `.nullable()` but
      // not `.optional()`, so an absent key fails. The service does
      // `select({ asset, confidence }).innerJoin(...)` then
      // `rows.map(r => r.asset)`: a full asset row with no `user` join
      // anywhere. So the contract could not parse a single non-empty response,
      // and nothing noticed because the frontend hook declares its own local
      // interface and passes no schema — the contract had ZERO consumers.
      //
      // Non-empty is the whole point: `{ items: [] }` parsed fine before the
      // fix, which is exactly how this survived.
      const owner = await seedOrgWithMember('owner');
      const svcId = await seedService({ organizationId: owner.organizationId });
      const assetId = `ast_${randomUUID()}`;
      await db.insert(asset).values({
        id: assetId,
        name: 'Linked image',
        blobUrl: 'https://example.com/a.jpg',
        type: 'image',
        // NOT 'stock' — the service filters those out (ne(asset.source,'stock')).
        source: 'raw',
        organizationId: owner.organizationId,
        uploadedById: owner.userId,
      });
      await db
        .insert(assetService)
        .values({ assetId, serviceId: svcId, confidence: 1 });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(
          AssetsController,
          { userId: owner.userId, organizationId: owner.organizationId },
          interceptorProviders(true)
        );

        const res = await request(h.app.getHttpServer())
          .get(`/assets/by-service/${svcId}?type=image`)
          .expect(200);

        expect(res.body.items).toHaveLength(1);
        expect(res.body.items[0].id).toBe(assetId);
      } finally {
        await h?.close();
      }
    });

    it('GET /offers and /offers/:id', async () => {
      const owner = await seedOrgWithMember('owner');
      const offerId = await seedOffer({ organizationId: owner.organizationId });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(
          OffersController,
          { userId: owner.userId, organizationId: owner.organizationId },
          interceptorProviders(true)
        );
        const server = h.app.getHttpServer();

        const list = await request(server).get('/offers').expect(200);
        expect(list.body.items.length).toBeGreaterThanOrEqual(1);

        await request(server).get(`/offers/${offerId}`).expect(200);
      } finally {
        await h?.close();
      }
    });
  });

  describe('mismatch is non-fatal and unstripped (report)', () => {
    it('returns 200 with the body unchanged', async () => {
      const owner = await seedOrgWithMember('owner');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(
          ContractProbeController,
          { userId: owner.userId, organizationId: owner.organizationId },
          interceptorProviders(false)
        );

        const res = await request(h.app.getHttpServer())
          .get('/contract-probe/bad')
          .expect(200);

        // Body passed through verbatim — the unmodelled `extra` key survives
        // (report must NOT silently strip to the parsed shape). The report-mode
        // logError path ran without throwing to get here.
        expect(res.body).toEqual({
          items: 'not-an-array',
          total: 'nope',
          extra: 'kept',
        });
      } finally {
        await h?.close();
      }
    });
  });

  describe('mismatch throws (strict)', () => {
    it('fails the request (500) when response-parse-strict is on', async () => {
      const owner = await seedOrgWithMember('owner');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(
          ContractProbeController,
          { userId: owner.userId, organizationId: owner.organizationId },
          interceptorProviders(true)
        );

        await request(h.app.getHttpServer())
          .get('/contract-probe/bad')
          .expect(500);
      } finally {
        await h?.close();
      }
    });
  });
});
