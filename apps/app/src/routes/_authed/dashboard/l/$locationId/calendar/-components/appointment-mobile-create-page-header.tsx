import { cn } from '@/lib/utils';

interface AppointmentMobileCreatePageTitleProps {
  title: string;
  subtitle?: string;
  className?: string;
}

/** On-page heading; back control lives in the floating mobile dashboard header. */
export function AppointmentMobileCreatePageTitle({
  title,
  subtitle,
  className,
}: AppointmentMobileCreatePageTitleProps) {
  return (
    <div className={cn('pb-4', className)}>
      <h1 className="text-2xl font-bold tracking-tight text-black">{title}</h1>
      {subtitle ? (
        <p className="mt-1 text-[15px] leading-snug text-[#8E8E93]">
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}
