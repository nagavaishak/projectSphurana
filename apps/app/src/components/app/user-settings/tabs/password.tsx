'use client';

import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { useChangePassword } from '@/features/auth';
import { cn } from '@/lib/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
        'Password must contain at least one uppercase letter, one lowercase letter, and one number'
      ),
    confirmPassword: z.string().min(1, 'Please confirm your new password'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });

type PasswordFormValues = z.infer<typeof passwordSchema>;

export default function PasswordTab({
  className,
  onCancel,
}: {
  className?: string;
  onCancel?: () => void;
}) {
  const form = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  });

  const { changePassword, isChanging } = useChangePassword({
    onSuccess: () => form.reset(),
  });

  function onSubmit(values: PasswordFormValues) {
    changePassword({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
    });
  }

  return (
    <form
      className={cn('flex flex-col px-6 py-4', className)}
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <div className="space-y-0">
        {/* Current Password Field */}
        <Controller
          name="currentPassword"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field
              orientation="horizontal"
              className="py-4"
              data-invalid={fieldState.invalid}
            >
              <div className="flex-1">
                <FieldLabel htmlFor={field.name} className="font-medium">
                  Previous Password
                </FieldLabel>
                <FieldDescription>
                  Provide your full name for identification
                </FieldDescription>
              </div>
              <div className="w-48">
                <Input
                  {...field}
                  id={field.name}
                  type="password"
                  placeholder="Enter current password"
                  aria-invalid={fieldState.invalid}
                  autoComplete="current-password"
                />
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </div>
            </Field>
          )}
        />

        <Separator />

        {/* New Password Field */}
        <Controller
          name="newPassword"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field
              orientation="horizontal"
              className="py-4"
              data-invalid={fieldState.invalid}
            >
              <div className="flex-1">
                <FieldLabel htmlFor={field.name} className="font-medium">
                  New Password
                </FieldLabel>
                <FieldDescription>
                  Provide your full name for identification
                </FieldDescription>
              </div>
              <div className="w-48">
                <Input
                  {...field}
                  id={field.name}
                  type="password"
                  placeholder="Enter new password"
                  aria-invalid={fieldState.invalid}
                  autoComplete="new-password"
                />
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </div>
            </Field>
          )}
        />

        <Separator />

        {/* Confirm Password Field */}
        <Controller
          name="confirmPassword"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field
              orientation="horizontal"
              className="py-4"
              data-invalid={fieldState.invalid}
            >
              <div className="flex-1">
                <FieldLabel htmlFor={field.name} className="font-medium">
                  Confirm New Password
                </FieldLabel>
                <FieldDescription>
                  This changes your calendar timezone
                </FieldDescription>
              </div>
              <div className="w-48">
                <Input
                  {...field}
                  id={field.name}
                  type="password"
                  placeholder="Confirm new password"
                  aria-invalid={fieldState.invalid}
                  autoComplete="new-password"
                />
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </div>
            </Field>
          )}
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-4">
        <Button type="submit" disabled={isChanging}>
          {isChanging ? 'Saving...' : 'Change Password'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
