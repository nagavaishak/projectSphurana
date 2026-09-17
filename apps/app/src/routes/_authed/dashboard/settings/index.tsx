import { zodResolver } from '@hookform/resolvers/zod';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Camera } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

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
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useChangePassword } from '@/features/auth';
import { ImageCropDialog, useUploadImage } from '@/features/upload';
import { useDeleteAccount, useGetUser, useUpdateUser } from '@/features/user';
import {
  type UpdateUserFormValues,
  updateUserForm,
  updateUserFormDefaultValues,
  updateUserFormSchema,
} from '@/features/user/api/update-user';
import { useSession } from '@/lib/session';

export const Route = createFileRoute('/_authed/dashboard/settings/')({
  component: ProfileSettingsPage,
});

/** Labels come from the form declaration — see `update-user.form`. */
const L = updateUserForm.labels;

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
        'Must include an uppercase letter, a lowercase letter, and a number'
      ),
    confirmPassword: z.string().min(1, 'Please confirm your new password'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });

type PasswordInput = z.infer<typeof passwordSchema>;

function getInitials(value: string): string {
  const words = value.trim().split(/\s+/);
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
}

function ProfileCard() {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? '';
  const { user } = useGetUser(userId);
  const {
    execute: updateUser,
    executeAsync: updateUserAsync,
    isExecuting,
  } = useUpdateUser(userId);
  const { uploadAsync, isUploading } = useUploadImage({
    purpose: 'profile',
    showToast: false,
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [isSavingPhoto, setIsSavingPhoto] = useState(false);

  const form = useForm<UpdateUserFormValues>({
    resolver: zodResolver(updateUserFormSchema),
    defaultValues: updateUserFormDefaultValues,
  });

  const { reset } = form;
  useEffect(() => {
    if (user) {
      reset({ name: user.name });
    }
  }, [user, reset]);

  const displayName = user?.name ?? session?.user?.name ?? '';
  const displayEmail = user?.email ?? session?.user?.email ?? '';
  const avatar = user?.image ?? session?.user?.image ?? undefined;

  const handleCroppedPhoto = async (file: File) => {
    setPendingFile(null);
    setIsSavingPhoto(true);
    try {
      const { url } = await uploadAsync(file);
      await updateUserAsync({ image: url });
    } catch {
      // useUpdateUser surfaces its own error toast; uploadAsync failures fall
      // through here so the button just re-enables.
    } finally {
      setIsSavingPhoto(false);
    }
  };

  const photoBusy = isUploading || isSavingPhoto;

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) => updateUser(values))}
    >
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            Manage your personal profile and account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="gap-6">
            <div className="flex items-center gap-4">
              <button
                type="button"
                className="relative shrink-0 rounded-full"
                onClick={() => fileInputRef.current?.click()}
                disabled={photoBusy}
                aria-label="Change profile photo"
              >
                <Avatar className="size-16">
                  <AvatarImage alt={displayName} src={avatar} />
                  <AvatarFallback>
                    {getInitials(displayName || displayEmail || 'AC')}
                  </AvatarFallback>
                </Avatar>
                <span className="bg-primary border-background absolute -bottom-0.5 -right-0.5 rounded-full border-2 p-1">
                  <Camera className="text-primary-foreground size-3" />
                </span>
              </button>
              <div className="min-w-0">
                <p className="truncate font-medium">{displayName}</p>
                <p className="truncate text-muted-foreground text-sm">
                  {displayEmail}
                </p>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={photoBusy}
                >
                  {photoBusy ? 'Saving photo…' : 'Change photo'}
                </Button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                data-testid="profile-photo-input"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) setPendingFile(file);
                  e.target.value = '';
                }}
              />
            </div>

            <Controller
              control={form.control}
              name="name"
              render={({ field, fieldState }) => (
                <Field className="gap-2" data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>{L.name}</FieldLabel>
                  <Input
                    {...field}
                    aria-invalid={fieldState.invalid}
                    autoComplete="name"
                    id={field.name}
                    placeholder="Your name"
                  />
                  {fieldState.error ? (
                    <FieldError errors={[fieldState.error]} />
                  ) : null}
                </Field>
              )}
            />

            <Field className="gap-2">
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                autoComplete="email"
                disabled
                id="email"
                type="email"
                value={displayEmail}
              />
            </Field>
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

      <ImageCropDialog
        file={pendingFile}
        onCancel={() => setPendingFile(null)}
        onCropped={handleCroppedPhoto}
        description="Drag and resize the circle to frame your profile photo."
      />
    </form>
  );
}

function PasswordCard() {
  const form = useForm<PasswordInput>({
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

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) =>
        changePassword({
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
        })
      )}
    >
      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>
            Change the password you use to sign in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="gap-6">
            <Controller
              control={form.control}
              name="currentPassword"
              render={({ field, fieldState }) => (
                <Field className="gap-2" data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>Current password</FieldLabel>
                  <Input
                    {...field}
                    aria-invalid={fieldState.invalid}
                    autoComplete="current-password"
                    id={field.name}
                    type="password"
                  />
                  {fieldState.error ? (
                    <FieldError errors={[fieldState.error]} />
                  ) : null}
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="newPassword"
              render={({ field, fieldState }) => (
                <Field className="gap-2" data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>New password</FieldLabel>
                  <Input
                    {...field}
                    aria-invalid={fieldState.invalid}
                    autoComplete="new-password"
                    id={field.name}
                    type="password"
                  />
                  {fieldState.error ? (
                    <FieldError errors={[fieldState.error]} />
                  ) : null}
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="confirmPassword"
              render={({ field, fieldState }) => (
                <Field className="gap-2" data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>
                    Confirm new password
                  </FieldLabel>
                  <Input
                    {...field}
                    aria-invalid={fieldState.invalid}
                    autoComplete="new-password"
                    id={field.name}
                    type="password"
                  />
                  {fieldState.error ? (
                    <FieldError errors={[fieldState.error]} />
                  ) : null}
                </Field>
              )}
            />
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end">
          <Button disabled={isChanging} type="submit">
            {isChanging ? 'Saving...' : 'Change password'}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

function DeleteAccountCard() {
  const navigate = useNavigate();
  const { deleteAccount, isDeleting } = useDeleteAccount({
    onSuccess: () => navigate({ to: '/sign-in' }),
  });

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle>Delete account</CardTitle>
        <CardDescription>
          Permanently delete your account and all associated data. This cannot
          be undone.
        </CardDescription>
      </CardHeader>
      <CardFooter className="justify-end">
        <ConfirmDeleteDialog
          confirmLabel="Delete account"
          description="This permanently deletes your account and all associated data. This action cannot be undone."
          isPending={isDeleting}
          onConfirm={() => deleteAccount()}
          title="Delete your account?"
          trigger={
            <Button disabled={isDeleting} variant="destructive">
              {isDeleting ? 'Deleting...' : 'Delete account'}
            </Button>
          }
        />
      </CardFooter>
    </Card>
  );
}

function ProfileSettingsPage() {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? '';
  const { user, isLoading } = useGetUser(userId);

  return (
    <PageShell className="pt-10 pb-8" maxWidth="max-w-[960px]">
      <title>Settings | Borradh</title>
      {isLoading && !user ? (
        <>
          <Skeleton className="h-72 w-full rounded-xl" />
          <Skeleton className="h-96 w-full rounded-xl" />
          <Skeleton className="h-44 w-full rounded-xl" />
        </>
      ) : (
        <>
          <ProfileCard />
          <PasswordCard />
          <DeleteAccountCard />
        </>
      )}
    </PageShell>
  );
}
