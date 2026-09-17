import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
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
import { Switch } from '@/components/ui/switch';
import {
  useGetMetaIntegration,
  useListMetaLeadForms,
} from '@/features/integrations';
import type { MetaLeadForm } from '@/features/integrations/types';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  FileText,
  GripVertical,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  RefreshCw,
  Trash2,
  User,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, type UseFormReturn, useFieldArray } from 'react-hook-form';

// Field type definitions
const FIELD_TYPES = [
  { value: 'text', label: 'Text', icon: MessageSquare },
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'phone', label: 'Phone', icon: Phone },
  { value: 'name', label: 'Full Name', icon: User },
  { value: 'date', label: 'Date', icon: Calendar },
  { value: 'dropdown', label: 'Dropdown', icon: ChevronDown },
] as const;

// Default form fields for salon/beauty businesses
const DEFAULT_FIELDS = [
  {
    label: 'Full Name',
    type: 'name',
    required: true,
    placeholder: 'Your name',
  },
  {
    label: 'Email',
    type: 'email',
    required: true,
    placeholder: 'you@example.com',
  },
  {
    label: 'Phone Number',
    type: 'phone',
    required: true,
    placeholder: '+1 (555) 000-0000',
  },
  {
    label: 'Preferred Date',
    type: 'date',
    required: false,
    placeholder: 'Select a date',
  },
  {
    label: 'Message',
    type: 'text',
    required: false,
    placeholder: 'Tell us about your needs...',
  },
];

export interface LeadFormField {
  id: string;
  label: string;
  type: 'text' | 'email' | 'phone' | 'name' | 'date' | 'dropdown';
  required: boolean;
  placeholder: string;
  options?: string[]; // For dropdown type
}

type FormMode = 'select' | 'create';

interface Step11LeadFormProps {
  // biome-ignore lint/suspicious/noExplicitAny: Form type varies
  form: UseFormReturn<any>;
  organizationId?: string;
}

export function Step11LeadForm({ form, organizationId }: Step11LeadFormProps) {
  const { control, watch, setValue } = form;
  const [showPreview, setShowPreview] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>('select');

  // Get Meta integration status
  const { isConnected: isMetaConnected, isLoading: isCheckingMeta } =
    useGetMetaIntegration();

  // Fetch lead forms from Meta (only if connected)
  const {
    forms: metaForms,
    isLoading: isLoadingForms,
    isError: isFormsError,
    refetch: refetchForms,
  } = useListMetaLeadForms({
    enabled: !!organizationId && isMetaConnected,
  });

  // Watch selected form ID and custom form name
  const selectedFormId = watch('selectedMetaFormId');
  const customFormName = watch('customLeadFormName');

  // Use field array for dynamic form fields (for create mode)
  const { fields, append, remove, move } = useFieldArray({
    control,
    name: 'leadFormFields',
  });

  // Update isCustomLeadForm when mode changes
  useEffect(() => {
    if (formMode === 'create') {
      setValue('isCustomLeadForm', true);
      // Clear selected form when switching to create mode
      setValue('selectedMetaFormId', undefined);
      setValue('selectedMetaFormName', undefined);
    } else {
      setValue('isCustomLeadForm', false);
    }
  }, [formMode, setValue]);

  // Handler for custom form name changes
  const handleCustomFormNameChange = (name: string) => {
    setValue('customLeadFormName', name);
  };

  // Initialize default fields if empty and in create mode
  const formFields = watch('leadFormFields') || [];
  useEffect(() => {
    if (formFields.length === 0 && organizationId && formMode === 'create') {
      setValue(
        'leadFormFields',
        DEFAULT_FIELDS.map((field, index) => ({
          ...field,
          id: `field-${index}`,
        }))
      );
    }
  }, [formFields.length, organizationId, formMode, setValue]);

  // No org yet - show informational UI
  if (!organizationId) {
    return (
      <FieldGroup className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Lead Form Selection</h1>
          <p className="text-sm text-muted-foreground">
            Select or configure the lead intake form for your Facebook
            campaigns.
          </p>
        </div>

        <div className="rounded-lg border border-dashed border-muted-foreground/25 bg-muted/50 p-6 text-center">
          <ClipboardList className="mx-auto size-10 text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">
            Lead form configuration will be available after your organization is
            created.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            You can skip this step and set it up later in Settings.
          </p>
        </div>
      </FieldGroup>
    );
  }

  // Meta not connected
  if (!isCheckingMeta && !isMetaConnected) {
    return (
      <FieldGroup className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Lead Form Selection</h1>
          <p className="text-sm text-muted-foreground">
            Select or configure the lead intake form for your Facebook
            campaigns.
          </p>
        </div>

        <Alert variant="default">
          <AlertCircle className="size-4" />
          <AlertDescription>
            Connect your Meta account in Step 9 to select existing lead forms.
            You can also skip this step and configure it later.
          </AlertDescription>
        </Alert>

        {/* Show create mode as fallback */}
        <CreateFormMode
          fields={fields}
          control={control}
          showPreview={showPreview}
          setShowPreview={setShowPreview}
          append={append}
          remove={remove}
          move={move}
          customFormName={customFormName}
          onCustomFormNameChange={handleCustomFormNameChange}
        />
      </FieldGroup>
    );
  }

  // Loading state
  if (isCheckingMeta || isLoadingForms) {
    return (
      <FieldGroup className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Lead Form Selection</h1>
          <p className="text-sm text-muted-foreground">
            Loading your existing lead forms from Meta...
          </p>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </FieldGroup>
    );
  }

  // Error state
  if (isFormsError) {
    return (
      <FieldGroup className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Lead Form Selection</h1>
          <p className="text-sm text-muted-foreground">
            Select or configure the lead intake form for your Facebook
            campaigns.
          </p>
        </div>

        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>Failed to load lead forms from Meta.</span>
            <Button variant="outline" size="sm" onClick={() => refetchForms()}>
              <RefreshCw className="size-4 mr-1" />
              Retry
            </Button>
          </AlertDescription>
        </Alert>

        {/* Show create mode as fallback */}
        <CreateFormMode
          fields={fields}
          control={control}
          showPreview={showPreview}
          setShowPreview={setShowPreview}
          append={append}
          remove={remove}
          move={move}
          customFormName={customFormName}
          onCustomFormNameChange={handleCustomFormNameChange}
        />
      </FieldGroup>
    );
  }

  // Has forms from Meta
  const hasMetaForms = metaForms.length > 0;

  return (
    <FieldGroup className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Lead Form Selection</h1>
        <p className="text-sm text-muted-foreground">
          {hasMetaForms
            ? 'Select an existing lead form from your Facebook page or create a new one.'
            : 'No lead forms found on your Facebook page. Create a custom form below.'}
        </p>
      </div>

      {/* Mode Toggle (only show if Meta has forms) */}
      {hasMetaForms && (
        <div className="flex gap-2">
          <Button
            type="button"
            variant={formMode === 'select' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFormMode('select')}
          >
            <FileText className="size-4 mr-1.5" />
            Select Existing
          </Button>
          <Button
            type="button"
            variant={formMode === 'create' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFormMode('create')}
          >
            <Plus className="size-4 mr-1.5" />
            Create Custom
          </Button>
        </div>
      )}

      {/* Select Mode - Show existing forms */}
      {formMode === 'select' && hasMetaForms && (
        <Controller
          name="selectedMetaFormId"
          control={control}
          render={({ field }) => (
            <RadioGroup
              value={field.value || ''}
              onValueChange={(formId) => {
                field.onChange(formId);
                // Also set the form name for display purposes
                const selectedForm = metaForms.find((f) => f.id === formId);
                if (selectedForm) {
                  setValue('selectedMetaFormName', selectedForm.name);
                }
              }}
              className="space-y-3"
            >
              {metaForms.map((metaForm) => (
                <MetaFormCard
                  key={metaForm.id}
                  form={metaForm}
                  isSelected={field.value === metaForm.id}
                />
              ))}
            </RadioGroup>
          )}
        />
      )}

      {/* Create Mode - Custom form builder */}
      {(formMode === 'create' || !hasMetaForms) && (
        <CreateFormMode
          fields={fields}
          control={control}
          showPreview={showPreview}
          setShowPreview={setShowPreview}
          append={append}
          remove={remove}
          move={move}
          customFormName={customFormName}
          onCustomFormNameChange={handleCustomFormNameChange}
        />
      )}

      <p className="text-xs text-muted-foreground">
        {formMode === 'select' && selectedFormId
          ? 'This form will be used for your Facebook Lead Ads campaigns.'
          : 'Custom forms will be synced to your Facebook page for use in Lead Ads.'}
      </p>
    </FieldGroup>
  );
}

// Meta Form Card Component
function MetaFormCard({
  form,
  isSelected,
}: {
  form: MetaLeadForm;
  isSelected: boolean;
}) {
  const statusColor = form.status === 'ACTIVE' ? 'default' : 'secondary';

  return (
    <Card
      className={`cursor-pointer transition-all ${
        isSelected ? 'ring-2 ring-primary' : 'hover:border-primary/50'
      }`}
    >
      <CardContent className="flex items-center gap-4 p-4">
        <RadioGroupItem value={form.id} id={form.id} className="sr-only" />
        <label
          htmlFor={form.id}
          className="flex flex-1 cursor-pointer items-center gap-4"
        >
          <div
            className={`flex size-10 items-center justify-center rounded-lg ${
              isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted'
            }`}
          >
            {isSelected ? (
              <CheckCircle2 className="size-5" />
            ) : (
              <FileText className="size-5" />
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{form.name}</span>
              <Badge variant={statusColor} className="text-xs">
                {form.status}
              </Badge>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>ID: {form.id}</span>
              {form.createdTime && (
                <span>
                  Created: {new Date(form.createdTime).toLocaleDateString()}
                </span>
              )}
              {form.locale && <span>Locale: {form.locale}</span>}
            </div>
          </div>
        </label>
      </CardContent>
    </Card>
  );
}

// Create Form Mode Component
interface CreateFormModeProps {
  // biome-ignore lint/suspicious/noExplicitAny: Dynamic field array
  fields: any[];
  // biome-ignore lint/suspicious/noExplicitAny: Form control type varies
  control: any;
  showPreview: boolean;
  setShowPreview: (value: boolean) => void;
  append: (value: LeadFormField) => void;
  remove: (index: number) => void;
  move: (from: number, to: number) => void;
  customFormName?: string;
  onCustomFormNameChange?: (name: string) => void;
}

function CreateFormMode({
  fields,
  control,
  showPreview,
  setShowPreview,
  append,
  remove,
  move,
  customFormName,
  onCustomFormNameChange,
}: CreateFormModeProps) {
  const addField = () => {
    append({
      id: `field-${Date.now()}`,
      label: '',
      type: 'text',
      required: false,
      placeholder: '',
    });
  };

  const moveField = (fromIndex: number, toIndex: number) => {
    if (toIndex >= 0 && toIndex < fields.length) {
      move(fromIndex, toIndex);
    }
  };

  return (
    <>
      {/* Form Name Input */}
      {onCustomFormNameChange && (
        <div className="space-y-1.5">
          <Label htmlFor="custom-form-name" className="text-sm">
            Form Name
          </Label>
          <Input
            id="custom-form-name"
            value={customFormName || ''}
            onChange={(e) => onCustomFormNameChange(e.target.value)}
            placeholder="e.g., Appointment Booking Form"
            className="h-9"
          />
          <p className="text-xs text-muted-foreground">
            This name will be used when syncing to your Facebook page.
          </p>
        </div>
      )}

      {/* Toggle between Edit and Preview */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Switch
            id="preview-toggle"
            checked={showPreview}
            onCheckedChange={setShowPreview}
          />
          <Label htmlFor="preview-toggle" className="text-sm">
            Preview Mode
          </Label>
        </div>
        {!showPreview && (
          <Button type="button" variant="outline" size="sm" onClick={addField}>
            <Plus className="size-4" />
            Add Field
          </Button>
        )}
      </div>

      {/* Preview Mode */}
      {showPreview ? (
        <FormPreview fields={fields as unknown as LeadFormField[]} />
      ) : (
        /* Edit Mode */
        <div className="space-y-3">
          {fields.map((field, index) => (
            <Controller
              key={field.id}
              name={`leadFormFields.${index}`}
              control={control}
              render={({ field: { value, onChange } }) => (
                <Card className="group">
                  <CardContent className="flex items-start gap-3 p-3">
                    {/* Drag Handle */}
                    <div className="flex flex-col gap-1 pt-2">
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                        onClick={() => moveField(index, index - 1)}
                        disabled={index === 0}
                      >
                        <GripVertical className="size-4" />
                      </button>
                    </div>

                    {/* Field Configuration */}
                    <div className="flex-1 space-y-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Field Label</Label>
                          <Input
                            value={value.label}
                            onChange={(e) =>
                              onChange({ ...value, label: e.target.value })
                            }
                            placeholder="e.g., Full Name"
                            className="h-8 text-sm"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Field Type</Label>
                          <Select
                            value={value.type}
                            onValueChange={(type) =>
                              onChange({ ...value, type })
                            }
                          >
                            <SelectTrigger className="h-8 text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {FIELD_TYPES.map((type) => (
                                <SelectItem key={type.value} value={type.value}>
                                  <div className="flex items-center gap-2">
                                    <type.icon className="size-3.5 text-muted-foreground" />
                                    {type.label}
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 space-y-1.5">
                          <Label className="text-xs">Placeholder Text</Label>
                          <Input
                            value={value.placeholder}
                            onChange={(e) =>
                              onChange({
                                ...value,
                                placeholder: e.target.value,
                              })
                            }
                            placeholder="Placeholder text..."
                            className="h-8 text-sm"
                          />
                        </div>
                        <div className="flex items-center gap-2 pt-5">
                          <Switch
                            id={`required-${field.id}`}
                            checked={value.required}
                            onCheckedChange={(required) =>
                              onChange({ ...value, required })
                            }
                          />
                          <Label
                            htmlFor={`required-${field.id}`}
                            className="text-xs"
                          >
                            Required
                          </Label>
                        </div>
                      </div>
                    </div>

                    {/* Delete Button */}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground opacity-0 group-hover:opacity-100"
                      onClick={() => remove(index)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </CardContent>
                </Card>
              )}
            />
          ))}

          {fields.length === 0 && (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <ClipboardList className="mx-auto size-8 text-muted-foreground/50" />
              <p className="mt-2 text-sm text-muted-foreground">
                No form fields yet
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={addField}
              >
                <Plus className="size-4" />
                Add Your First Field
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// Form Preview Component
function FormPreview({ fields }: { fields: LeadFormField[] }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-4 text-center">
          <h3 className="font-semibold">Book an Appointment</h3>
          <p className="text-xs text-muted-foreground">
            Fill out the form below and we&apos;ll get back to you shortly.
          </p>
        </div>

        <div className="space-y-4">
          {fields.map((field) => (
            <div key={field.id} className="space-y-1.5">
              <Label className="text-sm">
                {field.label || 'Untitled Field'}
                {field.required && (
                  <span className="ml-1 text-destructive">*</span>
                )}
              </Label>
              {field.type === 'dropdown' ? (
                <Select disabled>
                  <SelectTrigger className="h-9">
                    <SelectValue
                      placeholder={field.placeholder || 'Select...'}
                    />
                  </SelectTrigger>
                </Select>
              ) : field.type === 'date' ? (
                <Input
                  type="date"
                  disabled
                  className="h-9"
                  placeholder={field.placeholder}
                />
              ) : (
                <Input
                  type={
                    field.type === 'email'
                      ? 'email'
                      : field.type === 'phone'
                        ? 'tel'
                        : 'text'
                  }
                  disabled
                  className="h-9"
                  placeholder={field.placeholder}
                />
              )}
            </div>
          ))}

          {fields.length > 0 && (
            <Button className="w-full" disabled>
              Submit
            </Button>
          )}
        </div>

        {fields.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Add fields to see a preview
          </div>
        )}
      </CardContent>
    </Card>
  );
}
