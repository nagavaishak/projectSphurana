import { TagsValue } from '@/components/kibo-ui/tags';
import { Checkbox } from '@/components/ui/checkbox';
import {
  FormControl,
  FormDescription,
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
import {
  leadSourceLabels,
  leadSourceValues,
  leadStatusLabels,
  leadStatusValues,
} from '@borradh-workspace/api-client/types';
import { ClipboardList } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';
import type { LeadDetail } from '../../types';
import {
  type UpdateLeadFormValues,
  updateLeadForm,
} from './update-lead-schema';

/**
 * The labels come from the form declaration, not from literals here — the
 * contract harness locates each control by the same string, so the JSX and the
 * declaration cannot drift, and a control deleted from this file is caught.
 */
const L = updateLeadForm.labels;

interface LeadEditFieldsProps {
  form: UseFormReturn<UpdateLeadFormValues>;
  lead: LeadDetail;
}

/**
 * Editable lead fields, rendered inline in the lead detail sheet. The parent
 * owns the `<form>` element and submit handling so the Save button can live in
 * the sheet footer.
 */
export function LeadEditFields({ form, lead }: LeadEditFieldsProps) {
  return (
    <div className="space-y-4">
      {lead.source === 'meta_lead_form' && (
        <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3">
          <ClipboardList className="mt-0.5 size-4 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-sm font-medium">Lead form</p>
            <p className="text-sm text-muted-foreground">
              {lead.sourceLeadForm?.name || 'Unknown form'}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="firstName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{L.firstName}</FormLabel>
              <FormControl>
                <Input placeholder="John" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="lastName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{L.lastName}</FormLabel>
              <FormControl>
                <Input placeholder="Doe" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

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
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{L.phone}</FormLabel>
              <FormControl>
                <Input placeholder="+1 (555) 000-0000" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="whatsapp"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{L.whatsapp}</FormLabel>
              <FormControl>
                <Input placeholder="+1 (555) 000-0000" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="source"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{L.source}</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
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

        <FormField
          control={form.control}
          name="status"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{L.status}</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {leadStatusValues.map((value) => (
                    <SelectItem key={value} value={value}>
                      {leadStatusLabels[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={form.control}
        name="tags"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{L.tags}</FormLabel>
            <FormControl>
              <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-3 py-2 shadow-xs">
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

      <FormField
        control={form.control}
        name="notes"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{L.notes}</FormLabel>
            <FormControl>
              <Textarea
                placeholder="Add any additional notes about this client..."
                className="resize-none"
                rows={3}
                {...field}
              />
            </FormControl>
            <FormDescription>
              Only your team can see this. The customer never sees it.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      {/*
        `portalNote` — the note PUBLISHED to the customer's portal — is
        deliberately NOT here (ENG-791).
        
        It used to sit one field below the internal notes, in a whole-record
        form that every surface rebuilt from its own last-fetched snapshot of
        the lead. Saving anything on such a form re-sends the published note at
        whatever value that snapshot held, so an aftercare note could be
        silently reverted — or cleared outright — by someone editing a phone
        number. Two editors for one published field is the shape of that bug.
        
        It now has exactly one editor: the profile's Notes tab, where it saves
        on its own button, touching only its own key. Internal notes stay here
        because they are staff-only and this form is where you are already
        looking at them.
      */}
      <Separator />

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
    </div>
  );
}
