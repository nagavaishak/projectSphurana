'use client';

import {
  CheckCircle2,
  DownloadIcon,
  FileSignatureIcon,
  FileWarningIcon,
} from 'lucide-react';
import type * as React from 'react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';

import { useDownloadFormPdf } from '../api/download-consent-form-pdf.hook';
import { useGetConsentForm } from '../api/get-consent-form.hook';
import { getErrorStatus } from '../api/paths';
import { PortalProvider, usePortalLink } from '../api/portal-provider';
import { useSignConsentForm } from '../api/sign-consent-form.hook';
import type { CurrentPatient, PatientConsentForm } from '../api/types';
import { PortalAuthGate } from '../portal-auth-gate';
import type { PortalContext } from '../portal-context';
import { Checkbox } from '../ui/checkbox';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '../ui/empty';
import { SignaturePad } from '../ui/signature-pad';

function patientDisplayName(patient: CurrentPatient): string {
  return (
    [patient.firstName, patient.lastName].filter(Boolean).join(' ') ||
    patient.email
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

const LoadingSkeleton = (
  <div className="flex flex-col gap-6">
    <div className="flex items-center gap-3">
      <Skeleton className="size-12 rounded-xl" />
      <Skeleton className="h-8 w-48" />
    </div>
    <Skeleton className="h-40 w-full rounded-xl" />
    <Skeleton className="h-24 w-full rounded-xl" />
    <Skeleton className="h-10 w-full rounded-lg" />
  </div>
);

/** Icon-tile + title header, shared by the sign and completed views. */
function FormTitleHeader({ title }: { title: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="bg-muted flex size-12 shrink-0 items-center justify-center rounded-xl">
        <FileSignatureIcon
          className="text-muted-foreground size-6"
          aria-hidden
        />
      </div>
      <h1 className="pt-1 text-2xl font-bold tracking-tight">{title}</h1>
    </div>
  );
}

/** The consent copy, with {{patientName}} substituted, in a readable card. */
function FormBodyCard({
  consentForm,
  patient,
}: {
  consentForm: PatientConsentForm;
  patient: CurrentPatient;
}) {
  const body = consentForm.templateSnapshot.body.replaceAll(
    '{{patientName}}',
    patientDisplayName(patient)
  );

  return (
    <Card>
      <CardContent className="px-6">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{body}</p>
      </CardContent>
    </Card>
  );
}

function CompletedFormView({
  consentForm,
  patient,
}: {
  consentForm: PatientConsentForm;
  patient: CurrentPatient;
}) {
  const { fields } = consentForm.templateSnapshot;
  const { downloadPdf, isDownloading, downloadError } = useDownloadFormPdf(
    consentForm.id
  );
  const link = usePortalLink();

  return (
    <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div
        role="status"
        className="flex items-center gap-3 rounded-xl border border-green-600/30 bg-green-600/10 px-4 py-3.5"
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300">
          <CheckCircle2 className="size-5" aria-hidden />
        </div>
        <p className="text-sm font-medium">
          {consentForm.signedByName
            ? `Signed by ${consentForm.signedByName}${consentForm.signedAt ? ` on ${formatDate(consentForm.signedAt)}` : ''}`
            : 'This form has been completed.'}
        </p>
      </div>

      <FormTitleHeader title={consentForm.templateSnapshot.title} />
      <FormBodyCard consentForm={consentForm} patient={patient} />

      {fields.length > 0 ? (
        <Card>
          <CardContent className="px-6">
            <dl className="flex flex-col divide-y">
              {fields.map((field) => {
                const value = consentForm.fieldData[field.label];
                return (
                  <div
                    key={field.label}
                    className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0"
                  >
                    <dt className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                      {field.label}
                    </dt>
                    <dd className="text-sm">
                      {field.type === 'checkbox'
                        ? value === true
                          ? 'Yes'
                          : 'No'
                        : typeof value === 'string' && value !== ''
                          ? field.type === 'date'
                            ? formatDate(value)
                            : value
                          : '—'}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" asChild>
          <a href={link()}>Back to your portal</a>
        </Button>
        <Button
          variant="outline"
          onClick={downloadPdf}
          disabled={isDownloading}
        >
          <DownloadIcon aria-hidden />
          {isDownloading ? 'Preparing…' : 'Download PDF'}
        </Button>
        {downloadError && (
          <p role="alert" className="text-destructive text-sm">
            Couldn't prepare the PDF — please try again.
          </p>
        )}
      </div>
    </div>
  );
}

function signErrorMessage(error: Error | null): string | null {
  if (!error) return null;
  const status = getErrorStatus(error);
  if (status === 409) return 'This form has already been signed.';
  if (status === 400) {
    return 'Please confirm you have read and agree to the form before signing.';
  }
  return error.message || 'Something went wrong. Please try again.';
}

function SignFormView({
  submissionId,
  consentForm,
  patient,
  refetch,
}: {
  submissionId: string;
  consentForm: PatientConsentForm;
  patient: CurrentPatient;
  refetch: () => void;
}) {
  const { fields, requiresSignature } = consentForm.templateSnapshot;
  const link = usePortalLink();

  // Field answers keyed by field label (matches `fieldData` on the read side).
  const [fieldValues, setFieldValues] = useState<
    Record<string, string | boolean>
  >(() => ({ ...consentForm.fieldData }));
  const [attested, setAttested] = useState(false);
  const [signedByName, setSignedByName] = useState('');
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);

  const { signConsentForm, isSigning, isSigned, error } =
    useSignConsentForm(submissionId);

  if (isSigned) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center animate-in fade-in duration-500">
        <div className="flex size-14 items-center justify-center rounded-full bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300">
          <CheckCircle2 className="size-7" aria-hidden />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          Signed — thank you
        </h1>
        <p className="text-muted-foreground text-sm text-balance">
          Your clinic has been notified. You're all set for your appointment.
        </p>
        <Button asChild>
          <a href={link()}>Back to your portal</a>
        </Button>
      </div>
    );
  }

  const setValue = (label: string, value: string | boolean) =>
    setFieldValues((current) => ({ ...current, [label]: value }));

  const hasName = signedByName.trim().length > 0;
  const canSubmit = requiresSignature
    ? attested && hasName && signatureDataUrl !== null
    : true;

  // Explain exactly what is still missing while the button is disabled.
  const missing: string[] = [];
  if (requiresSignature) {
    if (!attested) missing.push('tick the confirmation box');
    if (!hasName) missing.push('type your full name');
    if (!signatureDataUrl) missing.push('draw your signature');
  }
  const missingHint =
    missing.length > 0
      ? `To sign, ${missing.join(missing.length > 2 ? ', ' : ' and ').replace(/, ([^,]*)$/, ' and $1')}.`
      : null;

  const rootError = signErrorMessage(error);
  const isConflict = getErrorStatus(error) === 409;

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || isSigning) return;
    signConsentForm({
      fieldData: fieldValues,
      // When no signature is required, record who submitted anyway.
      signedByName: requiresSignature
        ? signedByName.trim()
        : patientDisplayName(patient),
      attested: true,
      ...(requiresSignature && signatureDataUrl
        ? { signatureImageDataUrl: signatureDataUrl }
        : {}),
    });
  };

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-2 duration-500"
    >
      <FormTitleHeader title={consentForm.templateSnapshot.title} />
      <FormBodyCard consentForm={consentForm} patient={patient} />

      {fields.length > 0 ? (
        <div className="flex flex-col gap-4">
          {fields.map((field, index) => {
            const id = `consent-field-${index}`;
            if (field.type === 'checkbox') {
              return (
                <div key={field.label} className="flex items-center gap-2">
                  <Checkbox
                    id={id}
                    checked={fieldValues[field.label] === true}
                    onCheckedChange={(checked) =>
                      setValue(field.label, checked)
                    }
                  />
                  <label htmlFor={id} className="text-sm">
                    {field.label}
                  </label>
                </div>
              );
            }
            return (
              <Field key={field.label} className="gap-2">
                <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
                <Input
                  id={id}
                  type={field.type === 'date' ? 'date' : 'text'}
                  value={
                    typeof fieldValues[field.label] === 'string'
                      ? (fieldValues[field.label] as string)
                      : ''
                  }
                  onChange={(event) =>
                    setValue(field.label, event.target.value)
                  }
                />
              </Field>
            );
          })}
        </div>
      ) : null}

      {requiresSignature ? (
        <div className="flex flex-col gap-4 rounded-xl border bg-muted/40 p-4">
          <div className="flex items-start gap-2">
            <Checkbox
              id="consent-attestation"
              checked={attested}
              onCheckedChange={setAttested}
              aria-describedby="consent-attestation-hint"
            />
            <label
              htmlFor="consent-attestation"
              className="text-sm font-medium"
            >
              I have read and agree to the above
            </label>
          </div>
          <Separator />
          <Field className="gap-2">
            <FieldLabel htmlFor="consent-signed-by-name">
              Type your full name to sign
            </FieldLabel>
            <Input
              id="consent-signed-by-name"
              value={signedByName}
              onChange={(event) => setSignedByName(event.target.value)}
              placeholder={patientDisplayName(patient)}
              autoComplete="name"
            />
            <p
              id="consent-attestation-hint"
              className="text-muted-foreground text-xs"
            >
              Typing your name here acts as your signature.
            </p>
          </Field>
          <Field className="gap-2">
            <FieldLabel id="consent-signature-label">
              Draw or type your signature
            </FieldLabel>
            <SignaturePad
              aria-describedby="consent-signature-label"
              onChange={setSignatureDataUrl}
              typedValue={signedByName}
            />
          </Field>
        </div>
      ) : null}

      {/* Reserved space so an inline error doesn't shift the layout */}
      <div className="min-h-5" aria-live="polite">
        {rootError && (
          <p role="alert" className="text-destructive text-sm">
            {rootError}{' '}
            {isConflict && (
              <button
                type="button"
                className="underline underline-offset-4"
                onClick={refetch}
              >
                View the signed form
              </button>
            )}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Button type="submit" disabled={!canSubmit || isSigning}>
          {isSigning
            ? 'Submitting…'
            : requiresSignature
              ? 'Sign and submit'
              : 'Submit'}
        </Button>
        {missingHint && (
          <p className="text-muted-foreground text-center text-xs">
            {missingHint}
          </p>
        )}
      </div>
    </form>
  );
}

function ConsentFormContent({
  submissionId,
  patient,
}: {
  submissionId: string;
  patient: CurrentPatient;
}) {
  const { consentForm, isLoading, isError, error, refetch } =
    useGetConsentForm(submissionId);
  const link = usePortalLink();

  if (isLoading) return LoadingSkeleton;

  if (isError || !consentForm) {
    const isNotFound = getErrorStatus(error) === 404;
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia>
            <FileWarningIcon />
          </EmptyMedia>
          <EmptyTitle>
            {isNotFound ? 'Form not found' : 'Something went wrong'}
          </EmptyTitle>
          <EmptyDescription>
            {isNotFound
              ? "We couldn't find this form. It may have been removed."
              : 'Something went wrong loading your form.'}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          {isNotFound ? (
            <Button variant="outline" asChild>
              <a href={link()}>Back to your portal</a>
            </Button>
          ) : (
            <Button variant="outline" onClick={() => refetch()}>
              Try again
            </Button>
          )}
        </EmptyContent>
      </Empty>
    );
  }

  if (consentForm.status === 'completed') {
    return <CompletedFormView consentForm={consentForm} patient={patient} />;
  }

  return (
    <SignFormView
      submissionId={submissionId}
      consentForm={consentForm}
      patient={patient}
      // The 409 "already signed" path: the freshest truth is the completed
      // submission, so re-reading swaps this view for the completed one.
      refetch={() => void refetch()}
    />
  );
}

export function PortalConsentFormIsland({
  ctx,
  submissionId,
}: {
  ctx: PortalContext;
  submissionId: string;
}) {
  return (
    <PortalProvider ctx={ctx}>
      <PortalAuthGate
        skeleton={LoadingSkeleton}
        errorIcon={<FileWarningIcon />}
        errorTitle="Something went wrong"
        errorDescription="We couldn't load your form. Please try again."
      >
        {(patient) => (
          <ConsentFormContent submissionId={submissionId} patient={patient} />
        )}
      </PortalAuthGate>
    </PortalProvider>
  );
}
