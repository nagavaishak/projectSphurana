import type { ReactNode } from 'react';
import { QUICK_ACTIONS } from './quick-actions';

interface WelcomeScreenProps {
  onQuickAction: (message: string) => void;
  composer?: ReactNode;
}

export function WelcomeScreen({ onQuickAction, composer }: WelcomeScreenProps) {
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center px-10 py-8">
      <div className="flex w-full max-w-[760px] flex-col gap-3">
        <h2 className="text-center text-[46px] font-semibold leading-tight tracking-tight">
          Ask Claire AI
        </h2>

        {composer}

        <div className="flex flex-wrap items-center gap-2">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.skillId}
                type="button"
                onClick={() => onQuickAction(action.message)}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-background px-4 py-1.5 font-medium text-[15px] text-foreground leading-none shadow-sm transition-colors hover:bg-accent"
              >
                {Icon && (
                  <Icon
                    className="size-4 shrink-0"
                    style={{ color: action.iconColor }}
                  />
                )}
                {action.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
