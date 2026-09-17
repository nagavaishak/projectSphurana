import { useRouter } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';

interface MobileTopBarProps {
  title: string;
  /** Show back arrow on the left. Defaults to true. */
  showBack?: boolean;
  /** Optional right-side element (e.g. avatar, action button). */
  right?: React.ReactNode;
}

/**
 * Top bar shared by Recent Posts, Scheduled Posts, Post Detail.
 * Back arrow uses router.history.back() to pop the stack.
 */
export function MobileTopBar({
  title,
  showBack = true,
  right,
}: MobileTopBarProps) {
  const router = useRouter();

  return (
    <div className="flex items-center justify-between bg-[#fafafa] px-5 py-3">
      {showBack ? (
        <button
          type="button"
          onClick={() => router.history.back()}
          className="flex size-10 items-center justify-center rounded-full bg-white/20 shadow-sm active:opacity-70"
          aria-label="Back"
        >
          <ChevronLeft className="size-5 text-slate-800" />
        </button>
      ) : (
        <div className="size-10" />
      )}
      <h1 className="text-[15.8px] font-bold leading-[22.6px] text-slate-900">
        {title}
      </h1>
      {right ?? <div className="size-10" />}
    </div>
  );
}
