import { Badge } from '@/components/ui/badge';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDistanceToNow } from 'date-fns';
import {
  Calendar,
  Check,
  Clock,
  CreditCard,
  Filter,
  Loader2,
  Mail,
  MailOpen,
  MessageSquare,
  Phone,
  PhoneCall,
  Play,
  Tag,
  UserPlus,
  Webhook,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useLeadHistory } from '../../api';
import type {
  LeadActivityType,
  LeadHistoryItem,
  SequenceExecutionStatus,
  SequenceStepType,
} from '../../types';

interface LeadHistoryTabProps {
  leadId: string;
}

export function LeadHistoryTab({ leadId }: LeadHistoryTabProps) {
  const { history, isLoading, isError } = useLeadHistory({ leadId });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[0, 1, 2, 3, 4].map((n) => (
          <div key={`history-skeleton-${n}`} className="flex gap-4">
            <Skeleton className="size-10 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        Failed to load history. Please try again.
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Clock />
          </EmptyMedia>
          <EmptyTitle>No history yet</EmptyTitle>
          <EmptyDescription>
            Actions and events will appear here as they happen.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="space-y-1">
      {history.map((item, index) => (
        <HistoryItem
          key={item.id}
          item={item}
          isLast={index === history.length - 1}
        />
      ))}
    </div>
  );
}

interface HistoryItemProps {
  item: LeadHistoryItem;
  isLast: boolean;
}

function HistoryItem({ item, isLast }: HistoryItemProps) {
  const isExecution = item.type === 'execution';
  const execution = item.execution;
  const activity = item.activity;

  // Get icon and styling based on type
  const { icon, bgColor, borderColor, label, sublabel } = isExecution
    ? getExecutionDisplay(
        execution as NonNullable<LeadHistoryItem['execution']>
      )
    : getActivityDisplay(activity as NonNullable<LeadHistoryItem['activity']>);

  const timestamp = formatDistanceToNow(new Date(item.timestamp), {
    addSuffix: true,
  });

  return (
    <div className="flex gap-4 relative">
      {/* Timeline line */}
      {!isLast && (
        <div className="absolute left-5 top-12 bottom-0 w-px bg-border" />
      )}

      {/* Icon */}
      <div
        className={`relative z-10 flex items-center justify-center size-10 rounded-full border-2 ${bgColor} ${borderColor}`}
      >
        {icon}
      </div>

      {/* Content */}
      <div className="flex-1 pb-6">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{label}</p>
            {sublabel && (
              <p className="text-xs text-muted-foreground mt-0.5">{sublabel}</p>
            )}
          </div>
          <span className="text-xs text-muted-foreground shrink-0">
            {timestamp}
          </span>
        </div>

        {/* Execution result details */}
        {isExecution && execution?.result && (
          <div className="mt-2">
            <ExecutionResultBadges result={execution.result} />
          </div>
        )}

        {/* Error message */}
        {isExecution && execution?.errorMessage && (
          <p className="text-xs text-destructive mt-2">
            {execution.errorMessage}
          </p>
        )}

        {/* Activity metadata */}
        {!isExecution && activity?.description && (
          <p className="text-xs text-muted-foreground mt-1">
            {activity.description}
          </p>
        )}
      </div>
    </div>
  );
}

function ExecutionResultBadges({
  result,
}: {
  result: NonNullable<LeadHistoryItem['execution']>['result'];
}) {
  if (!result) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {result.delivered && (
        <Badge variant="outline" className="text-xs gap-1">
          <Check className="size-3" />
          Delivered
        </Badge>
      )}
      {result.opened && (
        <Badge variant="outline" className="text-xs gap-1">
          <MailOpen className="size-3" />
          Opened
        </Badge>
      )}
      {result.clicked && (
        <Badge variant="outline" className="text-xs gap-1">
          <Check className="size-3" />
          Clicked
        </Badge>
      )}
      {result.replied && (
        <Badge variant="secondary" className="text-xs gap-1">
          <MessageSquare className="size-3" />
          Replied
        </Badge>
      )}
      {result.callDuration && (
        <Badge variant="outline" className="text-xs gap-1">
          <PhoneCall className="size-3" />
          {Math.round(result.callDuration / 60)}m call
        </Badge>
      )}
      {result.callOutcome && (
        <Badge variant="outline" className="text-xs">
          {result.callOutcome}
        </Badge>
      )}
    </div>
  );
}

// Get display config for sequence execution
function getExecutionDisplay(
  execution: NonNullable<LeadHistoryItem['execution']>
) {
  const stepTypeConfig: Record<
    SequenceStepType,
    { icon: ReactNode; label: string }
  > = {
    email: { icon: <Mail className="size-4" />, label: 'Email sent' },
    sms: { icon: <MessageSquare className="size-4" />, label: 'SMS sent' },
    whatsapp: {
      icon: <MessageSquare className="size-4" />,
      label: 'WhatsApp sent',
    },
    voice_call: { icon: <Phone className="size-4" />, label: 'Voice call' },
    wait: { icon: <Clock className="size-4" />, label: 'Wait completed' },
    condition: {
      icon: <Filter className="size-4" />,
      label: 'Condition evaluated',
    },
    webhook: {
      icon: <Webhook className="size-4" />,
      label: 'Webhook triggered',
    },
  };

  const statusConfig: Record<
    SequenceExecutionStatus,
    { bgColor: string; borderColor: string }
  > = {
    pending: { bgColor: 'bg-muted', borderColor: 'border-muted-foreground/30' },
    running: {
      bgColor: 'bg-blue-50 dark:bg-blue-950',
      borderColor: 'border-blue-500',
    },
    completed: {
      bgColor: 'bg-green-50 dark:bg-green-950',
      borderColor: 'border-green-500',
    },
    failed: {
      bgColor: 'bg-red-50 dark:bg-red-950',
      borderColor: 'border-red-500',
    },
    canceled: {
      bgColor: 'bg-muted',
      borderColor: 'border-muted-foreground/30',
    },
  };

  const stepType = execution.stepType || 'email';
  const stepConfig = stepTypeConfig[stepType];
  const colors = statusConfig[execution.status];

  let statusIcon = stepConfig.icon;
  if (execution.status === 'running') {
    statusIcon = <Loader2 className="size-4 animate-spin" />;
  } else if (execution.status === 'failed') {
    statusIcon = <X className="size-4 text-red-500" />;
  } else if (execution.status === 'canceled') {
    statusIcon = <X className="size-4 text-muted-foreground" />;
  }

  return {
    icon: statusIcon,
    bgColor: colors.bgColor,
    borderColor: colors.borderColor,
    label: stepConfig.label,
    sublabel: execution.sequenceName
      ? `in ${execution.sequenceName}`
      : undefined,
  };
}

// Get display config for lead activity
function getActivityDisplay(
  activity: NonNullable<LeadHistoryItem['activity']>
) {
  const activityConfig: Record<
    LeadActivityType,
    {
      icon: ReactNode;
      label: string;
      bgColor: string;
      borderColor: string;
    }
  > = {
    lead_created: {
      icon: <UserPlus className="size-4" />,
      label: 'Client created',
      bgColor: 'bg-green-50 dark:bg-green-950',
      borderColor: 'border-green-500',
    },
    status_changed: {
      icon: <Check className="size-4" />,
      label: 'Status changed',
      bgColor: 'bg-blue-50 dark:bg-blue-950',
      borderColor: 'border-blue-500',
    },
    assigned_to_sequence: {
      icon: <Play className="size-4" />,
      label: 'Assigned to sequence',
      bgColor: 'bg-purple-50 dark:bg-purple-950',
      borderColor: 'border-purple-500',
    },
    removed_from_sequence: {
      icon: <X className="size-4" />,
      label: 'Removed from sequence',
      bgColor: 'bg-muted',
      borderColor: 'border-muted-foreground/30',
    },
    email_sent: {
      icon: <Mail className="size-4" />,
      label: 'Email sent',
      bgColor: 'bg-blue-50 dark:bg-blue-950',
      borderColor: 'border-blue-500',
    },
    email_opened: {
      icon: <MailOpen className="size-4" />,
      label: 'Email opened',
      bgColor: 'bg-green-50 dark:bg-green-950',
      borderColor: 'border-green-500',
    },
    email_clicked: {
      icon: <Check className="size-4" />,
      label: 'Email link clicked',
      bgColor: 'bg-green-50 dark:bg-green-950',
      borderColor: 'border-green-500',
    },
    email_replied: {
      icon: <MessageSquare className="size-4" />,
      label: 'Email reply received',
      bgColor: 'bg-purple-50 dark:bg-purple-950',
      borderColor: 'border-purple-500',
    },
    sms_sent: {
      icon: <MessageSquare className="size-4" />,
      label: 'SMS sent',
      bgColor: 'bg-blue-50 dark:bg-blue-950',
      borderColor: 'border-blue-500',
    },
    sms_delivered: {
      icon: <Check className="size-4" />,
      label: 'SMS delivered',
      bgColor: 'bg-green-50 dark:bg-green-950',
      borderColor: 'border-green-500',
    },
    whatsapp_sent: {
      icon: <MessageSquare className="size-4" />,
      label: 'WhatsApp sent',
      bgColor: 'bg-blue-50 dark:bg-blue-950',
      borderColor: 'border-blue-500',
    },
    whatsapp_delivered: {
      icon: <Check className="size-4" />,
      label: 'WhatsApp delivered',
      bgColor: 'bg-green-50 dark:bg-green-950',
      borderColor: 'border-green-500',
    },
    whatsapp_read: {
      icon: <Check className="size-4" />,
      label: 'WhatsApp read',
      bgColor: 'bg-green-50 dark:bg-green-950',
      borderColor: 'border-green-500',
    },
    message_received: {
      icon: <MessageSquare className="size-4" />,
      label: 'First message received',
      bgColor: 'bg-purple-50 dark:bg-purple-950',
      borderColor: 'border-purple-500',
    },
    message_sent: {
      icon: <MessageSquare className="size-4" />,
      label: 'First reply sent',
      bgColor: 'bg-blue-50 dark:bg-blue-950',
      borderColor: 'border-blue-500',
    },
    call_made: {
      icon: <Phone className="size-4" />,
      label: 'Call initiated',
      bgColor: 'bg-blue-50 dark:bg-blue-950',
      borderColor: 'border-blue-500',
    },
    call_answered: {
      icon: <PhoneCall className="size-4" />,
      label: 'Call answered',
      bgColor: 'bg-green-50 dark:bg-green-950',
      borderColor: 'border-green-500',
    },
    call_completed: {
      icon: <Check className="size-4" />,
      label: 'Call completed',
      bgColor: 'bg-green-50 dark:bg-green-950',
      borderColor: 'border-green-500',
    },
    appointment_booked: {
      icon: <Calendar className="size-4" />,
      label: 'Appointment booked',
      bgColor: 'bg-purple-50 dark:bg-purple-950',
      borderColor: 'border-purple-500',
    },
    appointment_cancelled: {
      icon: <X className="size-4" />,
      label: 'Appointment cancelled',
      bgColor: 'bg-red-50 dark:bg-red-950',
      borderColor: 'border-red-500',
    },
    appointment_completed: {
      icon: <Check className="size-4" />,
      label: 'Appointment completed',
      bgColor: 'bg-green-50 dark:bg-green-950',
      borderColor: 'border-green-500',
    },
    deposit_paid: {
      icon: <CreditCard className="size-4" />,
      label: 'Deposit paid',
      bgColor: 'bg-green-50 dark:bg-green-950',
      borderColor: 'border-green-500',
    },
    note_added: {
      icon: <MessageSquare className="size-4" />,
      label: 'Note added',
      bgColor: 'bg-muted',
      borderColor: 'border-muted-foreground/30',
    },
    tag_added: {
      icon: <Tag className="size-4" />,
      label: 'Tag added',
      bgColor: 'bg-muted',
      borderColor: 'border-muted-foreground/30',
    },
    tag_removed: {
      icon: <Tag className="size-4" />,
      label: 'Tag removed',
      bgColor: 'bg-muted',
      borderColor: 'border-muted-foreground/30',
    },
  };

  const config = activityConfig[activity.type] || {
    icon: <Check className="size-4" />,
    label: activity.type.replace(/_/g, ' '),
    bgColor: 'bg-muted',
    borderColor: 'border-muted-foreground/30',
  };

  let sublabel = activity.performedByName
    ? `by ${activity.performedByName}`
    : undefined;

  // Add context for certain activities
  if (activity.type === 'status_changed' && activity.metadata) {
    sublabel = `${activity.metadata.previousValue} → ${activity.metadata.newValue}`;
  } else if (
    activity.type === 'assigned_to_sequence' &&
    activity.metadata?.sequenceName
  ) {
    sublabel = activity.metadata.sequenceName;
  } else if (
    activity.type === 'appointment_booked' &&
    activity.metadata?.appointmentDate
  ) {
    sublabel = new Date(activity.metadata.appointmentDate).toLocaleString();
  } else if (
    activity.type === 'deposit_paid' &&
    activity.metadata?.amountCents != null
  ) {
    const currency = (activity.metadata.currency ?? 'eur').toUpperCase();
    sublabel = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
    }).format(activity.metadata.amountCents / 100);
  }

  return {
    ...config,
    sublabel,
  };
}
