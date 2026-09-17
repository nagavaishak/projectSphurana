import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  GripVertical,
  Instagram,
  Loader2,
  MessageCircle,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import {
  type CreateLeadFormInput,
  type LeadFormFieldType,
  type LeadFormFollowUpChannel,
  type LeadFormQuestion,
  defaultLeadFormQuestions,
  leadFormFieldTypeLabels,
  leadFormFieldTypeValues,
} from '../api/types';

// ============================================================================
// Builder value + helpers
// ============================================================================

/** A single answer choice on a multiple-choice CUSTOM question */
export interface BuilderQuestionOption {
  value: string;
  key?: string;
}

/** A single editable field row (client-side, carries a stable id) */
export interface BuilderQuestion {
  id: string;
  type: LeadFormFieldType;
  label?: string;
  key?: string;
  /** Present on multiple-choice CUSTOM questions */
  options?: BuilderQuestionOption[];
}

/** The full editable state of a lead form */
export interface LeadFormBuilderValue {
  name: string;
  privacyPolicyUrl: string;
  questions: BuilderQuestion[];
  thankYouTitle: string;
  thankYouBody: string;
  followUpChannel: LeadFormFollowUpChannel;
  whatsappNumber: string;
}

const generateId = () => Math.random().toString(36).substring(2, 9);

/** Default state for a brand-new form */
export function emptyLeadFormBuilderValue(): LeadFormBuilderValue {
  return {
    name: '',
    privacyPolicyUrl: '',
    questions: defaultLeadFormQuestions.map((q) => ({
      id: generateId(),
      type: q.type,
      label: q.label,
      key: q.key,
      options: q.options ? q.options.map((o) => ({ ...o })) : undefined,
    })),
    thankYouTitle: 'Thank you!',
    thankYouBody: "We've received your information and will be in touch soon.",
    followUpChannel: 'none',
    whatsappNumber: '',
  };
}

/** Hydrate builder state from an existing form's API shape */
export function leadFormToBuilderValue(form: {
  name: string;
  privacyPolicyUrl: string;
  questions: LeadFormQuestion[];
  thankYouTitle?: string | null;
  thankYouBody?: string | null;
  followUpChannel?: LeadFormFollowUpChannel | null;
  whatsappNumber?: string | null;
}): LeadFormBuilderValue {
  return {
    name: form.name,
    privacyPolicyUrl: form.privacyPolicyUrl,
    questions: (form.questions ?? []).map((q) => ({
      id: generateId(),
      type: q.type,
      label: q.label,
      key: q.key,
      options: q.options ? q.options.map((o) => ({ ...o })) : undefined,
    })),
    thankYouTitle: form.thankYouTitle ?? '',
    thankYouBody: form.thankYouBody ?? '',
    followUpChannel: form.followUpChannel ?? 'none',
    whatsappNumber: form.whatsappNumber ?? '',
  };
}

/** Map builder state to the API question shape (label only on CUSTOM) */
function toApiQuestions(questions: BuilderQuestion[]): LeadFormQuestion[] {
  return questions.map((q) => {
    if (q.type === 'CUSTOM') {
      const label = q.label?.trim() || undefined;
      // Only keep non-empty options; a CUSTOM question with options renders
      // as a multiple-choice question on Meta's instant form.
      const options = q.options
        ?.map((o) => ({
          value: o.value.trim(),
          key:
            o.key?.trim() || o.value.trim().toLowerCase().replace(/\s+/g, '_'),
        }))
        .filter((o) => o.value);
      return {
        type: 'CUSTOM',
        label,
        key: q.key?.trim() || label?.toLowerCase().replace(/\s+/g, '_'),
        options: options && options.length > 0 ? options : undefined,
        required: true,
      };
    }
    // Standard fields: never send a label (Meta rejects it).
    return { type: q.type, required: true };
  });
}

/**
 * Convert builder state to the create/update payload fields shared by both
 * dialogs. Caller adds `id`, `syncToMeta`, etc. as needed.
 */
export function leadFormBuilderToInput(
  value: LeadFormBuilderValue
): Pick<
  CreateLeadFormInput,
  | 'name'
  | 'questions'
  | 'privacyPolicyUrl'
  | 'thankYouTitle'
  | 'thankYouBody'
  | 'followUpChannel'
  | 'whatsappNumber'
> {
  return {
    name: value.name.trim(),
    questions: toApiQuestions(value.questions),
    // Blank → undefined so the server falls back to the org website / FB page
    // (an empty string would fail the URL check).
    privacyPolicyUrl: value.privacyPolicyUrl.trim() || undefined,
    thankYouTitle: value.thankYouTitle.trim() || undefined,
    thankYouBody: value.thankYouBody.trim() || undefined,
    followUpChannel: value.followUpChannel,
    whatsappNumber:
      value.followUpChannel === 'whatsapp'
        ? value.whatsappNumber.trim() || null
        : null,
  };
}

export type LeadFormBuilderErrors = Record<string, string>;

// ============================================================================
// Steps
// ============================================================================

const STEPS = [
  { key: 'fields', title: 'Fields' },
  { key: 'nurturing', title: 'Lead nurturing' },
  { key: 'finish', title: 'Privacy & thanks' },
] as const;

/** Validate a single step; returns a map of field → message (empty = valid) */
function validateStep(
  value: LeadFormBuilderValue,
  step: number
): LeadFormBuilderErrors {
  const errors: LeadFormBuilderErrors = {};

  if (step === 0) {
    if (!value.name.trim()) {
      errors.name = 'Form name is required';
    }
    if (value.questions.length === 0) {
      errors.questions = 'Add at least one field';
    }
    for (const q of value.questions) {
      if (q.type === 'CUSTOM' && !q.label?.trim()) {
        errors[`question_${q.id}`] = 'Custom questions need a label';
      } else if (
        q.type === 'CUSTOM' &&
        q.options &&
        q.options.filter((o) => o.value.trim()).length < 2
      ) {
        errors[`question_${q.id}`] =
          'Multiple-choice questions need at least 2 answer options';
      }
    }
  }

  if (step === 1) {
    if (value.followUpChannel === 'whatsapp' && !value.whatsappNumber.trim()) {
      errors.whatsappNumber = 'Enter the WhatsApp business number';
    }
  }

  if (step === 2) {
    // Optional: if left blank we fall back to the org's website / Facebook Page
    // server-side (Meta still gets a URL). Only validate when one is entered.
    if (value.privacyPolicyUrl.trim()) {
      try {
        new URL(value.privacyPolicyUrl);
      } catch {
        errors.privacyPolicyUrl = 'Please enter a valid URL';
      }
    }
  }

  return errors;
}

/** Validate the whole form; returns the first failing step (or -1) + errors */
export function validateLeadFormBuilder(value: LeadFormBuilderValue): {
  firstInvalidStep: number;
  errors: LeadFormBuilderErrors;
} {
  for (let step = 0; step < STEPS.length; step++) {
    const errors = validateStep(value, step);
    if (Object.keys(errors).length > 0) {
      return { firstInvalidStep: step, errors };
    }
  }
  return { firstInvalidStep: -1, errors: {} };
}

// ============================================================================
// Component
// ============================================================================

interface LeadFormBuilderProps {
  value: LeadFormBuilderValue;
  onChange: (value: LeadFormBuilderValue) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
  isSubmitting?: boolean;
  /** WhatsApp connection state — gates the WhatsApp nurturing channel */
  whatsapp?: { connected: boolean; number?: string | null };
}

export function LeadFormBuilder({
  value,
  onChange,
  onSubmit,
  onCancel,
  submitLabel,
  isSubmitting,
  whatsapp,
}: LeadFormBuilderProps) {
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<LeadFormBuilderErrors>({});

  const isLastStep = step === STEPS.length - 1;

  const goNext = () => {
    const stepErrors = validateStep(value, step);
    setErrors(stepErrors);
    if (Object.keys(stepErrors).length > 0) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const goBack = () => {
    setErrors({});
    setStep((s) => Math.max(s - 1, 0));
  };

  const handleSubmit = () => {
    const { firstInvalidStep, errors: allErrors } =
      validateLeadFormBuilder(value);
    if (firstInvalidStep !== -1) {
      setStep(firstInvalidStep);
      setErrors(validateStep(value, firstInvalidStep));
      return;
    }
    setErrors(allErrors);
    onSubmit();
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Stepper current={step} />

      <div className="min-h-[18rem]">
        {step === 0 && (
          <FieldsStep value={value} onChange={onChange} errors={errors} />
        )}
        {step === 1 && (
          <LeadNurturingSection
            channel={value.followUpChannel}
            whatsappNumber={value.whatsappNumber}
            whatsappError={errors.whatsappNumber}
            whatsappConnected={whatsapp?.connected ?? false}
            connectedWhatsappNumber={whatsapp?.number ?? undefined}
            onChannelChange={(followUpChannel) =>
              onChange({ ...value, followUpChannel })
            }
            onWhatsappNumberChange={(whatsappNumber) =>
              onChange({ ...value, whatsappNumber })
            }
          />
        )}
        {step === 2 && (
          <FinishStep value={value} onChange={onChange} errors={errors} />
        )}
      </div>

      {/* Footer navigation */}
      <div className="flex items-center justify-between gap-2 border-t pt-4">
        {step === 0 ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        ) : (
          <Button type="button" variant="outline" onClick={goBack}>
            <ArrowLeft className="size-4" />
            Back
          </Button>
        )}

        {isLastStep ? (
          <Button type="button" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="size-4 animate-spin" />}
            {submitLabel}
          </Button>
        ) : (
          <Button type="button" onClick={goNext}>
            Next
            <ArrowRight className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Stepper header
// ============================================================================

function Stepper({ current }: { current: number }) {
  return (
    <div className="flex items-center">
      {STEPS.map((s, i) => {
        const isDone = i < current;
        const isActive = i === current;
        return (
          <div key={s.key} className="flex flex-1 items-center last:flex-none">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium',
                  isActive &&
                    'border-primary bg-primary text-primary-foreground',
                  isDone && 'border-primary bg-primary/10 text-primary',
                  !isActive && !isDone && 'border-input text-muted-foreground'
                )}
              >
                {isDone ? <CheckCircle2 className="size-4" /> : i + 1}
              </span>
              <span
                className={cn(
                  'hidden text-sm sm:inline',
                  isActive ? 'font-medium' : 'text-muted-foreground'
                )}
              >
                {s.title}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={cn(
                  'mx-3 h-px flex-1',
                  isDone ? 'bg-primary' : 'bg-border'
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Step 1 — Fields
// ============================================================================

interface FieldsStepProps {
  value: LeadFormBuilderValue;
  onChange: (value: LeadFormBuilderValue) => void;
  errors: LeadFormBuilderErrors;
}

export function FieldsStep({ value, onChange, errors }: FieldsStepProps) {
  // Which field row is expanded for inline editing. New rows open immediately.
  const [editingId, setEditingId] = useState<string | null>(null);

  const patch = (updates: Partial<LeadFormBuilderValue>) =>
    onChange({ ...value, ...updates });

  const addQuestion = () => {
    const id = generateId();
    patch({
      questions: [...value.questions, { id, type: 'CUSTOM', label: '' }],
    });
    setEditingId(id);
  };

  const removeQuestion = (id: string) => {
    patch({ questions: value.questions.filter((q) => q.id !== id) });
    if (editingId === id) setEditingId(null);
  };

  const updateQuestion = (id: string, updates: Partial<BuilderQuestion>) => {
    patch({
      questions: value.questions.map((q) =>
        q.id === id ? { ...q, ...updates } : q
      ),
    });
  };

  const addOption = (q: BuilderQuestion) =>
    updateQuestion(q.id, { options: [...(q.options ?? []), { value: '' }] });

  const updateOption = (q: BuilderQuestion, index: number, val: string) =>
    updateQuestion(q.id, {
      options: (q.options ?? []).map((o, i) =>
        i === index ? { ...o, value: val } : o
      ),
    });

  const removeOption = (q: BuilderQuestion, index: number) => {
    const next = (q.options ?? []).filter((_, i) => i !== index);
    updateQuestion(q.id, { options: next.length > 0 ? next : undefined });
  };

  const fieldDisplayName = (q: BuilderQuestion) =>
    q.type === 'CUSTOM'
      ? q.label?.trim() || 'Custom question'
      : leadFormFieldTypeLabels[q.type];

  return (
    <div className="flex flex-col gap-6">
      {/* Form name */}
      <Field data-invalid={!!errors.name}>
        <FieldLabel htmlFor="lf-name">Form name</FieldLabel>
        <FieldDescription>
          Internal name for your reference (not shown to people)
        </FieldDescription>
        <Input
          id="lf-name"
          value={value.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="e.g., Appointment Booking"
          aria-invalid={!!errors.name}
        />
        {errors.name && <FieldError errors={[{ message: errors.name }]} />}
      </Field>

      {/* Fields editor */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <FieldLabel>Fields</FieldLabel>
            <FieldDescription>
              The information people fill out on your form
            </FieldDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addQuestion}
          >
            <Plus className="size-4" />
            Add field
          </Button>
        </div>

        {errors.questions && (
          <p className="text-sm text-destructive">{errors.questions}</p>
        )}

        <div className="flex flex-col gap-2">
          {value.questions.map((q) => {
            const isEditing = editingId === q.id;
            const rowError = errors[`question_${q.id}`];
            return (
              <div
                key={q.id}
                className={cn(
                  'rounded-lg border bg-muted/30',
                  rowError && 'border-destructive'
                )}
              >
                {/* Collapsed row */}
                <div className="flex items-center gap-2 p-3">
                  <GripVertical className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {fieldDisplayName(q)}
                  </span>
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    {leadFormFieldTypeLabels[q.type]}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    aria-label={isEditing ? 'Close field editor' : 'Edit field'}
                    onClick={() => setEditingId(isEditing ? null : q.id)}
                  >
                    <Pencil className="size-4 text-muted-foreground" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    aria-label="Remove field"
                    onClick={() => removeQuestion(q.id)}
                    disabled={value.questions.length <= 1}
                  >
                    <Trash2 className="size-4 text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>

                {/* Inline editor — type + label stacked vertically */}
                {isEditing && (
                  <div className="flex flex-col gap-3 border-t px-3 py-3">
                    <Field>
                      <FieldLabel htmlFor={`lf-type-${q.id}`}>Type</FieldLabel>
                      <Select
                        value={q.type}
                        onValueChange={(v) =>
                          updateQuestion(q.id, {
                            type: v as LeadFormFieldType,
                          })
                        }
                      >
                        <SelectTrigger
                          id={`lf-type-${q.id}`}
                          className="w-full"
                        >
                          <SelectValue placeholder="Select field type" />
                        </SelectTrigger>
                        <SelectContent>
                          {leadFormFieldTypeValues.map((type) => (
                            <SelectItem key={type} value={type}>
                              {leadFormFieldTypeLabels[type]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>

                    {q.type === 'CUSTOM' && (
                      <>
                        <Field data-invalid={!!rowError}>
                          <FieldLabel htmlFor={`lf-label-${q.id}`}>
                            Label
                          </FieldLabel>
                          <Input
                            id={`lf-label-${q.id}`}
                            placeholder="e.g., What service are you interested in?"
                            value={q.label ?? ''}
                            onChange={(e) =>
                              updateQuestion(q.id, { label: e.target.value })
                            }
                            aria-invalid={!!rowError}
                          />
                          {rowError && (
                            <FieldError errors={[{ message: rowError }]} />
                          )}
                        </Field>

                        {/* Multiple-choice answer options. A CUSTOM question
                            with options becomes a multiple-choice question on
                            Meta's instant form. */}
                        {q.options && q.options.length > 0 ? (
                          <Field>
                            <FieldLabel>Answer options</FieldLabel>
                            <FieldDescription>
                              People pick one of these choices
                            </FieldDescription>
                            <div className="flex flex-col gap-2">
                              {q.options.map((opt, i) => (
                                <div
                                  key={i}
                                  className="flex items-center gap-2"
                                >
                                  <Input
                                    className="min-w-0 flex-1"
                                    placeholder={`Option ${i + 1}`}
                                    value={opt.value}
                                    onChange={(e) =>
                                      updateOption(q, i, e.target.value)
                                    }
                                  />
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-8 shrink-0"
                                    aria-label="Remove option"
                                    onClick={() => removeOption(q, i)}
                                  >
                                    <Trash2 className="size-4 text-muted-foreground hover:text-destructive" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="mt-1 self-start"
                              onClick={() => addOption(q)}
                            >
                              <Plus className="size-4" />
                              Add option
                            </Button>
                          </Field>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="self-start"
                            onClick={() => addOption(q)}
                          >
                            <Plus className="size-4" />
                            Make multiple choice
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground">
          Tip: start with Name, Email, and Phone for better conversion rates.
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// Step 3 — Privacy policy + thank you
// ============================================================================

interface FinishStepProps {
  value: LeadFormBuilderValue;
  onChange: (value: LeadFormBuilderValue) => void;
  errors: LeadFormBuilderErrors;
}

export function FinishStep({ value, onChange, errors }: FinishStepProps) {
  const patch = (updates: Partial<LeadFormBuilderValue>) =>
    onChange({ ...value, ...updates });

  return (
    <div className="flex flex-col gap-6">
      {/* Privacy policy */}
      <Field data-invalid={!!errors.privacyPolicyUrl}>
        <FieldLabel htmlFor="lf-privacy">
          Privacy policy URL{' '}
          <span className="text-muted-foreground">(optional)</span>
        </FieldLabel>
        <FieldDescription>
          Meta shows a privacy link on every form. Leave blank and we'll use
          your website or Facebook Page.
        </FieldDescription>
        <Input
          id="lf-privacy"
          type="url"
          value={value.privacyPolicyUrl}
          onChange={(e) => patch({ privacyPolicyUrl: e.target.value })}
          placeholder="https://yoursite.com/privacy-policy"
          aria-invalid={!!errors.privacyPolicyUrl}
        />
        {errors.privacyPolicyUrl && (
          <FieldError errors={[{ message: errors.privacyPolicyUrl }]} />
        )}
      </Field>

      {/* Thank you page */}
      <div className="flex flex-col gap-4">
        <div>
          <FieldLabel>Thank you screen</FieldLabel>
          <FieldDescription>
            Shown right after someone submits the form
          </FieldDescription>
        </div>
        <Field>
          <FieldLabel htmlFor="lf-ty-title">Title</FieldLabel>
          <Input
            id="lf-ty-title"
            value={value.thankYouTitle}
            onChange={(e) => patch({ thankYouTitle: e.target.value })}
            placeholder="Thank you!"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="lf-ty-body">Message</FieldLabel>
          <Textarea
            id="lf-ty-body"
            value={value.thankYouBody}
            onChange={(e) => patch({ thankYouBody: e.target.value })}
            placeholder="We'll be in touch soon."
            rows={2}
          />
        </Field>
      </div>
    </div>
  );
}

// ============================================================================
// Step 2 — Lead nurturing (styled like Meta, single-select channel)
// ============================================================================

interface NurtureChannelOption {
  value: Exclude<LeadFormFollowUpChannel, 'none'> | 'instagram';
  label: string;
  icon: typeof MessageCircle;
}

const NURTURE_CHANNELS: NurtureChannelOption[] = [
  { value: 'messenger', label: 'Chat on Messenger', icon: MessageCircle },
  { value: 'instagram', label: 'Chat on Instagram', icon: Instagram },
  { value: 'whatsapp', label: 'Chat on WhatsApp', icon: MessageCircle },
];

interface LeadNurturingSectionProps {
  channel: LeadFormFollowUpChannel;
  whatsappNumber: string;
  whatsappError?: string;
  whatsappConnected: boolean;
  connectedWhatsappNumber?: string;
  onChannelChange: (channel: LeadFormFollowUpChannel) => void;
  onWhatsappNumberChange: (value: string) => void;
}

export function LeadNurturingSection({
  channel,
  whatsappNumber,
  whatsappError,
  whatsappConnected,
  connectedWhatsappNumber,
  onChannelChange,
  onWhatsappNumberChange,
}: LeadNurturingSectionProps) {
  // Per-channel availability. Instagram chat is set at the ad level (not the
  // form); WhatsApp needs a connected, non-expired WhatsApp Business account.
  const channelState = (opt: NurtureChannelOption) => {
    if (opt.value === 'instagram') {
      return {
        disabled: true,
        note: 'Configured at the ad level, not on the form',
      };
    }
    if (opt.value === 'whatsapp' && !whatsappConnected) {
      return {
        disabled: true,
        note: 'Reconnect WhatsApp to use this follow-up',
      };
    }
    return { disabled: false, note: undefined };
  };

  const selectChannel = (opt: NurtureChannelOption, selected: boolean) => {
    if (selected) {
      onChannelChange('none');
      return;
    }
    onChannelChange(opt.value as LeadFormFollowUpChannel);
    // Prefill the connected business number when picking WhatsApp.
    if (
      opt.value === 'whatsapp' &&
      connectedWhatsappNumber &&
      !whatsappNumber.trim()
    ) {
      onWhatsappNumberChange(connectedWhatsappNumber);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="size-4 text-green-600 dark:text-green-400" />
        <h3 className="text-sm font-semibold">Instant form lead nurturing</h3>
      </div>
      <p className="text-sm text-muted-foreground">
        Reach leads where they're most active with a follow-up chat right after
        they submit. Pick one channel for the form's thank-you screen, or skip
        this step.
      </p>

      <div className="flex flex-col gap-2">
        {NURTURE_CHANNELS.map((opt) => {
          const { disabled, note } = channelState(opt);
          const selected = !disabled && channel === opt.value;
          const Icon = opt.icon;
          return (
            <div key={opt.value}>
              <button
                type="button"
                disabled={disabled}
                aria-pressed={selected}
                onClick={() => selectChannel(opt, selected)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                  selected && 'border-primary bg-primary/5',
                  disabled
                    ? 'cursor-not-allowed opacity-60'
                    : 'hover:bg-muted/50'
                )}
              >
                <span
                  className={cn(
                    'flex size-5 items-center justify-center rounded-[4px] border',
                    selected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-input'
                  )}
                >
                  {selected && <CheckCircle2 className="size-4" />}
                </span>
                <Icon className="size-5 text-muted-foreground" />
                <span className="flex flex-col">
                  <span className="text-sm font-medium">{opt.label}</span>
                  {note && (
                    <span className="text-xs text-muted-foreground">
                      {note}
                    </span>
                  )}
                </span>
              </button>

              {/* WhatsApp number — revealed when WhatsApp is selected */}
              {opt.value === 'whatsapp' && selected && (
                <div className="mt-2 pl-8">
                  <Field data-invalid={!!whatsappError}>
                    <FieldLabel htmlFor="lf-wa-number">
                      WhatsApp business number
                    </FieldLabel>
                    <Input
                      id="lf-wa-number"
                      value={whatsappNumber}
                      onChange={(e) => onWhatsappNumberChange(e.target.value)}
                      placeholder="+353 87 787 1690"
                      aria-invalid={!!whatsappError}
                    />
                    <FieldDescription>
                      A WhatsApp Business account is required to open chats from
                      ads.
                    </FieldDescription>
                    {whatsappError && (
                      <FieldError errors={[{ message: whatsappError }]} />
                    )}
                  </Field>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
