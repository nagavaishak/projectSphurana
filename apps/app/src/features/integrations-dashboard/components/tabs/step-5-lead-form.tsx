import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
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
import {
  useCreateMetaLeadForm,
  useGetMetaIntegration,
  useListMetaLeadForms,
} from '@/features/integrations';
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  GripVertical,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';

// Facebook Lead Form field types
const QUESTION_TYPES = [
  { value: 'EMAIL', label: 'Email', description: 'Email address field' },
  { value: 'PHONE', label: 'Phone', description: 'Phone number field' },
  { value: 'FULL_NAME', label: 'Full Name', description: 'Full name field' },
  { value: 'FIRST_NAME', label: 'First Name', description: 'First name only' },
  { value: 'LAST_NAME', label: 'Last Name', description: 'Last name only' },
  { value: 'CITY', label: 'City', description: 'City field' },
  { value: 'STATE', label: 'State/Province', description: 'State or province' },
  { value: 'COUNTRY', label: 'Country', description: 'Country field' },
  { value: 'ZIP', label: 'ZIP/Postal Code', description: 'ZIP or postal code' },
  {
    value: 'STREET_ADDRESS',
    label: 'Street Address',
    description: 'Street address',
  },
  {
    value: 'DATE_OF_BIRTH',
    label: 'Date of Birth',
    description: 'Birth date field',
  },
  { value: 'GENDER', label: 'Gender', description: 'Gender field' },
  { value: 'JOB_TITLE', label: 'Job Title', description: 'Job title field' },
  {
    value: 'COMPANY_NAME',
    label: 'Company Name',
    description: 'Company name field',
  },
  { value: 'WORK_EMAIL', label: 'Work Email', description: 'Work email field' },
  {
    value: 'WORK_PHONE_NUMBER',
    label: 'Work Phone',
    description: 'Work phone number',
  },
  {
    value: 'CUSTOM',
    label: 'Custom Question',
    description: 'Custom question with your own label',
  },
] as const;

type QuestionType = (typeof QUESTION_TYPES)[number]['value'];

interface Question {
  id: string;
  type: QuestionType;
  label?: string;
  key?: string;
}

interface Step5LeadFormProps {
  // biome-ignore lint/suspicious/noExplicitAny: Form type varies
  form: UseFormReturn<any>;
  organizationId?: string;
}

export function Step5LeadForm({ organizationId }: Step5LeadFormProps) {
  // State for form builder
  const [formName, setFormName] = useState('Lead Form');
  const [privacyPolicyUrl, setPrivacyPolicyUrl] = useState('');
  const [questions, setQuestions] = useState<Question[]>([
    { id: '1', type: 'FULL_NAME' },
    { id: '2', type: 'EMAIL' },
    { id: '3', type: 'PHONE' },
  ]);
  const [thankYouTitle, setThankYouTitle] = useState('Thank you!');
  const [thankYouBody, setThankYouBody] = useState(
    "We've received your information and will be in touch soon."
  );
  const [showThankYouSettings, setShowThankYouSettings] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // API hooks
  const { isConnected, isLoading: isLoadingIntegration } =
    useGetMetaIntegration({
      queryConfig: { enabled: !!organizationId },
    });

  const { forms, isLoading: isLoadingForms } = useListMetaLeadForms({
    enabled: !!organizationId && isConnected,
  });

  const { createMetaLeadForm, isCreating } = useCreateMetaLeadForm({
    onSuccess: () => {
      // Reset form after successful creation
      setFormName('Lead Form');
      setQuestions([
        { id: '1', type: 'FULL_NAME' },
        { id: '2', type: 'EMAIL' },
        { id: '3', type: 'PHONE' },
      ]);
      setErrors({});
    },
  });

  // Generate unique ID for questions
  const generateId = () => Math.random().toString(36).substring(2, 9);

  // Add a new question
  const addQuestion = () => {
    setQuestions([
      ...questions,
      { id: generateId(), type: 'CUSTOM', label: '' },
    ]);
  };

  // Remove a question
  const removeQuestion = (id: string) => {
    if (questions.length > 1) {
      setQuestions(questions.filter((q) => q.id !== id));
    }
  };

  // Update a question
  const updateQuestion = (id: string, updates: Partial<Question>) => {
    setQuestions(
      questions.map((q) => (q.id === id ? { ...q, ...updates } : q))
    );
  };

  // Validate form
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formName.trim()) {
      newErrors.formName = 'Form name is required';
    }

    // Optional: blank falls back to the org website / Facebook Page server-side
    // (Meta still receives a URL). Only validate when one is entered.
    if (privacyPolicyUrl.trim()) {
      try {
        new URL(privacyPolicyUrl);
      } catch {
        newErrors.privacyPolicyUrl = 'Please enter a valid URL';
      }
    }

    if (questions.length === 0) {
      newErrors.questions = 'At least one question is required';
    }

    // Validate custom questions have labels
    for (const q of questions) {
      if (q.type === 'CUSTOM' && !q.label?.trim()) {
        newErrors[`question_${q.id}`] = 'Custom questions require a label';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle form submission
  const handleCreateForm = () => {
    if (!validateForm()) return;

    createMetaLeadForm({
      name: formName,
      questions: questions.map((q) => ({
        type: q.type,
        label: q.label,
        key:
          q.type === 'CUSTOM'
            ? q.key || q.label?.toLowerCase().replace(/\s+/g, '_')
            : undefined,
      })),
      // Blank → undefined so the server falls back to the org website / FB page.
      privacyPolicyUrl: privacyPolicyUrl.trim() || undefined,
      thankYouPage: {
        title: thankYouTitle,
        body: thankYouBody,
      },
    });
  };

  // Not connected to Meta - show message
  if (!organizationId) {
    return (
      <FieldGroup className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Create Facebook Lead Form</h1>
          <p className="text-sm text-muted-foreground">
            Build a lead capture form that will be used with your Facebook ads.
          </p>
        </div>

        <div className="rounded-lg border border-dashed border-muted-foreground/25 bg-muted/50 p-6 text-center">
          <FileText className="mx-auto size-10 text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">
            Lead form creation will be available after your organization is
            created.
          </p>
        </div>
      </FieldGroup>
    );
  }

  // Loading state
  if (isLoadingIntegration) {
    return (
      <FieldGroup className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Create Facebook Lead Form</h1>
          <p className="text-sm text-muted-foreground">
            Checking your Meta connection...
          </p>
        </div>
        <div className="animate-pulse space-y-3">
          <div className="h-16 rounded-lg bg-muted" />
        </div>
      </FieldGroup>
    );
  }

  // Meta not connected
  if (!isConnected) {
    return (
      <FieldGroup className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Create Facebook Lead Form</h1>
          <p className="text-sm text-muted-foreground">
            Build a lead capture form that will be used with your Facebook ads.
          </p>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 size-5 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                Meta Ads connection required
              </p>
              <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
                Please connect your Meta Ads account in the previous step before
                creating a lead form.
              </p>
            </div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          You can skip this step and create lead forms later in your settings.
        </p>
      </FieldGroup>
    );
  }

  return (
    <FieldGroup className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Create Facebook Lead Form</h1>
        <p className="text-sm text-muted-foreground">
          Build a lead capture form that will be used with your Facebook ads.
          Users will see this form when they click your ad.
        </p>
      </div>

      {/* Existing Forms */}
      {!isLoadingForms && forms.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-green-500" />
            <p className="text-sm font-medium">Existing Lead Forms</p>
          </div>
          <div className="space-y-2">
            {forms.map((form) => (
              <div
                key={form.id}
                className="flex items-center justify-between rounded-lg border bg-muted/30 p-3"
              >
                <div className="flex items-center gap-3">
                  <FileText className="size-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{form.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Status: {form.status}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Form Builder */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Create New Lead Form</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Form Name */}
          <Field data-invalid={!!errors.formName}>
            <FieldLabel htmlFor="formName">Form Name</FieldLabel>
            <FieldDescription>
              Internal name for your reference (not shown to users)
            </FieldDescription>
            <Input
              id="formName"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="e.g., Summer Campaign Lead Form"
              aria-invalid={!!errors.formName}
            />
            {errors.formName && (
              <FieldError errors={[{ message: errors.formName }]} />
            )}
          </Field>

          {/* Questions Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <FieldLabel>Questions</FieldLabel>
                <FieldDescription>
                  Fields that users will fill out
                </FieldDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addQuestion}
              >
                <Plus className="size-4" />
                Add Question
              </Button>
            </div>

            {errors.questions && (
              <div className="text-sm text-destructive">{errors.questions}</div>
            )}

            <div className="space-y-3">
              {questions.map((question) => (
                <div
                  key={question.id}
                  className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3"
                >
                  <div className="flex size-8 items-center justify-center text-muted-foreground">
                    <GripVertical className="size-4" />
                  </div>

                  <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-start">
                    <div className="flex-1">
                      <Select
                        value={question.type}
                        onValueChange={(value) =>
                          updateQuestion(question.id, {
                            type: value as QuestionType,
                          })
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select field type" />
                        </SelectTrigger>
                        <SelectContent>
                          {QUESTION_TYPES.map((type) => (
                            <SelectItem key={type.value} value={type.value}>
                              <div className="flex flex-col">
                                <span>{type.label}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {question.type === 'CUSTOM' && (
                      <div className="flex-1">
                        <Input
                          placeholder="Custom question label"
                          value={question.label || ''}
                          onChange={(e) =>
                            updateQuestion(question.id, {
                              label: e.target.value,
                            })
                          }
                          aria-invalid={!!errors[`question_${question.id}`]}
                        />
                        {errors[`question_${question.id}`] && (
                          <p className="mt-1 text-xs text-destructive">
                            {errors[`question_${question.id}`]}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => removeQuestion(question.id)}
                    disabled={questions.length <= 1}
                  >
                    <Trash2 className="size-4 text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">
              Tip: Start with essential fields like Name, Email, and Phone for
              better conversion rates.
            </p>
          </div>

          {/* Privacy Policy URL */}
          <Field data-invalid={!!errors.privacyPolicyUrl}>
            <FieldLabel htmlFor="privacyPolicyUrl">
              Privacy Policy URL (optional)
            </FieldLabel>
            <FieldDescription>
              Facebook shows a privacy link on every form. Leave blank and we'll
              use your website or Facebook Page.
            </FieldDescription>
            <Input
              id="privacyPolicyUrl"
              type="url"
              value={privacyPolicyUrl}
              onChange={(e) => setPrivacyPolicyUrl(e.target.value)}
              placeholder="https://yoursite.com/privacy-policy"
              aria-invalid={!!errors.privacyPolicyUrl}
            />
            {errors.privacyPolicyUrl && (
              <FieldError errors={[{ message: errors.privacyPolicyUrl }]} />
            )}
          </Field>

          {/* Thank You Page (Collapsible) */}
          <div className="space-y-3">
            <Button
              type="button"
              variant="ghost"
              className="h-auto justify-start p-0 text-sm font-medium"
              onClick={() => setShowThankYouSettings(!showThankYouSettings)}
            >
              {showThankYouSettings ? '− ' : '+ '}
              Thank You Page Settings (Optional)
            </Button>

            {showThankYouSettings && (
              <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
                <Field>
                  <FieldLabel htmlFor="thankYouTitle">Title</FieldLabel>
                  <Input
                    id="thankYouTitle"
                    value={thankYouTitle}
                    onChange={(e) => setThankYouTitle(e.target.value)}
                    placeholder="Thank you!"
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="thankYouBody">Message</FieldLabel>
                  <Input
                    id="thankYouBody"
                    value={thankYouBody}
                    onChange={(e) => setThankYouBody(e.target.value)}
                    placeholder="We'll be in touch soon."
                  />
                </Field>
              </div>
            )}
          </div>

          {/* Create Button */}
          <div className="flex justify-end pt-2">
            <Button
              type="button"
              onClick={handleCreateForm}
              disabled={isCreating}
            >
              {isCreating ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Creating on Facebook...
                </>
              ) : (
                <>
                  <Plus className="size-4" />
                  Create Lead Form
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        You can skip this step and create lead forms later in your campaign
        settings. The form will be created directly on Facebook and linked to
        your ad account.
      </p>
    </FieldGroup>
  );
}
