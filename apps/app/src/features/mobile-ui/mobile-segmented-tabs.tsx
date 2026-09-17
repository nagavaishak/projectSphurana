import { MOBILE_FILTER_CHROME_CLASS } from '@/features/mobile-ui/mobile-filter-chrome';
import { cn } from '@/lib/utils';
import type { ElementType } from 'react';

export interface MobileSegmentedTab {
  value: string;
  label?: string;
  icon?: ElementType;
  ariaLabel: string;
  disabled?: boolean;
}

type MobileSegmentedTabsBase = {
  tabs: MobileSegmentedTab[];
  className?: string;
  'aria-label'?: string;
};

type MobileSegmentedTabsSingleProps = MobileSegmentedTabsBase & {
  value: string;
  onValueChange: (value: string) => void;
  selectedValues?: never;
  onToggle?: never;
};

type MobileSegmentedTabsMultiProps = MobileSegmentedTabsBase & {
  selectedValues: string[];
  onToggle: (value: string) => void;
  value?: never;
  onValueChange?: never;
};

export type MobileSegmentedTabsProps =
  | MobileSegmentedTabsSingleProps
  | MobileSegmentedTabsMultiProps;

export function MobileSegmentedTabs(props: MobileSegmentedTabsProps) {
  const { tabs, className, 'aria-label': ariaLabel = 'Filter' } = props;

  const isMulti =
    'selectedValues' in props && props.selectedValues !== undefined;

  return (
    <div
      className={cn(
        'inline-flex w-fit max-w-full shrink-0 overflow-hidden',
        MOBILE_FILTER_CHROME_CLASS,
        className
      )}
      role="tablist"
      aria-label={ariaLabel}
    >
      {tabs.map((tab, index) => {
        const isSelected = isMulti
          ? props.selectedValues.includes(tab.value)
          : props.value === tab.value;
        const isDisabled = Boolean(tab.disabled);
        const Icon = tab.icon;

        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={isSelected}
            aria-disabled={isDisabled}
            disabled={isDisabled}
            aria-label={tab.ariaLabel}
            onClick={() => {
              if (isDisabled) return;
              if (isMulti) {
                props.onToggle(tab.value);
              } else {
                props.onValueChange(tab.value);
              }
            }}
            className={cn(
              'flex h-[38px] items-center justify-center transition-colors',
              tab.label ? 'shrink-0 px-3' : 'w-[38px] px-0',
              isSelected && !isDisabled ? 'bg-[#F2F2F7]' : 'bg-white',
              isDisabled && 'cursor-not-allowed opacity-40',
              index > 0 && 'border-l border-[#E5E5EA]'
            )}
          >
            {tab.label ? (
              <span
                className={cn(
                  'text-[14px] font-medium leading-none',
                  isDisabled ? 'text-[#8E8E93]' : 'text-black'
                )}
              >
                {tab.label}
              </span>
            ) : Icon ? (
              <Icon
                className={cn(
                  'size-4',
                  isDisabled ? 'text-[#8E8E93]' : 'text-black'
                )}
                strokeWidth={2}
                aria-hidden
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
