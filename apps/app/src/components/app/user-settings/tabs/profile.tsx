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
import {
  type UpdateUserFormValues,
  updateUserForm,
  updateUserFormDefaultValues,
  updateUserFormSchema,
  useUpdateUser,
} from '@/features/user/api/update-user';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';

/** Labels come from the form declaration — see `update-user.form`. */
const L = updateUserForm.labels;

export default function ProfileTab({
  className,
  onCancel,
  ...props
}: React.ComponentProps<'form'> & { onCancel?: () => void }) {
  const { data, isLoading: isUserLoading, error: userError } = useSession();
  const user = data?.user;
  const { execute: updateUser, isExecuting: isUpdating } = useUpdateUser(
    user?.id ?? ''
  );

  const form = useForm<UpdateUserFormValues>({
    resolver: zodResolver(updateUserFormSchema),
    defaultValues: updateUserFormDefaultValues,
  });

  useEffect(() => {
    if (user) {
      form.reset({ name: user.name ?? '' });
    }
  }, [user, form]);

  async function onSubmit(values: UpdateUserFormValues) {
    updateUser(values);
  }

  if (isUserLoading) {
    return (
      <div className={cn('flex flex-col px-6 py-4 gap-6', className)}>
        <div className="animate-pulse space-y-6">
          <div className="h-12 bg-muted rounded" />
          <div className="h-12 bg-muted rounded" />
        </div>
      </div>
    );
  }

  if (userError) {
    return (
      <div className={cn('flex flex-col px-6 py-4 gap-6', className)}>
        <div className="text-destructive">
          Error loading user data: {userError.message}
        </div>
      </div>
    );
  }

  return (
    <form
      className={cn('flex flex-col px-6 py-4', className)}
      onSubmit={form.handleSubmit(onSubmit)}
      {...props}
    >
      <div className="space-y-0">
        {/* Name Field */}
        <Controller
          name="name"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field
              orientation="horizontal"
              className="py-4"
              data-invalid={fieldState.invalid}
            >
              <div className="flex-1">
                <FieldLabel htmlFor={field.name} className="font-medium">
                  {L.name}
                </FieldLabel>
                <FieldDescription>
                  Provide your full name for identification
                </FieldDescription>
              </div>
              <div className="w-48">
                <Input
                  {...field}
                  id={field.name}
                  type="text"
                  placeholder="Your name"
                  aria-invalid={fieldState.invalid}
                  autoComplete="name"
                />
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </div>
            </Field>
          )}
        />

        <Separator />

        {/* Email — display only. Not a form field: it is never submitted, and
            the API has no route to change it from here. */}
        <Field orientation="horizontal" className="py-4">
          <div className="flex-1">
            <FieldLabel htmlFor="email" className="font-medium">
              Email
            </FieldLabel>
            <FieldDescription>
              Your email address cannot be changed
            </FieldDescription>
          </div>
          <div className="w-48">
            <Input
              id="email"
              disabled
              type="email"
              autoComplete="email"
              value={user?.email ?? ''}
              readOnly
            />
          </div>
        </Field>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-4">
        <Button type="submit" disabled={isUpdating}>
          {isUpdating ? 'Saving...' : 'Save Changes'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
