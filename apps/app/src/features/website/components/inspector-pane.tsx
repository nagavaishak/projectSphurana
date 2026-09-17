import { Info } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
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

import type { Block, MicrositePage } from '../api/types';
import {
  BLOCK_LABELS,
  type BlockFieldDescriptor,
  blockTitle,
  fieldsFor,
  isDataBoundBlock,
  variantsFor,
} from '../lib/block-fields';

interface InspectorPaneProps {
  page: MicrositePage | null;
  block: Block | null;
  onUpdateProps: (patch: Record<string, unknown>) => void;
  onUpdateVariant: (variant: string) => void;
  isSaving: boolean;
}

/**
 * Manual editing — the escape hatch from the conversation.
 *
 * Fixing a typo should not require a prompt, a model call or a wait. Every save
 * here is still a revision (§5), so a manual edit is as undoable as an agent
 * turn and shows up in the same history.
 *
 * Props are sent as a PATCH of the single changed field, never the whole props
 * object (§2). Fields commit on blur / Enter rather than per keystroke — one
 * revision per edit, not one per character.
 */
export function InspectorPane({
  page,
  block,
  onUpdateProps,
  onUpdateVariant,
  isSaving,
}: InspectorPaneProps) {
  if (!block || !page) {
    return (
      <div className="flex h-full flex-col border-l bg-background">
        <InspectorHeader title="Inspector" subtitle={null} />
        <div className="p-4 text-sm text-muted-foreground">
          Select a section in the canvas to edit it directly, or ask for a
          change in the prompt panel.
        </div>
      </div>
    );
  }

  const props = block.props as Record<string, unknown>;
  const variants = variantsFor(block.type);

  return (
    <div className="flex h-full min-h-0 flex-col border-l bg-background">
      <InspectorHeader
        title={blockTitle(block)}
        subtitle={`${BLOCK_LABELS[block.type]} · ${page.title}`}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {isDataBoundBlock(block.type) ? (
          <p className="mb-4 flex gap-2 rounded-md bg-muted p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            This section shows live business data. Edit the services, team or
            hours themselves in the dashboard — these settings only choose what
            is shown.
          </p>
        ) : null}

        <FieldGroup>
          {variants.length > 1 ? (
            <Field>
              <FieldLabel htmlFor="block-variant">Layout</FieldLabel>
              <Select
                value={block.variant}
                onValueChange={onUpdateVariant}
                disabled={isSaving}
              >
                <SelectTrigger id="block-variant">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {variants.map((variant) => (
                    <SelectItem key={variant} value={variant}>
                      {variant}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          {fieldsFor(block.type).map(({ key, field }) => (
            <InspectorField
              key={`${block.id}:${key}`}
              name={key}
              field={field}
              value={props[key]}
              disabled={isSaving}
              onCommit={(next) => onUpdateProps({ [key]: next })}
            />
          ))}
        </FieldGroup>
      </div>
    </div>
  );
}

function InspectorHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string | null;
}) {
  return (
    <div className="border-b px-4 py-3">
      <h2 className="truncate text-sm font-semibold">{title}</h2>
      {subtitle ? (
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      ) : null}
    </div>
  );
}

interface InspectorFieldProps {
  name: string;
  field: BlockFieldDescriptor;
  value: unknown;
  disabled: boolean;
  onCommit: (value: unknown) => void;
}

function InspectorField({
  name,
  field,
  value,
  disabled,
  onCommit,
}: InspectorFieldProps) {
  const id = `field-${name}`;

  if (field.kind === 'boolean') {
    return (
      <Field orientation="horizontal">
        <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
        <Switch
          id={id}
          disabled={disabled}
          checked={value === true}
          onCheckedChange={(checked) => onCommit(checked)}
        />
        {field.description ? (
          <FieldDescription>{field.description}</FieldDescription>
        ) : null}
      </Field>
    );
  }

  if (field.kind === 'select') {
    return (
      <Field>
        <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
        <Select
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onValueChange={(next) => onCommit(next)}
        >
          <SelectTrigger id={id}>
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {field.description ? (
          <FieldDescription>{field.description}</FieldDescription>
        ) : null}
      </Field>
    );
  }

  return (
    <TextLikeField
      id={id}
      field={field}
      value={value}
      disabled={disabled}
      onCommit={onCommit}
    />
  );
}

/**
 * Text, textarea, markdown, number, list and asset-id fields.
 *
 * Local state while typing, commit on blur or Enter — the network write is a
 * revision, so per-keystroke saving would bury real turns under hundreds of
 * one-character versions.
 */
function TextLikeField({
  id,
  field,
  value,
  disabled,
  onCommit,
}: {
  id: string;
  field: BlockFieldDescriptor;
  value: unknown;
  disabled: boolean;
  onCommit: (value: unknown) => void;
}) {
  const initial = toEditableString(field.kind, value);
  const [draft, setDraft] = useState(initial);
  const [dirty, setDirty] = useState(false);

  // Re-sync when the document changes underneath (an agent turn, an undo) —
  // unless the user is mid-edit, which we must not clobber.
  useEffect(() => {
    if (!dirty) setDraft(initial);
  }, [initial, dirty]);

  const commit = () => {
    if (!dirty) return;
    setDirty(false);
    onCommit(fromEditableString(field.kind, draft));
  };

  const multiline = field.kind === 'textarea' || field.kind === 'markdown';

  return (
    <Field>
      <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
      {multiline ? (
        <Textarea
          id={id}
          value={draft}
          disabled={disabled}
          rows={field.kind === 'markdown' ? 8 : 3}
          placeholder={field.placeholder}
          onChange={(event) => {
            setDirty(true);
            setDraft(event.target.value);
          }}
          onBlur={commit}
        />
      ) : (
        <Input
          id={id}
          value={draft}
          disabled={disabled}
          type={field.kind === 'number' ? 'number' : 'text'}
          placeholder={field.placeholder}
          onChange={(event) => {
            setDirty(true);
            setDraft(event.target.value);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            }
          }}
        />
      )}
      {field.description ? (
        <FieldDescription>{field.description}</FieldDescription>
      ) : null}
      {dirty ? (
        <FieldDescription>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={commit}
            disabled={disabled}
          >
            Save change
          </Button>
        </FieldDescription>
      ) : null}
    </Field>
  );
}

export function toEditableString(kind: string, value: unknown): string {
  if (value === undefined || value === null) return '';
  if (kind === 'stringList' && Array.isArray(value)) return value.join(', ');
  return String(value);
}

export function fromEditableString(kind: string, raw: string): unknown {
  const trimmed = raw.trim();
  if (kind === 'number') {
    if (trimmed === '') return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (kind === 'stringList') {
    const items = trimmed
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    return items.length > 0 ? items : undefined;
  }
  return trimmed === '' ? undefined : raw;
}
