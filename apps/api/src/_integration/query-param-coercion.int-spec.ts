import request from 'supertest';
/**
 * Query-string coercion at the VALIDATION BOUNDARY.
 *
 * `main.ts` registers nestjs-zod's `ZodValidationPipe` globally. A whole-object
 * `@Query() dto: XDto` binding is therefore parsed by the DTO's zod schema
 * BEFORE the handler runs — and every query value arriving off the wire is a
 * STRING. A schema field declared `z.number()` or `z.boolean()` rather than
 * `z.coerce.number()` / a string-aware preprocess is a hard 400 in production
 * the moment anyone passes that parameter.
 *
 * This suite exists because that class of defect was INVISIBLE here. The
 * integration harness used to register only the stock class-validator
 * `ValidationPipe`, which finds no constraint metadata on a `createZodDto` and
 * so validates nothing: the raw string fell through to the service, whose own
 * `safeParse` re-parsed it, and every spec passed while production 400'd. Two
 * live bugs were sitting behind that gap:
 *
 *   GET /intake-forms?includeInactive=true      `z.boolean()`
 *   GET /assistant/usage/history?days=7         `z.number()` x2
 *
 * Both are fixed; both are asserted below. The point of this file is the
 * PROPERTY, not those two routes — any new whole-object `@Query()` DTO whose
 * schema forgets coercion belongs here.
 *
 * On booleans specifically: `z.coerce.boolean()` is NOT the fix. It is
 * JavaScript truthiness, so the string "false" coerces to TRUE. The codebase's
 * established pattern (`list-services.schema.ts`) is a `z.preprocess` that maps
 * the two literal strings, and the `?includeInactive=false` case below is what
 * stops someone "simplifying" it to `z.coerce`.
 */
import { AssistantController } from '../assistant/assistant.controller.js';
import { IntakeFormsController } from '../intake-forms/intake-forms.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
} from './harness.js';

const OK = 200;

describe('query-param coercion at the validation boundary', () => {
  describe('GET /intake-forms — boolean query param', () => {
    it.each([['true'], ['false']])(
      'accepts ?includeInactive=%s (a STRING) rather than 400ing',
      async (value) => {
        const owner = await seedOrgWithMember('owner');

        let h: IntegrationApp | undefined;
        try {
          h = await buildControllerApp(IntakeFormsController, {
            userId: owner.userId,
            organizationId: owner.organizationId,
          });

          await request(h.app.getHttpServer())
            .get(`/intake-forms?includeInactive=${value}`)
            .expect(OK);
        } finally {
          await h?.close();
        }
      }
    );

    it('still works with the parameter omitted (the only path that ever worked)', async () => {
      const owner = await seedOrgWithMember('owner');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(IntakeFormsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });

        await request(h.app.getHttpServer()).get('/intake-forms').expect(OK);
      } finally {
        await h?.close();
      }
    });
  });

  describe('GET /assistant/usage/history — numeric query params', () => {
    it('accepts ?days=7&monthlyMonths=3 (STRINGS) rather than 400ing', async () => {
      const owner = await seedOrgWithMember('owner');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(AssistantController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });

        await request(h.app.getHttpServer())
          .get('/assistant/usage/history?days=7&monthlyMonths=3')
          .expect(OK);
      } finally {
        await h?.close();
      }
    });

    it('still rejects a value outside the schema bound (coercion is not laxity)', async () => {
      // `days` is `.max(90)`. Coercing the string must not stop the bound from
      // being enforced — otherwise the "fix" traded a false 400 for a missing
      // one.
      const owner = await seedOrgWithMember('owner');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(AssistantController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });

        const res = await request(h.app.getHttpServer()).get(
          '/assistant/usage/history?days=9999'
        );
        expect(res.status).toBe(400);
      } finally {
        await h?.close();
      }
    });
  });
});
