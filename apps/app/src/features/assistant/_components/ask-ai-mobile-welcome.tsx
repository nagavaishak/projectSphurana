import { glassInteractiveClass } from '@/features/mobile-bottom-tabs/mobile-bottom-tabs-motion';
import { cn } from '@/lib/utils';

import { ASK_AI_MOBILE_QUICK_ACTIONS } from './ask-ai-mobile-quick-actions';

interface AskAiMobileWelcomeProps {
  onQuickAction: (message: string) => void;
  className?: string;
}

/**
 * Empty-state content for the mobile Ask AI sheet — headings + suggestion pills.
 * Desktop assistant keeps using {@link WelcomeScreen}.
 */
export function AskAiMobileWelcome({
  onQuickAction,
  className,
}: AskAiMobileWelcomeProps) {
  return (
    <div className={cn('flex w-full flex-col gap-5', className)}>
      <div className="flex flex-col gap-1">
        <h2 className="text-[28px] font-semibold leading-tight tracking-tight text-[#0A0A0A]">
          How can I help you?
        </h2>
        <p className="text-[15px] leading-snug text-[#737373]">
          Ask Claire anything related to your clinic
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {ASK_AI_MOBILE_QUICK_ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.skillId}
              type="button"
              onClick={() => onQuickAction(action.message)}
              className={cn(
                glassInteractiveClass,
                'inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2',
                'text-[14px] font-medium leading-none text-[#0A0A0A]',
                'transition active:scale-[0.98]'
              )}
            >
              <Icon className="size-4 shrink-0" strokeWidth={2} aria-hidden />
              {action.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
