import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp, Sparkles, UserRoundX } from 'lucide-react';
import { type ReactNode, useState } from 'react';

export type HandledByFilterValue =
  | 'all'
  | 'claire_ai'
  | 'unassigned'
  | `agent:${string}`;

export interface HandledByAgentOption {
  id: string;
  firstName: string;
  fullName: string;
  image: string | null;
  roleLabel: string;
}

interface HandledByFilterDropdownProps {
  value: HandledByFilterValue;
  onValueChange: (value: HandledByFilterValue) => void;
  agentOptions: HandledByAgentOption[];
  triggerClassName?: string;
}

function memberInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}

function HandledByMenuItem({
  selected,
  onSelect,
  className,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      className={cn(
        'cursor-pointer rounded-lg py-2 pl-2 pr-2 focus:bg-[#F2F2F7] focus:text-inherit',
        selected && 'bg-[#F2F2F7]',
        className
      )}
    >
      {children}
    </DropdownMenuItem>
  );
}

export function formatOrganizationMemberRoleLabel(role: string): string {
  const labels: Record<string, string> = {
    owner: 'Owner',
    admin: 'Admin',
    manager: 'Manager',
    practitioner: 'Staff',
    member: 'Staff',
  };
  return labels[role] ?? role.charAt(0).toUpperCase() + role.slice(1);
}

export function HandledByFilterDropdown({
  value,
  onValueChange,
  agentOptions,
  triggerClassName,
}: HandledByFilterDropdownProps) {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-[40px] min-h-[40px] w-auto shrink-0 items-center gap-1 px-2.5 text-[14px] font-medium leading-none text-black outline-none',
            triggerClassName
          )}
        >
          <span>Handled By</span>
          {open ? (
            <ChevronUp
              className="size-4 shrink-0 text-[#8E8E93]"
              strokeWidth={2}
              aria-hidden
            />
          ) : (
            <ChevronDown
              className="size-4 shrink-0 text-[#8E8E93]"
              strokeWidth={2}
              aria-hidden
            />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="w-[min(100vw-2rem,225px)] min-w-[225px] rounded-xl border border-[#E5E5EA] bg-white p-1 shadow-[0_4px_16px_rgba(0,0,0,0.12)]"
      >
        <HandledByMenuItem
          selected={value === 'claire_ai'}
          onSelect={() => onValueChange('claire_ai')}
        >
          <div className="flex w-full items-center gap-2">
            <span className="flex size-9 shrink-0 items-center justify-center">
              <Sparkles
                className="size-[15px] text-[#2E65F3]"
                strokeWidth={1.75}
                aria-hidden
              />
            </span>
            <span className="text-[14px] font-medium leading-none text-[#2E65F3]">
              Claire
            </span>
          </div>
        </HandledByMenuItem>

        <HandledByMenuItem
          selected={value === 'unassigned'}
          onSelect={() => onValueChange('unassigned')}
        >
          <div className="flex w-full items-center gap-2">
            <span className="flex size-9 shrink-0 items-center justify-center">
              <UserRoundX
                className="size-[15px] shrink-0 text-black"
                strokeWidth={1.75}
                aria-hidden
              />
            </span>
            <span className="text-[14px] font-medium leading-none text-black">
              Unassigned
            </span>
          </div>
        </HandledByMenuItem>

        {agentOptions.map((agent) => {
          const agentValue = `agent:${agent.id}` as const;
          return (
            <HandledByMenuItem
              key={agent.id}
              selected={value === agentValue}
              onSelect={() => onValueChange(agentValue)}
              className="items-start"
            >
              <div className="flex w-full items-center gap-2">
                <Avatar className="size-9 shrink-0">
                  {agent.image ? (
                    <AvatarImage src={agent.image} alt={agent.fullName} />
                  ) : null}
                  <AvatarFallback className="bg-[#F2F2F7] text-[10px] font-semibold text-[#636366]">
                    {memberInitials(agent.fullName)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[14px] font-semibold leading-tight text-black">
                    {agent.firstName}
                  </span>
                  <span className="truncate text-[12px] leading-tight text-[#8E8E93]">
                    {agent.roleLabel}
                  </span>
                </div>
              </div>
            </HandledByMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
