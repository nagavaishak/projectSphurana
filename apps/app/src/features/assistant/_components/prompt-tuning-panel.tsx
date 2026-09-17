import { ChevronDown, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import {
  type PromptOverrides,
  usePromptConfig,
  usePromptPreview,
} from '@/features/assistant/api';

/**
 * Local prompt-tuning panel (uncommitted dev tool).
 *
 * Slides over the Claire chat and exposes the entire prompt surface — persona,
 * skill index, business context, every skill's fragment, and every tool's
 * description — seeded with current defaults. Edits are held in session-local
 * `overrides` (owned by the chat container) and sent with each message so
 * Claire's recommendation/tone/tool behaviour can be tuned live. A "build
 * full prompt" action assembles the exact prompt the next turn would send.
 *
 * Not gated and not committed — purely an operator refinement aid.
 */
export interface PromptTuningPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId?: string;
  overrides: PromptOverrides;
  onOverridesChange: (next: PromptOverrides) => void;
}

export function PromptTuningPanel({
  open,
  onOpenChange,
  conversationId,
  overrides,
  onOverridesChange,
}: PromptTuningPanelProps) {
  const { config, isLoading, isError } = usePromptConfig(conversationId, open);
  const { previewPrompt, isPreviewing, preview } = usePromptPreview();
  const [toolFilter, setToolFilter] = useState('');

  const loadedSet = useMemo(
    () => new Set(config?.loadedSkillIds ?? []),
    [config?.loadedSkillIds]
  );

  const modifiedCount =
    (overrides.persona !== undefined ? 1 : 0) +
    (overrides.skillIndex !== undefined ? 1 : 0) +
    (overrides.businessContext !== undefined ? 1 : 0) +
    Object.keys(overrides.skillFragments ?? {}).length +
    Object.keys(overrides.toolDescriptions ?? {}).length +
    (overrides.extraDirectives?.trim() ? 1 : 0);

  const setBlock = (
    key: 'persona' | 'skillIndex' | 'businessContext',
    value: string | undefined
  ) => onOverridesChange({ ...overrides, [key]: value });

  const setMapEntry = (
    mapKey: 'skillFragments' | 'toolDescriptions',
    entryKey: string,
    value: string | undefined
  ) => {
    const next = { ...(overrides[mapKey] ?? {}) };
    if (value === undefined) delete next[entryKey];
    else next[entryKey] = value;
    onOverridesChange({
      ...overrides,
      [mapKey]: Object.keys(next).length ? next : undefined,
    });
  };

  const resetAll = () => onOverridesChange({});

  const filteredTools = useMemo(() => {
    const tools = config?.tools ?? [];
    const q = toolFilter.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q)
    );
  }, [config?.tools, toolFilter]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
      >
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="flex items-center gap-2 text-sm">
            Prompt tuning
            {modifiedCount > 0 && (
              <Badge variant="secondary">{modifiedCount} modified</Badge>
            )}
          </SheetTitle>
          <SheetDescription className="text-[11px]">
            Local, session-only overrides sent with each message. Edits change
            Claire&apos;s next reply — they are not saved to the database.
          </SheetDescription>
          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              disabled={isPreviewing}
              onClick={() => {
                void previewPrompt({ conversationId, overrides });
              }}
            >
              {isPreviewing ? 'Building…' : 'Build full prompt'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={modifiedCount === 0}
              onClick={resetAll}
            >
              <RotateCcw className="mr-1 size-3.5" />
              Reset all
            </Button>
            {config && (
              <span className="ml-auto text-[11px] text-muted-foreground">
                skills v{config.skillRegistryVersion}
              </span>
            )}
          </div>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-5 px-4 py-4">
            {isLoading && (
              <p className="text-sm text-muted-foreground">Loading config…</p>
            )}
            {isError && (
              <p className="text-sm text-destructive">
                Failed to load prompt config.
              </p>
            )}

            {/* Operator directives — appended last, highest priority */}
            <FieldEditor
              label="Extra directives (appended last)"
              hint="Free text added to the end of the system prompt. Highest priority."
              value={overrides.extraDirectives}
              defaultValue=""
              placeholder="e.g. Always lead with the highest-retention service. Keep replies under 3 sentences."
              onChange={(v) =>
                onOverridesChange({ ...overrides, extraDirectives: v })
              }
              rows={5}
            />

            {config && (
              <>
                <Section title="System blocks">
                  <FieldEditor
                    label="Persona (Block 1)"
                    value={overrides.persona}
                    defaultValue={config.blocks.persona}
                    onChange={(v) => setBlock('persona', v)}
                  />
                  <FieldEditor
                    label="Skill index (Block 2)"
                    value={overrides.skillIndex}
                    defaultValue={config.blocks.skillIndex}
                    onChange={(v) => setBlock('skillIndex', v)}
                  />
                  <FieldEditor
                    label="Business context (Block 4)"
                    hint="Org profile. Reflects saved org data — edits here are session-only."
                    value={overrides.businessContext}
                    defaultValue={config.blocks.businessContext}
                    onChange={(v) => setBlock('businessContext', v)}
                  />
                </Section>

                <Section title={`Skills (${config.skills.length})`}>
                  <p className="text-[11px] text-muted-foreground">
                    Per-skill instructions. Only loaded skills affect this
                    conversation; others apply when their skill loads.
                  </p>
                  {config.skills.map((skill) => (
                    <Collapsible key={skill.id}>
                      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-xs hover:bg-accent">
                        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="font-mono font-medium">
                          {skill.id}
                        </span>
                        {loadedSet.has(skill.id) && (
                          <Badge variant="secondary" className="text-[10px]">
                            loaded
                          </Badge>
                        )}
                        {overrides.skillFragments?.[skill.id] !== undefined && (
                          <Badge className="text-[10px]">modified</Badge>
                        )}
                        <span className="ml-auto truncate text-[11px] text-muted-foreground">
                          {skill.oneLineDescription}
                        </span>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="px-1 pb-2 pt-1">
                        <FieldEditor
                          label={`${skill.id} fragment`}
                          value={overrides.skillFragments?.[skill.id]}
                          defaultValue={skill.promptFragment}
                          onChange={(v) =>
                            setMapEntry('skillFragments', skill.id, v)
                          }
                          rows={8}
                        />
                      </CollapsibleContent>
                    </Collapsible>
                  ))}
                </Section>

                <Section title={`Tools (${config.tools.length})`}>
                  <p className="text-[11px] text-muted-foreground">
                    Editing a tool&apos;s description changes when/how Claire
                    reaches for it (e.g. recommending services). The tool&apos;s
                    execution logic and input schema are fixed in code.
                  </p>
                  <Input
                    value={toolFilter}
                    onChange={(e) => setToolFilter(e.target.value)}
                    placeholder="Filter tools…"
                    className="h-8 text-xs"
                  />
                  {filteredTools.map((tool) => (
                    <Collapsible key={tool.name}>
                      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-xs hover:bg-accent">
                        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="font-mono font-medium">
                          {tool.name}
                        </span>
                        {overrides.toolDescriptions?.[tool.name] !==
                          undefined && (
                          <Badge className="text-[10px]">modified</Badge>
                        )}
                      </CollapsibleTrigger>
                      <CollapsibleContent className="px-1 pb-2 pt-1">
                        <FieldEditor
                          label="Description"
                          value={overrides.toolDescriptions?.[tool.name]}
                          defaultValue={tool.description}
                          onChange={(v) =>
                            setMapEntry('toolDescriptions', tool.name, v)
                          }
                          rows={5}
                        />
                        <details className="mt-2">
                          <summary className="cursor-pointer text-[11px] text-muted-foreground">
                            Input schema (read-only)
                          </summary>
                          <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted p-2 text-[10px]">
                            {JSON.stringify(tool.inputSchema, null, 2)}
                          </pre>
                        </details>
                      </CollapsibleContent>
                    </Collapsible>
                  ))}
                </Section>
              </>
            )}

            {preview && (
              <Section title="Assembled prompt">
                <p className="text-[11px] text-muted-foreground">
                  {preview.blockCount} blocks · loaded skills:{' '}
                  {preview.loadedSkillIds.length
                    ? preview.loadedSkillIds.join(', ')
                    : 'none'}{' '}
                  · knowledge/RAG omitted (per-message)
                </p>
                <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-[11px]">
                  {preview.prompt}
                </pre>
              </Section>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

function FieldEditor({
  label,
  hint,
  value,
  defaultValue,
  placeholder,
  onChange,
  rows = 6,
}: {
  label: string;
  hint?: string;
  /** undefined = not overridden (default shown). */
  value: string | undefined;
  defaultValue: string;
  placeholder?: string;
  /** Pass undefined to reset back to the default. */
  onChange: (value: string | undefined) => void;
  rows?: number;
}) {
  const isOverridden = value !== undefined;
  const shown = value ?? defaultValue;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="flex items-center gap-2 text-xs font-medium">
          {label}
          {isOverridden && <Badge className="text-[10px]">modified</Badge>}
        </Label>
        {isOverridden && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            onClick={() => onChange(undefined)}
          >
            Reset
          </Button>
        )}
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      <Textarea
        value={shown}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="font-mono text-xs"
      />
    </div>
  );
}
