import { cn } from '@/lib/utils';

interface StepPillsProps {
  totalSteps: number;
  currentStep: number;
  className?: string;
}

export function StepPills({
  totalSteps,
  currentStep,
  className,
}: StepPillsProps) {
  return (
    <div className={cn('flex items-center justify-center gap-2', className)}>
      {Array.from({ length: totalSteps }, (_, idx) => (
        <span
          key={idx}
          className={cn(
            'h-1.5 w-7 rounded-full transition-colors',
            idx === currentStep
              ? 'bg-foreground'
              : 'border border-muted-foreground/40 bg-transparent'
          )}
        />
      ))}
    </div>
  );
}
