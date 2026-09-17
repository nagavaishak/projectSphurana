import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  updateVoiceScriptForm,
  useCreateVoiceScript,
  useGetDefaultVoiceScript,
  useUpdateVoiceScript,
} from '@/features/voice-scripts';

/**
 * Labels come from the voice-script content declaration, not from literals here
 * — the form contract locates each control by the same string.
 */
const L = updateVoiceScriptForm.labels;
import { cn } from '@/lib/utils';
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Check,
  GripVertical,
  Loader2,
  Phone,
  Plus,
  Variable,
  X,
} from 'lucide-react';
import * as React from 'react';
import type { UseFormReturn } from 'react-hook-form';

// Template variables available for insertion
const TEMPLATE_VARIABLES = [
  { key: 'contact.first_name', label: 'First Name' },
  { key: 'contact.last_name', label: 'Last Name' },
  { key: 'contact.email', label: 'Email' },
  { key: 'contact.phone', label: 'Phone' },
  { key: 'organization.name', label: 'Company Name' },
  { key: 'appointment.date', label: 'Appointment Date' },
  { key: 'appointment.time', label: 'Appointment Time' },
];

export const DEFAULT_INITIAL_MESSAGE =
  "Hey {{contact.first_name}}, hope you're well! We just noticed you opted in for a free consultation with us via an ad on Facebook. Just want to check this is the best plan to reach you?";

export const DEFAULT_SCRIPT = `You are a friendly and professional AI assistant calling on behalf of {{organization.name}}.

## Your Role
You are making outbound calls to leads who have expressed interest in our services. Your goal is to qualify them and book appointments.

## Guidelines
1. Start by greeting the lead warmly by name
2. Confirm their interest in our services
3. Ask the qualification questions to understand their needs
4. If qualified, offer to book an appointment
5. Be conversational and natural, not robotic
6. If they're busy, offer to call back at a better time
7. Always be respectful if they decline

## Important Rules
- Never be pushy or aggressive
- Respect if the lead says they're not interested
- If you can't answer a question, offer to have someone follow up`;

export const DEFAULT_FOLLOW_UP =
  'Hi {{contact.first_name}}, just wanted to check if you received this?';

interface ScriptItem {
  id: string;
  content: string;
}

interface SortableItemProps {
  item: ScriptItem;
  index: number;
  prefix: string;
  onUpdate: (id: string, content: string) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
}

function SortableItem({
  item,
  index,
  prefix,
  onUpdate,
  onRemove,
  disabled,
}: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-start gap-2 rounded-lg border bg-card p-3',
        isDragging && 'opacity-50 shadow-lg'
      )}
    >
      {/* Drag handle */}
      <button
        type="button"
        className="mt-2.5 cursor-grab touch-none text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>

      {/* Label */}
      <span className="mt-2.5 shrink-0 text-sm font-medium text-muted-foreground w-8">
        {prefix}
        {index + 1}.
      </span>

      {/* Input */}
      <Textarea
        value={item.content}
        onChange={(e) => onUpdate(item.id, e.target.value)}
        placeholder={`Enter ${prefix === 'Q' ? 'qualification question' : 'follow-up message'}...`}
        className="min-h-[60px] flex-1 resize-none"
        rows={2}
        disabled={disabled}
      />

      {/* Delete button */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="mt-1 shrink-0 text-muted-foreground hover:text-destructive"
        onClick={() => onRemove(item.id)}
        disabled={disabled}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}

function DragOverlayItem({
  item,
  index,
  prefix,
}: { item: ScriptItem; index: number; prefix: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border bg-card p-3 shadow-xl">
      <span className="mt-2.5 text-muted-foreground">
        <GripVertical className="size-4" />
      </span>
      <span className="mt-2.5 shrink-0 text-sm font-medium text-muted-foreground w-8">
        {prefix}
        {index + 1}.
      </span>
      <div className="flex-1 rounded border bg-muted/50 p-2 text-sm">
        {item.content || 'Empty item'}
      </div>
    </div>
  );
}

interface VariableInserterProps {
  onInsert: (variable: string) => void;
  disabled?: boolean;
}

function VariableInserter({ onInsert, disabled }: VariableInserterProps) {
  const [open, setOpen] = React.useState(false);

  const handleSelect = (variable: string) => {
    onInsert(`{{${variable}}}`);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={disabled}
        >
          <Variable className="size-3.5" />
          Custom values
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start">
        <div className="space-y-0.5">
          {TEMPLATE_VARIABLES.map((v) => (
            <button
              key={v.key}
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
              onClick={() => handleSelect(v.key)}
            >
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                {`{{${v.key}}}`}
              </code>
              <span className="text-muted-foreground">{v.label}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Convert ScriptItem[] to string[]
function itemsToStrings(items: ScriptItem[]): string[] {
  return items
    .map((item) => item.content)
    .filter((content) => content.trim() !== '');
}

// Convert string[] to ScriptItem[]
function stringsToItems(strings: string[], prefix: string): ScriptItem[] {
  if (strings.length === 0) {
    return [{ id: `${prefix}-1`, content: '' }];
  }
  return strings.map((content, index) => ({
    id: `${prefix}-${index + 1}`,
    content,
  }));
}

interface Step3VoiceScriptProps {
  form?: UseFormReturn<Record<string, unknown>>;
  organizationId?: string;
}

export function Step3VoiceScript({ organizationId }: Step3VoiceScriptProps) {
  // Fetch existing voice script
  const { script: existingScript, isLoading } = useGetDefaultVoiceScript({
    queryConfig: { enabled: !!organizationId },
  });

  // Mutations
  const { createVoiceScript, isCreating } = useCreateVoiceScript();
  const { updateVoiceScript, isUpdating } = useUpdateVoiceScript();

  const isSaving = isCreating || isUpdating;

  // Local state - initialized from API data or defaults
  const [isInitialized, setIsInitialized] = React.useState(false);
  const [initialMessage, setInitialMessage] = React.useState(
    DEFAULT_INITIAL_MESSAGE
  );
  const [script, setScript] = React.useState(DEFAULT_SCRIPT);
  const [questions, setQuestions] = React.useState<ScriptItem[]>([
    { id: 'q-1', content: '' },
  ]);
  const [followUps, setFollowUps] = React.useState<ScriptItem[]>([
    { id: 'f-1', content: DEFAULT_FOLLOW_UP },
  ]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = React.useState(false);

  const initialMessageRef = React.useRef<HTMLTextAreaElement>(null);
  const scriptRef = React.useRef<HTMLTextAreaElement>(null);

  // Track if we've created the initial script
  const [hasCreatedInitialScript, setHasCreatedInitialScript] =
    React.useState(false);

  // Initialize state from API data when loaded
  React.useEffect(() => {
    if (!isLoading && organizationId && !isInitialized) {
      if (existingScript) {
        setInitialMessage(existingScript.initialMessage);
        setScript(existingScript.script ?? DEFAULT_SCRIPT);
        setQuestions(
          stringsToItems(existingScript.qualificationQuestions, 'q')
        );
        setFollowUps(stringsToItems(existingScript.followUps, 'f'));
      }
      setIsInitialized(true);
    }
  }, [isLoading, organizationId, existingScript, isInitialized]);

  // Auto-create default script if none exists (runs once after initialization)
  React.useEffect(() => {
    if (
      isInitialized &&
      organizationId &&
      !existingScript &&
      !hasCreatedInitialScript &&
      !isCreating
    ) {
      setHasCreatedInitialScript(true);
      // Create default script with current state values
      createVoiceScript({
        name: 'Default Script',
        isDefault: true,
        initialMessage: DEFAULT_INITIAL_MESSAGE,
        script: DEFAULT_SCRIPT,
        qualificationQuestions: [],
        followUps: [DEFAULT_FOLLOW_UP],
      });
    }
  }, [
    isInitialized,
    organizationId,
    existingScript,
    hasCreatedInitialScript,
    isCreating,
    createVoiceScript,
  ]);

  // Track changes
  const markChanged = React.useCallback(() => {
    setHasUnsavedChanges(true);
  }, []);

  // Save function
  const saveScript = React.useCallback(() => {
    if (!organizationId || !hasUnsavedChanges) return;

    const scriptData = {
      name: 'Default Script',
      isDefault: true,
      initialMessage,
      script,
      qualificationQuestions: itemsToStrings(questions),
      followUps: itemsToStrings(followUps),
    };

    if (existingScript) {
      updateVoiceScript({ id: existingScript.id, ...scriptData });
    } else {
      createVoiceScript(scriptData);
    }

    setHasUnsavedChanges(false);
  }, [
    organizationId,
    hasUnsavedChanges,
    existingScript,
    initialMessage,
    script,
    questions,
    followUps,
    createVoiceScript,
    updateVoiceScript,
  ]);

  // Auto-save on blur (debounced)
  const saveTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  React.useEffect(() => {
    if (hasUnsavedChanges && organizationId && isInitialized) {
      // Clear existing timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      // Set new timeout for auto-save after 2 seconds of inactivity
      saveTimeoutRef.current = setTimeout(() => {
        saveScript();
      }, 2000);
    }

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [hasUnsavedChanges, organizationId, isInitialized, saveScript]);

  // Drag state
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [activeType, setActiveType] = React.useState<
    'question' | 'followup' | null
  >(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleInsertVariable = (variable: string) => {
    const textarea = initialMessageRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newValue =
      initialMessage.substring(0, start) +
      variable +
      initialMessage.substring(end);
    setInitialMessage(newValue);
    markChanged();

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(
        start + variable.length,
        start + variable.length
      );
    }, 0);
  };

  const handleInsertVariableToScript = (variable: string) => {
    const textarea = scriptRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newValue =
      script.substring(0, start) + variable + script.substring(end);
    setScript(newValue);
    markChanged();

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(
        start + variable.length,
        start + variable.length
      );
    }, 0);
  };

  // Question handlers
  const addQuestion = () => {
    setQuestions([...questions, { id: `q-${Date.now()}`, content: '' }]);
    markChanged();
  };

  const updateQuestion = (id: string, content: string) => {
    setQuestions(questions.map((q) => (q.id === id ? { ...q, content } : q)));
    markChanged();
  };

  const removeQuestion = (id: string) => {
    if (questions.length > 1) {
      setQuestions(questions.filter((q) => q.id !== id));
      markChanged();
    }
  };

  // Follow-up handlers
  const addFollowUp = () => {
    setFollowUps([...followUps, { id: `f-${Date.now()}`, content: '' }]);
    markChanged();
  };

  const updateFollowUp = (id: string, content: string) => {
    setFollowUps(followUps.map((f) => (f.id === id ? { ...f, content } : f)));
    markChanged();
  };

  const removeFollowUp = (id: string) => {
    if (followUps.length > 1) {
      setFollowUps(followUps.filter((f) => f.id !== id));
      markChanged();
    }
  };

  // Drag handlers
  const handleDragStart = (event: DragStartEvent) => {
    const id = event.active.id as string;
    setActiveId(id);
    setActiveType(id.startsWith('q-') ? 'question' : 'followup');
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setActiveType(null);

    if (!over || active.id === over.id) return;

    const activeIdStr = active.id as string;
    const overIdStr = over.id as string;

    if (activeIdStr.startsWith('q-') && overIdStr.startsWith('q-')) {
      setQuestions((items) => {
        const oldIndex = items.findIndex((i) => i.id === activeIdStr);
        const newIndex = items.findIndex((i) => i.id === overIdStr);
        return arrayMove(items, oldIndex, newIndex);
      });
      markChanged();
    } else if (activeIdStr.startsWith('f-') && overIdStr.startsWith('f-')) {
      setFollowUps((items) => {
        const oldIndex = items.findIndex((i) => i.id === activeIdStr);
        const newIndex = items.findIndex((i) => i.id === overIdStr);
        return arrayMove(items, oldIndex, newIndex);
      });
      markChanged();
    }
  };

  const activeItem = activeId
    ? activeType === 'question'
      ? questions.find((q) => q.id === activeId)
      : followUps.find((f) => f.id === activeId)
    : null;

  const activeIndex = activeId
    ? activeType === 'question'
      ? questions.findIndex((q) => q.id === activeId)
      : followUps.findIndex((f) => f.id === activeId)
    : -1;

  // No org yet - show informational UI
  if (!organizationId) {
    return (
      <FieldGroup className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Configure AI Voice Script</h1>
          <p className="text-sm text-muted-foreground">
            Set up what your AI voice caller will say to leads. You can
            customize the initial message, qualification questions, and
            follow-up sequences.
          </p>
        </div>

        <div className="rounded-lg border border-dashed border-muted-foreground/25 bg-muted/50 p-6 text-center">
          <Phone className="mx-auto size-10 text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">
            Voice script configuration will be available after your organization
            is created.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            You can skip this step and set it up later in Settings.
          </p>
        </div>
      </FieldGroup>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <FieldGroup className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Configure AI Voice Script</h1>
          <p className="text-sm text-muted-foreground">
            Loading your script configuration...
          </p>
        </div>
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </FieldGroup>
    );
  }

  return (
    <FieldGroup className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Configure AI Voice Script</h1>
          {isSaving && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Saving...
            </span>
          )}
          {!isSaving && !hasUnsavedChanges && existingScript && (
            <span className="flex items-center gap-1.5 text-xs text-green-600">
              <Check className="size-3" />
              Saved
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Set up what your AI voice caller will say to leads. Use template
          variables to personalize messages.
        </p>
      </div>

      {/* Initial Message */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label htmlFor="initial-message" className="text-sm font-medium">
            {L.initialMessage}
          </label>
          <VariableInserter
            onInsert={handleInsertVariable}
            disabled={isSaving}
          />
        </div>
        <Textarea
          id="initial-message"
          ref={initialMessageRef}
          value={initialMessage}
          onChange={(e) => {
            setInitialMessage(e.target.value);
            markChanged();
          }}
          placeholder="Enter the initial message your AI will use..."
          className="min-h-[100px] resize-none"
          rows={4}
          disabled={isSaving}
        />
      </div>

      {/* AI Agent Script */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <label htmlFor="ai-agent-script" className="text-sm font-medium">
              {L.script}
            </label>
            <p className="text-xs text-muted-foreground">
              The main prompt that defines your AI agent's behavior and
              conversation flow
            </p>
          </div>
          <VariableInserter
            onInsert={handleInsertVariableToScript}
            disabled={isSaving}
          />
        </div>
        <Textarea
          id="ai-agent-script"
          ref={scriptRef}
          value={script}
          onChange={(e) => {
            setScript(e.target.value);
            markChanged();
          }}
          placeholder="Define your AI agent's personality, guidelines, and conversation flow..."
          className="min-h-[200px] resize-none font-mono text-sm"
          rows={10}
          disabled={isSaving}
        />
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/* Qualification Questions */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">
              {L.qualificationQuestions}
            </span>
            <span className="text-xs text-muted-foreground">
              ({questions.length})
            </span>
          </div>

          <SortableContext
            items={questions.map((q) => q.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {questions.map((question, index) => (
                <SortableItem
                  key={question.id}
                  item={question}
                  index={index}
                  prefix="Q"
                  onUpdate={updateQuestion}
                  onRemove={removeQuestion}
                  disabled={isSaving}
                />
              ))}
            </div>
          </SortableContext>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full gap-1.5 border-dashed"
            onClick={addQuestion}
            disabled={isSaving}
          >
            <Plus className="size-4" />
            Add Qualification Question
          </Button>
        </div>

        {/* Follow Ups */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{L.followUps}</span>
            <span className="text-xs text-muted-foreground">
              ({followUps.length})
            </span>
          </div>

          <SortableContext
            items={followUps.map((f) => f.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {followUps.map((followUp, index) => (
                <SortableItem
                  key={followUp.id}
                  item={followUp}
                  index={index}
                  prefix="F"
                  onUpdate={updateFollowUp}
                  onRemove={removeFollowUp}
                  disabled={isSaving}
                />
              ))}
            </div>
          </SortableContext>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full gap-1.5 border-dashed"
            onClick={addFollowUp}
            disabled={isSaving}
          >
            <Plus className="size-4" />
            Add Follow Up
          </Button>
        </div>

        <DragOverlay>
          {activeItem && activeIndex !== -1 ? (
            <DragOverlayItem
              item={activeItem}
              index={activeIndex}
              prefix={activeType === 'question' ? 'Q' : 'F'}
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      <p className="text-xs text-muted-foreground">
        Your script is automatically saved. You can customize it further in your
        organization settings after onboarding.
      </p>
    </FieldGroup>
  );
}
