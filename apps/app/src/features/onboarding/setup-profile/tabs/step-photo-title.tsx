import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Camera } from 'lucide-react';
import { useRef } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';

interface StepPhotoTitleProps {
  // biome-ignore lint/suspicious/noExplicitAny: Form type flexibility needed
  form: UseFormReturn<any>;
  existingPhoto?: string | null;
}

export function StepPhotoTitle({ form, existingPhoto }: StepPhotoTitleProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoFile = form.watch('photo') as File | null | undefined;
  const previewUrl = photoFile ? URL.createObjectURL(photoFile) : existingPhoto;
  const name = form.watch('name') || '';

  return (
    <FieldGroup className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Set up your profile</h1>
        <p className="text-muted-foreground">
          Add a photo and title so clients know who they&apos;re booking with.
        </p>
      </div>

      {/* Photo upload */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          className="relative"
          onClick={() => fileInputRef.current?.click()}
        >
          <Avatar className="h-20 w-20">
            {previewUrl && <AvatarImage src={previewUrl} alt={name} />}
            <AvatarFallback className="text-lg">
              {name ? name[0]?.toUpperCase() : '?'}
            </AvatarFallback>
          </Avatar>
          <div className="absolute right-0 bottom-0 rounded-full border-2 border-background bg-primary p-1">
            <Camera className="h-3 w-3 text-primary-foreground" />
          </div>
        </button>
        <div className="flex flex-col gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            {previewUrl ? 'Change photo' : 'Upload photo'}
          </Button>
          <p className="text-xs text-muted-foreground">
            JPG, PNG or WebP. Max 5MB.
          </p>
        </div>
        <Controller
          name="photo"
          control={form.control}
          render={({ field }) => (
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) field.onChange(file);
              }}
            />
          )}
        />
      </div>

      {/* Title input */}
      <Controller
        name="title"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={field.name}>Your title / role</FieldLabel>
            <Input
              {...field}
              id={field.name}
              placeholder="e.g. Senior Stylist, Lead Therapist"
              aria-invalid={fieldState.invalid}
            />
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </Field>
        )}
      />
    </FieldGroup>
  );
}
