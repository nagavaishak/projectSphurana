import { TagsValue } from '@/components/kibo-ui/tags';
import { Checkbox } from '@/components/ui/checkbox';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  leadSourceLabels,
  leadSourceValues,
} from '@borradh-workspace/api-client/types';
import type { UseFormReturn } from 'react-hook-form';

import { createLeadForm } from './create-lead-schema';
import type { CreateLeadFormValues } from './create-lead-schema';

/**
 * Every create-client field, as ONE component per field.
 *
 * Both create surfaces render these exact components: the quick-add
 * {@link CreateLeadDialog} (still fired from the till and the calendar, where
 * navigating away would lose a half-finished sale or booking) and the unified
 * `/create/customer` editor, where each one arrives as a `kind: 'custom'`
 * field. The dialog composes them into its two-column grid below; the editor
 * lays the same components out in its own rows. Neither owns any markup the
 * other lacks, so a field added here reaches both or neither.
 *
 * Labels come from the form declaration, not from literals here. The contract
 * harness locates each control by the same string, so the label a user reads
 * and the label the contract test looks for cannot drift apart.
 */
const L = createLeadForm.labels;

const MOBILE_FIELD_CLASS =
  'h-[44px] rounded-lg border-[#E5E5EA] text-[15px] focus-visible:border-[#2E65F3] focus-visible:ring-1 focus-visible:ring-[#2E65F3]';

const MOBILE_TEXTAREA_CLASS =
  'min-h-[88px] rounded-lg border-[#E5E5EA] text-[15px] focus-visible:border-[#2E65F3] focus-visible:ring-1 focus-visible:ring-[#2E65F3]';

export type CreateLeadFieldVariant = 'dialog' | 'mobile';

interface FieldProps {
  form: UseFormReturn<CreateLeadFormValues>;
  variant?: CreateLeadFieldVariant;
}

const inputClassFor = (variant: CreateLeadFieldVariant | undefined) =>
  variant === 'mobile' ? MOBILE_FIELD_CLASS : undefined;

export function LeadFirstNameField({ form, variant }: FieldProps) {
  return (
    <FormField
      control={form.control}
      name="firstName"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{L.firstName}</FormLabel>
          <FormControl>
            <Input
              placeholder="John"
              className={inputClassFor(variant)}
              {...field}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function LeadLastNameField({ form, variant }: FieldProps) {
  return (
    <FormField
      control={form.control}
      name="lastName"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{L.lastName}</FormLabel>
          <FormControl>
            <Input
              placeholder="Doe"
              className={inputClassFor(variant)}
              {...field}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function LeadEmailField({ form, variant }: FieldProps) {
  return (
    <FormField
      control={form.control}
      name="email"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{L.email}</FormLabel>
          <FormControl>
            <Input
              type="email"
              placeholder="johndoe@example.com"
              className={inputClassFor(variant)}
              {...field}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function LeadPhoneField({ form, variant }: FieldProps) {
  return (
    <FormField
      control={form.control}
      name="phone"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{L.phone}</FormLabel>
          <FormControl>
            <Input
              placeholder="+1 (555) 000-0000"
              className={inputClassFor(variant)}
              {...field}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function LeadWhatsappField({ form, variant }: FieldProps) {
  return (
    <FormField
      control={form.control}
      name="whatsapp"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{L.whatsapp}</FormLabel>
          <FormControl>
            <Input
              placeholder="+1 (555) 000-0000"
              className={inputClassFor(variant)}
              {...field}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function LeadSourceField({ form, variant }: FieldProps) {
  return (
    <FormField
      control={form.control}
      name="source"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{L.source}</FormLabel>
          <Select onValueChange={field.onChange} value={field.value}>
            <FormControl>
              <SelectTrigger className={inputClassFor(variant)}>
                <SelectValue placeholder="Select source" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {leadSourceValues.map((value) => (
                <SelectItem key={value} value={value}>
                  {leadSourceLabels[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function LeadTagsField({ form, variant }: FieldProps) {
  const isMobile = variant === 'mobile';
  return (
    <FormField
      control={form.control}
      name="tags"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{L.tags}</FormLabel>
          <FormControl>
            <div
              className={cn(
                'flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-3 py-2 shadow-xs',
                isMobile &&
                  'min-h-[44px] rounded-lg border-[#E5E5EA] shadow-none'
              )}
            >
              {field.value?.map((tag: string) => (
                <TagsValue
                  key={tag}
                  onRemove={() =>
                    field.onChange(
                      field.value?.filter((t: string) => t !== tag)
                    )
                  }
                >
                  {tag}
                </TagsValue>
              ))}
              <input
                className="min-w-[120px] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                placeholder={
                  field.value?.length
                    ? 'Add another...'
                    : 'Type a tag and press Enter...'
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const value = e.currentTarget.value.trim();
                    if (value && !field.value?.includes(value)) {
                      field.onChange([...(field.value || []), value]);
                      e.currentTarget.value = '';
                    }
                  }
                }}
              />
            </div>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function LeadNotesField({ form, variant }: FieldProps) {
  const isMobile = variant === 'mobile';
  return (
    <FormField
      control={form.control}
      name="notes"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{L.notes}</FormLabel>
          <FormControl>
            <Textarea
              placeholder="Add any additional notes about this client..."
              className={cn('resize-none', isMobile && MOBILE_TEXTAREA_CLASS)}
              rows={3}
              {...field}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/**
 * The three consent checkboxes and the sentence that explains them. One
 * component rather than three, because the explanation is not optional: a bare
 * "Email / SMS / Voice Calls" row does not tell an operator what they are
 * recording.
 */
export function LeadConsentFields({ form }: FieldProps) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Contact Consent</p>
      <p className="text-xs text-muted-foreground">
        Select the channels this client has consented to be contacted on.
      </p>
      <div className="flex flex-wrap gap-6">
        <FormField
          control={form.control}
          name="consentEmail"
          render={({ field }) => (
            <FormItem className="flex items-center gap-2 space-y-0">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
              <FormLabel className="font-normal">{L.consentEmail}</FormLabel>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="consentSms"
          render={({ field }) => (
            <FormItem className="flex items-center gap-2 space-y-0">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
              <FormLabel className="font-normal">{L.consentSms}</FormLabel>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="consentVoice"
          render={({ field }) => (
            <FormItem className="flex items-center gap-2 space-y-0">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
              <FormLabel className="font-normal">{L.consentVoice}</FormLabel>
            </FormItem>
          )}
        />
      </div>
    </div>
  );
}

interface CreateLeadFormFieldsProps {
  form: UseFormReturn<CreateLeadFormValues>;
  variant?: CreateLeadFieldVariant;
}

/**
 * The dialog / mobile-funnel composition of the fields above — unchanged
 * markup, now assembled from the same components the `/create/customer` editor
 * renders.
 */
export function CreateLeadFormFields({
  form,
  variant = 'dialog',
}: CreateLeadFormFieldsProps) {
  const isMobile = variant === 'mobile';
  const gridClass = isMobile
    ? 'grid grid-cols-1 gap-4 sm:grid-cols-2'
    : 'grid grid-cols-2 gap-4';

  return (
    <div className="space-y-4">
      <div className={gridClass}>
        <LeadFirstNameField form={form} variant={variant} />
        <LeadLastNameField form={form} variant={variant} />
      </div>

      <LeadEmailField form={form} variant={variant} />

      <div className={gridClass}>
        <LeadPhoneField form={form} variant={variant} />
        <LeadWhatsappField form={form} variant={variant} />
      </div>

      <LeadSourceField form={form} variant={variant} />
      <LeadTagsField form={form} variant={variant} />
      <LeadNotesField form={form} variant={variant} />

      <Separator />

      <LeadConsentFields form={form} variant={variant} />
    </div>
  );
}
