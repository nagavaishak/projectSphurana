import {
  type StylePreference,
  contentBatchStatusLabels,
  stylePreferenceLabels,
  stylePreferenceValues,
} from '@borradh-workspace/api-client/types';
import { zodResolver } from '@hookform/resolvers/zod';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Loader2, Trash2 } from 'lucide-react';

import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';
import { PageShell } from '@/components/app/page-shell';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import {
  useDeleteCurrentBatch,
  useGetCurrentBatch,
} from '@/features/content-batches';
import {
  useActiveOrganization,
  useGetOrganization,
  useGetOrganizationBrand,
  useUpdateOrganization,
} from '@/features/organization';
import {
  updateOrganizationFields,
  updateOrganizationForm,
} from '@/features/organization/api/update-organization/update-organization.form';
import { useUploadImage } from '@/features/upload';
import { extractColorsFromImage } from '@/lib/extract-colors';

export const Route = createFileRoute('/_authed/dashboard/settings/style')({
  component: StyleSettingsPage,
});

const hexColor = /^#[0-9A-Fa-f]{6}$/;

// This route OWNS the logo, the brand colours and the generated-content
// defaults. Its schema is sliced out of the one org-settings declaration, so the
// colours cannot validate differently here and in the dialog's branding tab.
// (`videoMusicVolume` is stored on a 0-1 scale to match the per-video volume.)
const F = updateOrganizationFields;

const styleSettingsSchema = z.object({
  logo: F.logo.schema,
  primaryColor: F.primaryColor.schema,
  secondaryColor: F.secondaryColor.schema,
  videoMusicVolume: F.videoMusicVolume.schema,
  stylePreference: F.stylePreference.schema,
  brandStyleGuide: F.brandStyleGuide.schema,
});

type StyleSettingsValues = z.infer<typeof styleSettingsSchema>;

function ColorInput({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
}) {
  const [inputValue, setInputValue] = useState(value);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    if (hexColor.test(newValue)) {
      onChange(newValue);
    }
  };

  return (
    <div className="relative flex items-center">
      <Popover>
        <PopoverTrigger asChild>
          <button
            aria-label="Pick color"
            className="absolute left-2 h-5 w-5 rounded border border-input"
            style={{ backgroundColor: value || '#000000' }}
            type="button"
          />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-3">
          <input
            className="h-32 w-32 cursor-pointer border-0 p-0"
            onChange={(e) => {
              setInputValue(e.target.value.toUpperCase());
              onChange(e.target.value.toUpperCase());
            }}
            type="color"
            value={value || '#000000'}
          />
        </PopoverContent>
      </Popover>
      <Input
        className="pl-10"
        id={id}
        onChange={handleChange}
        placeholder="#000000"
        value={inputValue}
      />
    </div>
  );
}

// Exported for the update-organization payload-parity test (drives this
// surface's own UI against the org-settings branding tab).
export function StyleSettingsCard() {
  const L = updateOrganizationForm.labels;
  const { data: activeOrg } = useActiveOrganization();
  const { brand, isLoading: isBrandLoading } = useGetOrganizationBrand(
    activeOrg?.id ?? ''
  );
  const { organization, isLoading: isOrgLoading } = useGetOrganization(
    activeOrg?.id ?? ''
  );
  const { execute: updateOrganization, isExecuting } = useUpdateOrganization();
  const { uploadAsync: uploadImage } = useUploadImage({
    purpose: 'profile',
    showToast: false,
  });

  const [newFile, setNewFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<StyleSettingsValues>({
    resolver: zodResolver(styleSettingsSchema),
    defaultValues: {
      logo: '',
      primaryColor: '#000000',
      secondaryColor: '#FFCC00',
      videoMusicVolume: 0.05,
      stylePreference: 'clean',
      brandStyleGuide: '',
    },
  });

  const { reset } = form;
  useEffect(() => {
    if (activeOrg || brand || organization) {
      // Legacy orgs from migration 0016 carry an integer 50 in this column
      // (pre-0017 it was a 0-100 percentage). Anything outside 0-1 is stale
      // data — fall back to the per-video default of 0.05.
      const rawMusicVolume = organization?.videoMusicVolume;
      const videoMusicVolume =
        rawMusicVolume != null && rawMusicVolume >= 0 && rawMusicVolume <= 1
          ? rawMusicVolume
          : 0.05;

      reset({
        logo: activeOrg?.logo ?? '',
        primaryColor: brand?.primaryColor ?? '#000000',
        secondaryColor: brand?.secondaryColor ?? '#FFCC00',
        videoMusicVolume,
        stylePreference:
          (organization?.stylePreference as StylePreference | null) ?? 'clean',
        brandStyleGuide: organization?.brandStyleGuide ?? '',
      });
    }
  }, [activeOrg, brand, organization, reset]);

  async function handleFileSelected(file: File | null) {
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const colors = await extractColorsFromImage(file);
      const currentPrimary = form.getValues('primaryColor');
      if (!currentPrimary || currentPrimary === '#000000') {
        form.setValue('primaryColor', colors.dominantColor);
      }
    } catch {
      // best-effort colour extraction
    }
    setNewFile(file);
    form.setValue('logo', URL.createObjectURL(file), { shouldDirty: true });
  }

  async function onSubmit(values: StyleSettingsValues) {
    let logo = values.logo;
    if (newFile) {
      const result = await uploadImage(newFile);
      logo = result.url;
      form.setValue('logo', logo);
    }
    // Pass raw form values as intent; the shared builder normalises the logo
    // (empty → drop) and the brand style guide (empty → null), matching the
    // branding tab's brand-colour handling exactly.
    await updateOrganization({
      logo,
      primaryColor: values.primaryColor,
      secondaryColor: values.secondaryColor,
      videoMusicVolume: values.videoMusicVolume,
      stylePreference: values.stylePreference,
      brandStyleGuide: values.brandStyleGuide,
    });
    setNewFile(null);
  }

  const isLoading = (isBrandLoading || isOrgLoading) && !brand && !organization;
  if (isLoading) {
    return <Skeleton className="h-96 w-full rounded-xl" />;
  }

  return (
    <form noValidate onSubmit={form.handleSubmit(onSubmit)}>
      <Card>
        <CardHeader>
          <CardTitle>Style</CardTitle>
          <CardDescription>
            Your logo, brand colours, and defaults used across generated
            content.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="gap-6">
            <Field className="gap-2">
              <FieldLabel htmlFor="logo">{L.logo}</FieldLabel>
              <div className="flex items-center gap-3">
                <Avatar
                  className="size-12 cursor-pointer"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <AvatarImage src={form.watch('logo') ?? ''} />
                  <AvatarFallback>
                    {activeOrg?.name?.charAt(0).toUpperCase() ?? 'O'}
                  </AvatarFallback>
                </Avatar>
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Upload
                </Button>
                <input
                  accept="image/png,image/jpeg"
                  className="hidden"
                  id="logo"
                  onChange={(e) =>
                    handleFileSelected(e.target.files?.[0] ?? null)
                  }
                  ref={fileInputRef}
                  type="file"
                />
              </div>
            </Field>

            <Controller
              control={form.control}
              name="primaryColor"
              render={({ field, fieldState }) => (
                <Field className="gap-2" data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>{L.primaryColor}</FieldLabel>
                  <ColorInput
                    id={field.name}
                    onChange={field.onChange}
                    value={field.value ?? '#000000'}
                  />
                  {fieldState.error ? (
                    <FieldError errors={[fieldState.error]} />
                  ) : null}
                </Field>
              )}
            />

            <Controller
              control={form.control}
              name="secondaryColor"
              render={({ field, fieldState }) => (
                <Field className="gap-2" data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>
                    {L.secondaryColor}
                  </FieldLabel>
                  <ColorInput
                    id={field.name}
                    onChange={field.onChange}
                    value={field.value ?? '#FFCC00'}
                  />
                  {fieldState.error ? (
                    <FieldError errors={[fieldState.error]} />
                  ) : null}
                </Field>
              )}
            />

            <Controller
              control={form.control}
              name="videoMusicVolume"
              render={({ field, fieldState }) => (
                <Field className="gap-2" data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>
                    {L.videoMusicVolume} — {Math.round(field.value * 100)}%
                  </FieldLabel>
                  <Slider
                    aria-label={L.videoMusicVolume}
                    id={field.name}
                    max={100}
                    min={0}
                    onValueChange={(v) => field.onChange(v[0] / 100)}
                    step={1}
                    value={[Math.round(field.value * 100)]}
                  />
                  <FieldDescription>
                    Background music volume relative to narration.
                  </FieldDescription>
                  {fieldState.error ? (
                    <FieldError errors={[fieldState.error]} />
                  ) : null}
                </Field>
              )}
            />

            <Controller
              control={form.control}
              name="stylePreference"
              render={({ field, fieldState }) => (
                <Field className="gap-2" data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>
                    {L.stylePreference}
                  </FieldLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger id={field.name}>
                      <SelectValue placeholder="Select a style" />
                    </SelectTrigger>
                    <SelectContent>
                      {stylePreferenceValues.map((value) => (
                        <SelectItem key={value} value={value}>
                          {stylePreferenceLabels[value]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    Whether generated graphics get a solid brand-colour border
                    (&ldquo;Basic&rdquo;) or sit edge-to-edge
                    (&ldquo;Clean&rdquo;).
                  </FieldDescription>
                  {fieldState.error ? (
                    <FieldError errors={[fieldState.error]} />
                  ) : null}
                </Field>
              )}
            />

            <Controller
              control={form.control}
              name="brandStyleGuide"
              render={({ field, fieldState }) => (
                <Field className="gap-2" data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>
                    {L.brandStyleGuide}
                  </FieldLabel>
                  <Textarea
                    id={field.name}
                    rows={10}
                    placeholder="Describe your brand's colours and how each is used (backgrounds, headings, accents, text), your typography, and overall visual style…"
                    value={field.value ?? ''}
                    onChange={field.onChange}
                  />
                  <FieldDescription>
                    The authority for colours, typography and the look of
                    generated graphics — it overrides the primary colour above.
                    Edit it after a rebrand, or clear it to fall back to your
                    primary colour.
                  </FieldDescription>
                  {fieldState.error ? (
                    <FieldError errors={[fieldState.error]} />
                  ) : null}
                </Field>
              )}
            />
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end">
          <Button
            disabled={isExecuting || !form.formState.isDirty}
            type="submit"
          >
            {isExecuting ? 'Saving...' : 'Save changes'}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

/**
 * Clear the latest content batch so a fresh one can be generated. Keeps the
 * generated graphics/videos and their posts — only the batch row is removed.
 * Also re-enables the planner's Bulk Create button.
 *
 * "Latest", not "this month's": batches are generated on demand, so an org can
 * hold several carrying the same month label. This resets whatever
 * `getCurrentBatch` is showing.
 */
function ContentBatchResetCard() {
  const { batch, items, isLoading } = useGetCurrentBatch();
  const { resetBulkContent, isResetting } = useDeleteCurrentBatch();
  const hasBatch = batch != null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Content batch</CardTitle>
        <CardDescription>
          Clear the latest content batch so you can generate a new one. Your
          generated graphics, videos and posts are kept — only the batch is
          removed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {isLoading
            ? 'Checking for a current batch…'
            : hasBatch
              ? `Current batch: ${batch.periodMonth} · ${contentBatchStatusLabels[batch.status]} · ${items.length} item${items.length === 1 ? '' : 's'}.`
              : 'No content batch — nothing to reset.'}
        </p>
      </CardContent>
      <CardFooter className="justify-end">
        <ConfirmDeleteDialog
          confirmLabel="Reset content batch"
          description="This removes the batch so you can generate a new one. Your generated graphics, videos and posts are kept — they stay in your library."
          isPending={isResetting}
          onConfirm={() => resetBulkContent()}
          title="Clear the latest batch?"
          trigger={
            <Button disabled={!hasBatch || isResetting} variant="destructive">
              {isResetting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Reset content batch
            </Button>
          }
        />
      </CardFooter>
    </Card>
  );
}

function StyleSettingsPage() {
  return (
    <PageShell
      className="flex flex-col gap-6 pt-10 pb-8"
      maxWidth="max-w-[960px]"
    >
      <title>Style | Borradh</title>
      <StyleSettingsCard />
      <ContentBatchResetCard />
    </PageShell>
  );
}
