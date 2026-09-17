import { Button } from '@/components/ui/button';
import { ASSISTANT_UPLOAD_MIME_TYPES } from '@/features/assistant';
import { createAssistantHandoff } from '@/features/assistant/lib/pending-handoff';
import { cn } from '@/lib/utils';
import { useNavigate } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import {
  ChartNoAxesColumnIncreasing,
  CornerDownLeft,
  History,
  NotepadText,
  Plus,
  SquareCode,
  X,
} from 'lucide-react';
import { useRef, useState } from 'react';

interface QuickAction {
  skillId: string;
  label: string;
  message: string;
  icon: LucideIcon;
  iconColor: string;
}

const QUICK_ACTIONS: ReadonlyArray<QuickAction> = [
  {
    skillId: 'generate-video',
    label: 'Create Video',
    message: 'I want to create a video',
    icon: ChartNoAxesColumnIncreasing,
    iconColor: '#00BCFF',
  },
  {
    skillId: 'create-ad',
    label: 'Launch Ad',
    message: 'I want to launch an ad',
    icon: NotepadText,
    iconColor: '#FF8904',
  },
  {
    skillId: 'summarise-conversations',
    label: 'Summarise Conversations',
    message: 'Summarise my recent conversations',
    icon: SquareCode,
    iconColor: '#615FFF',
  },
];

const FILE_ACCEPT = ASSISTANT_UPLOAD_MIME_TYPES.join(',');

/**
 * Home-screen entry point into the AI assistant. The home prompt is the
 * launcher — it hands the draft text + any picked files to the assistant
 * via the token-keyed `pending-handoff` store and navigates there. The
 * assistant auto-sends on arrival, so the user lands straight in a live
 * full-page conversation (never the deprecated "Ask Claire AI" welcome
 * screen). "Recents" → `/assistant` with no params → the conversation list.
 */
export function HomePrompt() {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isEmpty = value.trim().length === 0 && files.length === 0;

  const goToAssistant = (text: string, picked: File[]) => {
    const trimmed = text.trim();
    if (!trimmed && picked.length === 0) return;
    // The token — not the draft itself — travels in the URL, so the assistant
    // can re-read the hand-off on every render/mount of that navigation
    // instead of racing to grab it exactly once. See `pending-handoff`.
    const handoff = createAssistantHandoff({
      draft: trimmed || undefined,
      files: picked.length > 0 ? picked : undefined,
    });
    void navigate({
      to: '/assistant',
      search: { new: '1', handoff },
      viewTransition: true,
    });
  };

  const handlePickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files;
    if (picked && picked.length > 0) {
      setFiles((prev) => [...prev, ...Array.from(picked)]);
    }
    // Allow re-selecting the same file after removal.
    e.target.value = '';
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Quick-action suggestions — left aligned */}
      <div className="flex flex-wrap items-center gap-2">
        {QUICK_ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.skillId}
              type="button"
              onClick={() => goToAssistant(action.message, [])}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-4 py-1.5',
                'text-sm font-medium text-foreground shadow-xs transition-colors hover:bg-accent'
              )}
            >
              <Icon className="size-4" style={{ color: action.iconColor }} />
              {action.label}
            </button>
          );
        })}
      </div>

      {/* Input box */}
      <div className="flex flex-col rounded-2xl border border-border bg-card shadow-xs">
        {/* Staged file chips */}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 px-5 pt-3">
            {files.map((file, idx) => (
              <span
                key={`${file.name}-${idx}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-2.5 py-1 text-xs text-foreground"
              >
                <span className="max-w-[160px] truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => removeFile(idx)}
                  aria-label={`Remove ${file.name}`}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Textarea */}
        <div className="flex min-h-[72px] items-start px-5 pt-3 pb-0">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                goToAssistant(value, files);
              }
            }}
            placeholder="Ask me what you want to do..."
            className="w-full resize-none bg-transparent text-base text-foreground placeholder:text-muted-foreground focus:outline-none"
            rows={2}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-3 pb-3 pt-1">
          <div className="flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              accept={FILE_ACCEPT}
              multiple
              className="hidden"
              aria-label="Add files"
              onChange={handlePickFiles}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Add files"
            >
              <Plus className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2 text-muted-foreground"
              onClick={() =>
                navigate({
                  to: '/assistant',
                  search: {},
                  viewTransition: true,
                })
              }
            >
              <History className="size-4" />
              Recents
            </Button>
          </div>
          {/*
            Icon-only, so it needs an explicit name: the CornerDownLeft glyph
            gives a screen reader nothing to announce, and axe flagged it
            `button-name` (critical) on the dashboard home.
          */}
          <Button
            aria-label="Send to Claire"
            size="icon"
            disabled={isEmpty}
            onClick={() => goToAssistant(value, files)}
            className="size-8 rounded-xl bg-[#155DFC] text-white hover:bg-[#1248c7] disabled:bg-muted disabled:text-muted-foreground"
          >
            <CornerDownLeft className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
