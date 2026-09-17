import { Link, createFileRoute } from '@tanstack/react-router';
import { Loader2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';
import { PageShell } from '@/components/app/page-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  type WhatsappTemplate,
  useRefreshWhatsappTemplates,
  useWhatsappTemplates,
  whatsappTemplateStatusLabels,
} from '@/features/campaigns';
import {
  useCreateWhatsAppTemplate,
  useDeleteWhatsAppTemplate,
  useListWhatsAppAccounts,
} from '@/features/integrations/api';

/**
 * `/dashboard/settings/message-templates` — manage the org's WhatsApp message
 * templates (list / create / delete / re-sync from Meta). Templates are
 * required to start WhatsApp conversations outside the 24-hour customer
 * service window (e.g. campaign sends) and go through Meta review.
 */
export const Route = createFileRoute(
  '/_authed/dashboard/settings/message-templates'
)({
  component: MessageTemplatesSettingsPage,
});

type TemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';

const STATUS_BADGE_VARIANT: Record<
  WhatsappTemplate['status'],
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  approved: 'default',
  pending: 'secondary',
  rejected: 'destructive',
  paused: 'outline',
  disabled: 'outline',
};

function MessageTemplatesSettingsPage() {
  const { accounts, isLoading: isLoadingAccounts } = useListWhatsAppAccounts();
  const activeAccount = accounts.find((account) => account.isActive);

  return (
    <PageShell className="pt-10 pb-8" maxWidth="max-w-[960px]">
      <title>Message templates | Borradh</title>

      <header className="space-y-1">
        <h2 className="font-semibold text-xl tracking-tight">
          Message templates
        </h2>
        <p className="text-muted-foreground text-sm">
          WhatsApp requires a pre-approved template to message clients outside
          the 24-hour reply window (campaign sends, reminders). Templates are
          reviewed by Meta before they can be used.
        </p>
      </header>

      {isLoadingAccounts ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : activeAccount ? (
        <TemplatesCard accountId={activeAccount.id} />
      ) : (
        <ConnectWhatsappEmptyState />
      )}
    </PageShell>
  );
}

// --- Not connected: point people at the integrations page ---

function ConnectWhatsappEmptyState() {
  return (
    <Card>
      <CardContent>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon" className="bg-transparent">
              <img src="/wa-icon.svg" alt="WhatsApp" className="size-10" />
            </EmptyMedia>
            <EmptyTitle>No WhatsApp account connected</EmptyTitle>
            <EmptyDescription>
              Connect a WhatsApp Business account to create and manage message
              templates for campaign sends.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              asChild
              size="lg"
              className="w-full max-w-xs bg-red-600 text-white hover:bg-red-700"
            >
              <Link to="/dashboard/settings/integrations">
                <img src="/wa-icon.svg" alt="" className="size-5" />
                <Pencil className="size-4" />
                Connect WhatsApp
              </Link>
            </Button>
          </EmptyContent>
        </Empty>
      </CardContent>
    </Card>
  );
}

// --- Connected: template list + create / delete / refresh ---

function TemplatesCard({ accountId }: { accountId: string }) {
  const { templates, isLoading } = useWhatsappTemplates();
  const { refreshTemplates, isRefreshing } = useRefreshWhatsappTemplates();

  const [createOpen, setCreateOpen] = useState(false);
  const [templateToDelete, setTemplateToDelete] =
    useState<WhatsappTemplate | null>(null);

  // Create/delete happen against Meta; the campaigns-side template cache is a
  // DB sync, so re-pull from Meta afterwards to reflect the change.
  const { deleteTemplate, isDeleting } = useDeleteWhatsAppTemplate(accountId, {
    onSuccess: () => {
      setTemplateToDelete(null);
      refreshTemplates();
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>Templates</CardTitle>
            <CardDescription>
              Synced from your WhatsApp Business account.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refreshTemplates()}
              disabled={isRefreshing}
            >
              <RefreshCw
                className={isRefreshing ? 'size-4 animate-spin' : 'size-4'}
              />
              Refresh from Meta
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              New template
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : templates.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground text-sm">
            No templates yet. Create one to send WhatsApp campaigns, or refresh
            if you already have templates in Meta Business Manager.
          </p>
        ) : (
          <ul className="space-y-2">
            {templates.map((template) => (
              <li
                key={template.id}
                className="flex items-start justify-between gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-sm">{template.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {template.languageCode}
                    </span>
                    {template.category && (
                      <Badge variant="outline">
                        {template.category.toLowerCase()}
                      </Badge>
                    )}
                    <Badge variant={STATUS_BADGE_VARIANT[template.status]}>
                      {whatsappTemplateStatusLabels[template.status]}
                    </Badge>
                  </div>
                  <p className="whitespace-pre-wrap text-muted-foreground text-xs">
                    {template.body}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete template ${template.name}`}
                  onClick={() => setTemplateToDelete(template)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <CreateTemplateDialog
        accountId={accountId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => refreshTemplates()}
      />

      <ConfirmDeleteDialog
        description="This removes the template from your WhatsApp Business account. Campaigns using it will no longer be able to send."
        isPending={isDeleting}
        onConfirm={() => {
          if (templateToDelete) deleteTemplate(templateToDelete.name);
        }}
        onOpenChange={(open) => {
          if (!open) setTemplateToDelete(null);
        }}
        open={templateToDelete !== null}
        title={<>Delete &ldquo;{templateToDelete?.name}&rdquo;?</>}
      />
    </Card>
  );
}

// --- Create dialog ---

interface CreateTemplateDialogProps {
  accountId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

function CreateTemplateDialog({
  accountId,
  open,
  onOpenChange,
  onCreated,
}: CreateTemplateDialogProps) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<TemplateCategory>('MARKETING');
  const [language, setLanguage] = useState('en_US');
  const [body, setBody] = useState('');

  const { createTemplate, isCreating } = useCreateWhatsAppTemplate(accountId, {
    onSuccess: () => {
      setName('');
      setBody('');
      onOpenChange(false);
      onCreated();
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New message template</DialogTitle>
          <DialogDescription>
            Templates are submitted to Meta for review; approval usually takes a
            few minutes to a few hours.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field>
            <FieldLabel>Template name</FieldLabel>
            <Input
              placeholder="e.g. appointment_reminder"
              value={name}
              onChange={(e) =>
                setName(
                  e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_')
                )
              }
            />
            <p className="text-muted-foreground text-xs">
              Lowercase letters, numbers, and underscores only.
            </p>
          </Field>

          <Field>
            <FieldLabel>Category</FieldLabel>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as TemplateCategory)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MARKETING">Marketing</SelectItem>
                <SelectItem value="UTILITY">Utility</SelectItem>
                <SelectItem value="AUTHENTICATION">Authentication</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel>Language</FieldLabel>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en_US">English (US)</SelectItem>
                <SelectItem value="en_GB">English (UK)</SelectItem>
                <SelectItem value="es">Spanish</SelectItem>
                <SelectItem value="fr">French</SelectItem>
                <SelectItem value="de">German</SelectItem>
                <SelectItem value="pt_BR">Portuguese (BR)</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel>Body</FieldLabel>
            <Textarea
              placeholder="e.g. Hi {{1}}, your appointment is confirmed for {{2}}."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
            />
            <p className="text-muted-foreground text-xs">
              Use {'{{1}}'}, {'{{2}}'}, etc. for variables.
            </p>
          </Field>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isCreating}
          >
            Cancel
          </Button>
          <Button
            onClick={() => createTemplate({ name, category, language, body })}
            disabled={isCreating || !name.trim() || !body.trim()}
          >
            {isCreating && <Loader2 className="size-4 animate-spin" />}
            Create template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
