'use client';

import { formKindLabels, formKindValues } from '@borradh-workspace/labels';
import type { FormKind } from '@borradh-workspace/labels';
import { useNavigate } from '@tanstack/react-router';
import { ClipboardList, MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';
import { ListPage } from '@/components/app/list-page';
import type { ListColumn } from '@/components/app/list-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

import {
  type FormTemplate,
  deleteFormTemplate,
  isInputField,
  useFormTemplates,
} from '../fixtures';

type KindFilter = FormKind | 'all';

/**
 * The template library — intake questionnaires, consent documents and clinical
 * note templates, which are one thing (docs/handoffs/portal.md §2.8) and so are
 * one list with a kind filter rather than three pages.
 *
 * Rows are FIXTURES. See `../fixtures.ts`.
 */
export function FormTemplatesPage() {
  const templates = useFormTemplates();
  const [kind, setKind] = useState<KindFilter>('all');
  const [search, setSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<FormTemplate | null>(null);
  const navigate = useNavigate();

  const open = (formId: string) =>
    void navigate({
      params: { formId },
      to: '/dashboard/settings/form-templates/$formId',
    });

  const term = search.trim().toLowerCase();
  const rows = templates.filter((template) => {
    if (kind !== 'all' && template.kind !== kind) return false;
    if (!term) return true;
    return template.name.toLowerCase().includes(term);
  });

  const columns: ListColumn<FormTemplate>[] = [
    {
      cell: (template) => (
        <div>
          <div className="font-medium">{template.name}</div>
          {template.description && (
            <div className="hidden max-w-[46ch] truncate text-muted-foreground text-xs md:block">
              {template.description}
            </div>
          )}
        </div>
      ),
      header: 'Name',
      id: 'name',
      mobile: 'primary',
    },
    {
      cell: (template) => (
        <Badge variant="secondary">{formKindLabels[template.kind]}</Badge>
      ),
      header: 'Type',
      id: 'kind',
      mobile: 'secondary',
    },
    {
      cell: (template) => {
        // Section headings are not questions, so counting them would overstate
        // what the patient (or clinician) is actually asked.
        const questions = template.fields.filter((field) =>
          isInputField(field.type)
        ).length;
        return `${questions} ${questions === 1 ? 'field' : 'fields'}`;
      },
      header: 'Fields',
      id: 'fields',
      mobile: 'trailing',
    },
    {
      cell: (template) =>
        template.isActive ? (
          <Badge variant="outline">Active</Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Inactive
          </Badge>
        ),
      header: 'Status',
      id: 'status',
    },
  ];

  return (
    <>
      <title>Form templates | Borradh</title>

      <ListPage<FormTemplate>
        config={{
          columns,
          description:
            'Intake questionnaires, consent documents and clinical note templates.',
          empty: {
            action: term || kind !== 'all' ? <span /> : undefined,
            description:
              term || kind !== 'all'
                ? 'Try a different search or filter.'
                : 'Create a template to start collecting answers.',
            icon: ClipboardList,
            title:
              term || kind !== 'all'
                ? 'No matching templates'
                : 'No templates yet',
          },
          filters: (
            <Tabs
              onValueChange={(value) => setKind(value as KindFilter)}
              value={kind}
            >
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                {formKindValues.map((value) => (
                  <TabsTrigger key={value} value={value}>
                    {formKindLabels[value]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ),
          onRowClick: (template) => open(template.id),
          onSearchChange: setSearch,
          primaryAction: {
            label: 'New template',
            mobileLabel: 'New',
            onClick: () => open('new'),
          },
          rowActions: (template) => (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={`Actions for ${template.name}`}
                  size="icon"
                  variant="ghost"
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => open(template.id)}>
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setDeleteTarget(template)}
                  variant="destructive"
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ),
          rowKey: (template) => template.id,
          rows,
          search,
          searchPlaceholder: 'Search templates…',
          title: 'Form templates',
        }}
      />

      <ConfirmDeleteDialog
        description="Submissions already made against this template keep their own snapshot, so past answers stay readable. The template stops being available for new sends."
        onConfirm={() => {
          if (deleteTarget) {
            deleteFormTemplate(deleteTarget.id);
            toast.success('Template deleted');
          }
          setDeleteTarget(null);
        }}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(null);
        }}
        open={!!deleteTarget}
        title={<>Delete &ldquo;{deleteTarget?.name}&rdquo;?</>}
      />
    </>
  );
}
