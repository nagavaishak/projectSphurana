'use client';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  useGetIntakeSubmission,
  useSubmitIntakeForm,
} from '@/features/intake-forms/api';
import type {
  IntakeAnswer,
  IntakeFormField,
} from '@/features/intake-forms/api/types';
import { CheckCircle2Icon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { SignaturePad } from './signature-pad';

interface IntakeFillContentProps {
  organizationSlug: string;
  token: string;
}

type AnswerState = Record<string, IntakeAnswer | undefined>;

/** True when an answer counts as "provided" for a required field. */
function isAnswered(field: IntakeFormField, value: IntakeAnswer | undefined) {
  switch (field.type) {
    case 'section':
      return true;
    case 'checkbox':
      return value === true;
    case 'multi_select':
      return Array.isArray(value) && value.length > 0;
    case 'signature':
      return (
        typeof value === 'object' &&
        value !== null &&
        'dataUrl' in value &&
        !!value.dataUrl
      );
    default:
      return typeof value === 'string' && value.trim().length > 0;
  }
}

/**
 * The page a patient lands on from the fill-in link in their email/SMS.
 *
 * Renders the SNAPSHOT questions the API returns (each field type → its input),
 * blocks submit until every required field is answered, and posts the exact
 * answer map. A dead/expired link shows the same calm "no longer valid" screen
 * as manage-booking; a completed form shows a thank-you state.
 */
export function IntakeFillContent({
  organizationSlug,
  token,
}: IntakeFillContentProps) {
  const { view, isLoading, isError } = useGetIntakeSubmission(
    organizationSlug,
    token
  );

  const [answers, setAnswers] = useState<AnswerState>({});
  const [showErrors, setShowErrors] = useState(false);
  const [completed, setCompleted] = useState(false);

  const { submitForm, isSubmitting } = useSubmitIntakeForm(
    organizationSlug,
    token,
    {
      onSuccess: () => setCompleted(true),
    }
  );

  const fields = view?.fields ?? [];

  const missing = useMemo(() => {
    const set = new Set<string>();
    for (const field of fields) {
      if (field.required && !isAnswered(field, answers[field.id])) {
        set.add(field.id);
      }
    }
    return set;
  }, [fields, answers]);

  const setAnswer = (id: string, value: IntakeAnswer | undefined) =>
    setAnswers((prev) => ({ ...prev, [id]: value }));

  const handleSubmit = () => {
    if (missing.size > 0) {
      setShowErrors(true);
      return;
    }
    // Stamp signatures at submit time; drop undefined answers.
    const payload: Record<string, IntakeAnswer> = {};
    for (const field of fields) {
      const value = answers[field.id];
      if (value === undefined) continue;
      payload[field.id] = value;
    }
    submitForm({ answers: payload });
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // A dead link is the steady state for old sends, so this is a normal screen,
  // not an error state.
  if (isError || !view) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Card>
          <CardHeader>
            <CardTitle>This link is no longer valid</CardTitle>
            <CardDescription>
              It may have expired, or the form may already have been completed.
              Please contact the clinic if you need to fill it in.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const alreadyDone = completed || view.status === 'completed';

  if (alreadyDone) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Card>
          <CardHeader className="items-center text-center">
            <CheckCircle2Icon className="size-10 text-green-600 dark:text-green-400" />
            <CardTitle>Thank you</CardTitle>
            <CardDescription>
              Your responses have been sent to {view.organization.name}. You can
              close this page.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="font-bold text-2xl">{view.formName}</h1>
        <p className="text-muted-foreground text-sm">
          {view.organization.name}
        </p>
        {view.formDescription && (
          <p className="text-muted-foreground text-sm">
            {view.formDescription}
          </p>
        )}
      </div>

      <div className="space-y-6">
        {fields.map((field) => (
          <IntakeFieldInput
            key={field.id}
            field={field}
            value={answers[field.id]}
            onChange={(v) => setAnswer(field.id, v)}
            invalid={showErrors && missing.has(field.id)}
          />
        ))}
      </div>

      {showErrors && missing.size > 0 && (
        <p className="text-destructive text-sm">
          Please complete the required fields marked above.
        </p>
      )}

      <Button className="w-full" onClick={handleSubmit} disabled={isSubmitting}>
        {isSubmitting ? 'Submitting…' : 'Submit'}
      </Button>
    </div>
  );
}

interface IntakeFieldInputProps {
  field: IntakeFormField;
  value: IntakeAnswer | undefined;
  onChange: (value: IntakeAnswer | undefined) => void;
  invalid: boolean;
}

function IntakeFieldInput({
  field,
  value,
  onChange,
  invalid,
}: IntakeFieldInputProps) {
  // Section headings are guidance, not inputs.
  if (field.type === 'section') {
    return (
      <div className="space-y-1 border-b pb-2">
        <h2 className="font-semibold text-lg">{field.label}</h2>
        {field.helpText && (
          <p className="text-muted-foreground text-sm">{field.helpText}</p>
        )}
      </div>
    );
  }

  const label = (
    <FieldLabel htmlFor={field.id}>
      {field.label}
      {field.required && <span className="text-destructive"> *</span>}
    </FieldLabel>
  );
  const help = field.helpText ? (
    <FieldDescription>{field.helpText}</FieldDescription>
  ) : null;
  const error = invalid ? (
    <FieldError>This field is required.</FieldError>
  ) : null;

  switch (field.type) {
    case 'short_text':
      return (
        <Field data-invalid={invalid}>
          {label}
          {help}
          <Input
            id={field.id}
            value={typeof value === 'string' ? value : ''}
            aria-invalid={invalid}
            onChange={(e) => onChange(e.target.value)}
          />
          {error}
        </Field>
      );

    case 'long_text':
      return (
        <Field data-invalid={invalid}>
          {label}
          {help}
          <Textarea
            id={field.id}
            value={typeof value === 'string' ? value : ''}
            aria-invalid={invalid}
            onChange={(e) => onChange(e.target.value)}
          />
          {error}
        </Field>
      );

    case 'date':
      return (
        <Field data-invalid={invalid}>
          {label}
          {help}
          <Input
            id={field.id}
            type="date"
            value={typeof value === 'string' ? value : ''}
            aria-invalid={invalid}
            onChange={(e) => onChange(e.target.value)}
          />
          {error}
        </Field>
      );

    case 'dropdown':
      return (
        <Field data-invalid={invalid}>
          {label}
          {help}
          <Select
            value={typeof value === 'string' ? value : undefined}
            onValueChange={(v) => onChange(v)}
          >
            <SelectTrigger id={field.id} aria-invalid={invalid}>
              <SelectValue placeholder="Select an option" />
            </SelectTrigger>
            <SelectContent>
              {(field.options ?? []).map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {error}
        </Field>
      );

    case 'single_select':
      return (
        <Field data-invalid={invalid}>
          {label}
          {help}
          <RadioGroup
            value={typeof value === 'string' ? value : undefined}
            onValueChange={(v) => onChange(v)}
          >
            {(field.options ?? []).map((option) => (
              <div key={option} className="flex items-center gap-2">
                <RadioGroupItem value={option} id={`${field.id}-${option}`} />
                <Label htmlFor={`${field.id}-${option}`}>{option}</Label>
              </div>
            ))}
          </RadioGroup>
          {error}
        </Field>
      );

    case 'multi_select': {
      const selected = Array.isArray(value) ? value : [];
      const toggle = (option: string, checked: boolean) => {
        const next = checked
          ? [...selected, option]
          : selected.filter((o) => o !== option);
        onChange(next);
      };
      return (
        <Field data-invalid={invalid}>
          {label}
          {help}
          <div className="space-y-2">
            {(field.options ?? []).map((option) => (
              <div key={option} className="flex items-center gap-2">
                <Checkbox
                  id={`${field.id}-${option}`}
                  checked={selected.includes(option)}
                  onCheckedChange={(c) => toggle(option, c === true)}
                />
                <Label htmlFor={`${field.id}-${option}`}>{option}</Label>
              </div>
            ))}
          </div>
          {error}
        </Field>
      );
    }

    case 'checkbox':
      return (
        <Field data-invalid={invalid}>
          <div className="flex items-start gap-2">
            <Checkbox
              id={field.id}
              checked={value === true}
              aria-invalid={invalid}
              onCheckedChange={(c) => onChange(c === true)}
            />
            <div className="space-y-1">
              <Label htmlFor={field.id}>
                {field.label}
                {field.required && <span className="text-destructive"> *</span>}
              </Label>
              {field.helpText && (
                <p className="text-muted-foreground text-sm">
                  {field.helpText}
                </p>
              )}
            </div>
          </div>
          {error}
        </Field>
      );

    case 'signature':
      return (
        <Field data-invalid={invalid}>
          {label}
          {help}
          <SignaturePad
            onChange={(dataUrl) =>
              onChange(
                dataUrl
                  ? { dataUrl, signedAt: new Date().toISOString() }
                  : undefined
              )
            }
          />
          {error}
        </Field>
      );

    default:
      return null;
  }
}
