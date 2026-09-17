import { cn } from '@/lib/utils';

interface MobileSelectionPillProps {
  label: string;
  selected: boolean;
  onClick: () => void;
}

export function MobileSelectionPill({
  label,
  selected,
  onClick,
}: MobileSelectionPillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors active:opacity-80',
        selected
          ? 'border-black bg-black text-white'
          : 'border-black bg-white text-black'
      )}
    >
      {label}
    </button>
  );
}
