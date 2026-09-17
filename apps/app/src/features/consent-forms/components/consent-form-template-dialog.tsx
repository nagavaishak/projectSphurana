import {
  consentFormFieldTypeLabels,
  consentFormFieldTypeValues,
} from '@borradh-workspace/labels';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';

import { AiFieldWrapper } from '@/components/ui/ai-field-wrapper';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

import { useCreateConsentFormTemplate } from '../api/create-consent-form-template';
import { useGenerateConsentFormTemplate } from '../api/generate-consent-form-template';
import type { ConsentFormTemplate } from '../api/types';
import { useUpdateConsentFormTemplate } from '../api/update-consent-form-template';

const templateFormSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  body: z.string().min(1, 'Form text is required'),
  fields: z.array(
    z.object({
      type: z.enum(consentFormFieldTypeValues),
      label: z.string().min(1, 'Label is required'),
    })
  ),
  requiresSignature: z.boolean(),
});

type TemplateFormValues = z.infer<typeof templateFormSchema>;

const emptyValues: TemplateFormValues = {
  title: '',
  body: '',
  fields: [],
  requiresSignature: true,
};

/**
 * Create/edit dialog for a consent-form template (ENG-647 Phase 2).
 * Pass `template` to edit, omit/null to create.
 */
export function ConsentFormTemplateDialog({
  open,
  onOpenChange,
  template,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: ConsentFormTemplate | null;
}) {
  const isEdit = !!template;

  const form = useForm<TemplateFormValues>({
    resolver: zodResolver(templateFormSchema),
    defaultValues: emptyValues,
  });

  // "Write with AI" — a description the clinician types to draft the template.
  const [aiPrompt, setAiPrompt] = useState('');
  const [hasGenerated, setHasGenerated] = useState(false);

  const { reset } = form;
  useEffect(() => {
    if (!open) return;
    setAiPrompt('');
    setHasGenerated(false);
    reset(
      template
        ? {
            title: template.title,
            body: template.body,
            fields: template.fields.map((field) => ({
              type: field.type,
              label: field.label,
            })),
            requiresSignature: template.requiresSignature,
          }
        : emptyValues
    );
  }, [open, template, reset]);

  const fieldArray = useFieldArray({ control: form.control, name: 'fields' });

  const { generateTemplate, isGenerating } = useGenerateConsentFormTemplate({
    onSuccess: (draft) => {
      // Drop the whole draft into the form for the clinician to review/edit.
      form.setValue('title', draft.title, { shouldDirty: true });
      form.setValue('body', draft.body, { shouldDirty: true });
      fieldArray.replace(
        draft.fields.map((f) => ({ type: f.type, label: f.label }))
      );
      form.setValue('requiresSignature', draft.requiresSignature, {
        shouldDirty: true,
      });
      setHasGenerated(true);
    },
  });

  const { createTemplate, isCreating } = useCreateConsentFormTemplate({
    onSuccess: () => onOpenChange(false),
  });
  const { updateTemplate, isUpdating } = useUpdateConsentFormTemplate({
    onSuccess: () => onOpenChange(false),
  });
  const isSaving = isCreating || isUpdating;

  const onSubmit = (values: TemplateFormValues) => {
    if (isEdit && template) {
      updateTemplate({ id: template.id, ...values });
    } else {
      createTemplate(values);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Edit template' : 'New consent form template'}
          </DialogTitle>
          <DialogDescription>
            Patients read and sign this form before their appointment.
          </DialogDescription>
        </DialogHeader>

        <form
          noValidate
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-6"
        >
          {!isEdit ? (
            <div className="bg-muted/40 flex flex-col gap-3 rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <Sparkles className="text-primary size-4" />
                <p className="text-sm font-medium">Write with AI</p>
              </div>
              <Textarea
                value={aiPrompt}
                onChange={(event) => setAiPrompt(event.target.value)}
                rows={2}
                placeholder="e.g. Botox consent for a medspa. Ask about allergies and confirm not pregnant."
                disabled={isGenerating}
                aria-label="Describe the consent form for AI"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                disabled={!aiPrompt.trim() || isGenerating}
                onClick={() => generateTemplate({ prompt: aiPrompt.trim() })}
              >
                <Sparkles className="size-4" />
                {isGenerating ? 'Writing…' : 'Write with AI'}
              </Button>
            </div>
          ) : null}

          <AiFieldWrapper
            isGenerating={isGenerating}
            hasGenerated={hasGenerated}
          >
            <FieldGroup className="gap-5">
              <Controller
                control={form.control}
                name="title"
                render={({ field, fieldState }) => (
                  <Field className="gap-2" data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={field.name}>Title</FieldLabel>
                    <Input
                      {...field}
                      id={field.name}
                      placeholder="e.g. Laser treatment consent"
                      aria-invalid={fieldState.invalid}
                    />
                    {fieldState.error ? (
                      <FieldError errors={[fieldState.error]} />
                    ) : null}
                  </Field>
                )}
              />

              <Controller
                control={form.control}
                name="body"
                render={({ field, fieldState }) => (
                  <Field className="gap-2" data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={field.name}>Form text</FieldLabel>
                    <Textarea
                      {...field}
                      id={field.name}
                      rows={8}
                      placeholder="The text your patient reads and agrees to…"
                      aria-invalid={fieldState.invalid}
                    />
                    <FieldDescription>
                      Use {'{{patientName}}'} to insert the patient's name.
                    </FieldDescription>
                    {fieldState.error ? (
                      <FieldError errors={[fieldState.error]} />
                    ) : null}
                  </Field>
                )}
              />

              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-sm font-medium">Additional fields</p>
                  <p className="text-muted-foreground text-sm">
                    Extra questions the patient fills in, shown after the form
                    text.
                  </p>
                </div>

                {fieldArray.fields.map((row, index) => (
                  <div key={row.id} className="flex items-start gap-2">
                    <Controller
                      control={form.control}
                      name={`fields.${index}.type`}
                      render={({ field }) => (
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          <SelectTrigger
                            className="w-32 shrink-0"
                            aria-label={`Field ${index + 1} type`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {consentFormFieldTypeValues.map((value) => (
                              <SelectItem key={value} value={value}>
                                {consentFormFieldTypeLabels[value]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                    <Controller
                      control={form.control}
                      name={`fields.${index}.label`}
                      render={({ field, fieldState }) => (
                        <Field
                          className="flex-1 gap-1"
                          data-invalid={fieldState.invalid}
                        >
                          <Input
                            {...field}
                            aria-label={`Field ${index + 1} label`}
                            placeholder="Label, e.g. Allergies"
                            aria-invalid={fieldState.invalid}
                          />
                          {fieldState.error ? (
                            <FieldError errors={[fieldState.error]} />
                          ) : null}
                        </Field>
                      )}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove field ${index + 1}`}
                      onClick={() => fieldArray.remove(index)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={() => fieldArray.append({ type: 'text', label: '' })}
                >
                  <Plus className="size-4" />
                  Add field
                </Button>
              </div>

              <Controller
                control={form.control}
                name="requiresSignature"
                render={({ field }) => (
                  <Field
                    className="flex-row items-center justify-between gap-4"
                    orientation="horizontal"
                  >
                    <div>
                      <FieldLabel htmlFor={field.name}>
                        Requires signature
                      </FieldLabel>
                      <FieldDescription>
                        Patient must type their full name and confirm agreement.
                      </FieldDescription>
                    </div>
                    <Switch
                      id={field.name}
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </Field>
                )}
              />
            </FieldGroup>
          </AiFieldWrapper>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving
                ? 'Saving…'
                : isEdit
                  ? 'Save changes'
                  : 'Create template'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
