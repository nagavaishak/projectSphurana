import {
  type IntakeFormField,
  db,
  form,
  formSubmission,
  organization,
} from '@borradh-workspace/database';
import { hashIntakeToken } from '@borradh-workspace/features/intake-forms';
import { eq } from 'drizzle-orm';
import request from 'supertest';
/**
 * Fresha domain — intake forms public fill-in (asserted over HTTP against a real DB).
 *
 * The patient-facing surface: a bearer token in the URL renders a form and
 * accepts answers, no account. Proven end to end, read back from SQL:
 *
 *   a. RENDER — GET returns the SNAPSHOT questions (what the patient was sent),
 *      not the live form.
 *   b. SUBMIT persists — a valid submit flips status→completed and stores the
 *      answers; verified from the row, not the 201.
 *   c. REQUIRED gate — a submit missing a required answer is a 400 and writes
 *      nothing (the form stays pending).
 *   d. CROSS-ORG — a token minted for org A is invisible under org B's slug.
 *
 * The submission carries its own tokenHash, so we seed one directly (the same
 * shape issueIntakeSubmission writes) rather than driving the dashboard issue
 * flow.
 */
import { PublicIntakeController } from '../intake-forms/public-intake.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedLead,
  seedOrgWithMember,
} from './harness.js';

const OK = 200;
const BAD_REQUEST = 400;
const NOT_FOUND = 404;

const FIELDS: IntakeFormField[] = [
  { id: 'name', type: 'short_text', label: 'Your name', required: true },
  {
    id: 'consent',
    type: 'checkbox',
    label: 'I consent to treatment',
    required: true,
  },
  { id: 'notes', type: 'long_text', label: 'Anything else?' },
];

async function seedSubmission(
  rawToken: string,
  options?: { status?: 'pending' | 'completed' }
) {
  const owner = await seedOrgWithMember('owner');
  const organizationId = owner.organizationId;
  const [org] = await db
    .select({ slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, organizationId));

  const [template] = await db
    .insert(form)
    .values({
      organizationId,
      kind: 'intake',
      name: 'Medical history',
      fields: FIELDS,
    })
    .returning({ id: form.id });

  const leadId = await seedLead({ organizationId });

  const [sub] = await db
    .insert(formSubmission)
    .values({
      organizationId,
      formId: template.id,
      kind: 'intake',
      leadId,
      status: options?.status ?? 'pending',
      tokenHash: hashIntakeToken(rawToken),
      fieldsSnapshot: FIELDS,
      answers: {},
      sentAt: new Date(),
    })
    .returning({ id: formSubmission.id });

  return { organizationId, slug: org.slug, submissionId: sub.id };
}

const statusOf = async (id: string) => {
  const [row] = await db
    .select({
      status: formSubmission.status,
      answers: formSubmission.answers,
    })
    .from(formSubmission)
    .where(eq(formSubmission.id, id));
  return row;
};

describe('Fresha domain — intake forms (public, HTTP)', () => {
  let h: IntegrationApp | undefined;

  const buildApp = () =>
    buildControllerApp(PublicIntakeController, {
      userId: 'anonymous',
      organizationId: 'none',
      role: 'owner',
    });

  afterEach(async () => {
    await h?.close();
    h = undefined;
  });

  it('renders the snapshot questions for a valid token', async () => {
    const token = 'intake-token-render';
    const seeded = await seedSubmission(token);
    h = await buildApp();

    const res = await request(h.app.getHttpServer())
      .get(`/public/intake/${seeded.slug}/${token}`)
      .expect(OK);

    expect(res.body.fields).toHaveLength(3);
    expect(res.body.fields.map((f: IntakeFormField) => f.id)).toEqual([
      'name',
      'consent',
      'notes',
    ]);
    expect(res.body.status).toBe('pending');
  });

  it('persists a valid submission and flips status to completed', async () => {
    const token = 'intake-token-submit';
    const seeded = await seedSubmission(token);
    h = await buildApp();

    await request(h.app.getHttpServer())
      .post(`/public/intake/${seeded.slug}/${token}/submit`)
      .send({ answers: { name: 'Sarah', consent: true, notes: 'None' } })
      .expect((r) => {
        if (r.status !== OK && r.status !== 201) {
          throw new Error(
            `expected 200/201, got ${r.status}: ${JSON.stringify(r.body)}`
          );
        }
      });

    const row = await statusOf(seeded.submissionId);
    expect(row.status).toBe('completed');
    expect((row.answers as Record<string, unknown>).name).toBe('Sarah');
    expect((row.answers as Record<string, unknown>).consent).toBe(true);
  });

  it('rejects a submit that omits a required answer, writing nothing', async () => {
    const token = 'intake-token-required';
    const seeded = await seedSubmission(token);
    h = await buildApp();

    await request(h.app.getHttpServer())
      .post(`/public/intake/${seeded.slug}/${token}/submit`)
      .send({ answers: { name: 'Sarah' } }) // missing required consent
      .expect(BAD_REQUEST);

    const row = await statusOf(seeded.submissionId);
    expect(row.status).toBe('pending'); // untouched
  });

  it("is invisible under another org's slug (cross-org)", async () => {
    const token = 'intake-token-crossorg';
    const orgA = await seedSubmission(token);
    const orgB = await seedSubmission('other-token');
    h = await buildApp();

    await request(h.app.getHttpServer())
      .get(`/public/intake/${orgB.slug}/${token}`)
      .expect(NOT_FOUND);

    // And A's submission is untouched.
    const row = await statusOf(orgA.submissionId);
    expect(row.status).toBe('pending');
  });
});
