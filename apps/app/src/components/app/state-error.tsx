import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface StateErrorProps {
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export function StateError({
  message = 'Something went wrong. Please try again.',
  onRetry,
  className,
}: StateErrorProps) {
  return (
    <Alert variant="destructive" className={cn(className)}>
      <AlertCircle className="size-4" />
      <AlertDescription className="flex items-center justify-between gap-4">
        <span>{message}</span>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="mr-1 size-3" />
            Retry
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
