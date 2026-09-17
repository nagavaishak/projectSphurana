import {
  consentFormSubmission,
  consentFormTemplate,
  lead,
  organization,
  organizationServiceFormRequirement,
  withSystemScope,
} from '@borradh-workspace/database';
import { ConsentFormRequestEmail, sendEmail } from '@borradh-workspace/email';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, inArray } from 'drizzle-orm';
import { buildPortalHomeUrl } from '../../../patient-auth/index.js';
import {
  buildPortalAccessUrl,
  mintMagicLink,
} from '../../../patient-auth/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
  resolveMicrositeLinkTarget,
} from '../../../shared/index.js';
import {
  type CreateSubmissionsForAppointmentInput,
  createSubmissionsForAppointmentSchema,
} from './create-submissions-for-appointment.schema.js';

export interface CreateSubmissionsForAppointmentData {
  created: number;
  submissionIds: string[];
}

const createSubmissionsForAppointmentImpl = async (
  db: DbConnection,
  input: CreateSubmissionsForAppointmentInput
): Promise<Result<CreateSubmissionsForAppointmentData>> => {
  const parsed = createSubmissionsForAppointmentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { appointmentId, leadId, organizationId, serviceId } = parsed.data;

  try {
    const requirements =
      await db.query.organizationServiceFormRequirement.findMany({
        where: eq(organizationServiceFormRequirement.serviceId, serviceId),
      });

    // No requirements configured for this service — nothing to send. Silent ok.
    if (requirements.length === 0) {
      return ok({ created: 0, submissionIds: [] });
    }

    const templates = await db.query.consentFormTemplate.findMany({
      where: and(
        inArray(
          consentFormTemplate.id,
          requirements.map((row) => row.templateId)
        ),
        eq(consentFormTemplate.organizationId, organizationId),
        eq(consentFormTemplate.isActive, true)
      ),
    });

    if (templates.length === 0) {
      return ok({ created: 0, submissionIds: [] });
    }

    const sentAt = new Date();
    const rows = await db
      .insert(consentFormSubmission)
      .values(
        templates.map((template) => ({
          organizationId,
          appointmentId,
          leadId,
          templateId: template.id,
          // Freeze the template at send time — a later edit must not change
          // what this patient is asked to sign.
          templateSnapshot: {
            title: template.title,
            body: template.body,
            fields: template.fields,
            requiresSignature: template.requiresSignature,
          },
          sentAt,
        }))
      )
      // Idempotent against the `uq_consent_form_submission_appointment_template`
      // constraint: a re-run (booking retry, redelivered webhook, resend action)
      // creates nothing new and, because `rows` then comes back short or empty,
      // emails only about the forms it actually created.
      .onConflictDoNothing({
        target: [
          consentFormSubmission.appointmentId,
          consentFormSubmission.templateId,
        ],
      })
      .returning();

    // Nothing new was created (every form already existed for this
    // appointment) — do not re-email the patient about forms they were already
    // asked to sign.
    if (rows.length === 0) {
      return ok({ created: 0, submissionIds: [] });
    }

    // One email listing the forms we actually created (if the lead has an
    // email address). Titles come from each row's frozen snapshot, so the mail
    // matches exactly what the patient will be shown.
    const createdTitles = rows.map((row) => row.templateSnapshot.title);

    const leadRecord = await db.query.lead.findFirst({
      where: eq(lead.id, leadId),
    });
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, organizationId),
    });

    if (leadRecord?.email && org) {
      // The CTA is a one-tap magic sign-in link ("Open portal →") — the email
      // itself is the proof of address ownership, same trust model as the OTP
      // mail. If minting fails for any reason the email still goes out with
      // the plain portal home (the patient signs in with a code instead).
      // One host lookup, reused by both the fallback home link and the magic
      // link — a clinic on a live custom domain must not see its patients sent
      // to our domain for either.
      const linkTarget = await resolveMicrositeLinkTarget(db, {
        id: organizationId,
        slug: org.slug,
      });
      let portalUrl = buildPortalHomeUrl(linkTarget);
      const link = await mintMagicLink(db, { leadId, organizationId });
      if (link.success) {
        portalUrl = buildPortalAccessUrl(linkTarget, link.data.token);
      } else {
        logError(
          'consentForms.createSubmissionsForAppointment.magicLink',
          link.error,
          { feature: 'consent-forms', extra: { appointmentId, organizationId } }
        );
      }

      sendEmail({
        to: leadRecord.email,
        subject: `Please complete your consent ${
          createdTitles.length === 1 ? 'form' : 'forms'
        } for ${org.name}`,
        template: ConsentFormRequestEmail,
        props: {
          patientName: leadRecord.firstName,
          clinicName: org.name,
          formTitles: createdTitles,
          pendingFormCount: createdTitles.length,
          portalUrl,
        },
      }).catch((error) =>
        logError('consentForms.createSubmissionsForAppointment.email', error, {
          feature: 'consent-forms',
          extra: { appointmentId, organizationId },
        })
      );
    }

    return ok({
      created: rows.length,
      submissionIds: rows.map((row) => row.id),
    });
  } catch (error) {
    logError('consentForms.createSubmissionsForAppointment', error, {
      feature: 'consent-forms',
      extra: { appointmentId, leadId, organizationId, serviceId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to create consent form submissions'
      )
    );
  }
};

/**
 * System-facing (post-booking hook): create one pending submission per ACTIVE
 * required template for the booked service, snapshotting each template, then
 * send ONE "please complete before your appointment" email to the lead.
 *
 * Runs under `withSystemScope`: the booking flow has no staff session (it runs
 * on the public path), and `app_patient` holds no DML — submissions are minted
 * by the system, exactly like the patient-auth token writes.
 */
export const createSubmissionsForAppointment = (
  db: DbConnection,
  input: CreateSubmissionsForAppointmentInput
) =>
  trackedResult(
    'consentForms.createSubmissionsForAppointment',
    () =>
      withSystemScope((tx) => createSubmissionsForAppointmentImpl(tx, input), {
        db,
      }),
    {
      properties: {
        appointmentId: input.appointmentId,
        organizationId: input.organizationId,
      },
    }
  );

export type CreateSubmissionsForAppointmentResult = Awaited<
  ReturnType<typeof createSubmissionsForAppointment>
>;
