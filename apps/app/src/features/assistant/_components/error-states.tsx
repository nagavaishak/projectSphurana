import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface StreamErrorBannerProps {
  message: string | null;
  onRetry: () => void;
}

/** Inline error shown above the composer when a stream fails mid-flight. */
export function StreamErrorBanner({
  message,
  onRetry,
}: StreamErrorBannerProps) {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm text-destructive dark:bg-destructive/10">
        <AlertCircle className="size-4 shrink-0" />
        <span className="flex-1">{message || 'Something went wrong'}</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-2 gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10"
          onClick={onRetry}
        >
          <RefreshCw className="size-3.5" />
          Retry
        </Button>
      </div>
    </div>
  );
}

interface ConversationNotFoundProps {
  className?: string;
}

export function ConversationNotFound({ className }: ConversationNotFoundProps) {
  return (
    <div
      className={
        className ??
        'flex flex-1 items-center justify-center text-sm text-muted-foreground'
      }
    >
      Conversation not found
    </div>
  );
}
